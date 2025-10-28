import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server as SocketIOServer } from 'socket.io';
import cron from 'node-cron';
import { createDatabase, getKnownRoomIds } from './db.js';
import { RoomStore } from './roomStore.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const TEMPLATE_DIR = process.env.TEMPLATE_DIR || path.join(process.cwd(), 'templates');
const SNAPSHOT_ON_START = process.env.SNAPSHOT_ON_START === 'true';

async function buildServer() {
  const fastify = Fastify({ logger: true });
  const db = createDatabase(process.env.DATABASE_PATH);
  const roomStore = new RoomStore({ db, templateDir: TEMPLATE_DIR });

  fastify.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/public/'
  });

  fastify.get('/healthz', async () => ({ status: 'ok' }));

  let io;

  fastify.get('/rooms/:id/state', async (request, reply) => {
    const { id } = request.params;
    const state = await roomStore.getRoomState(id);
    const presence = roomStore.getPresence(id);
    return { state, presence };
  });

  fastify.post('/rooms/:id/reset', async (request, reply) => {
    const { id } = request.params;
    const state = await roomStore.resetRoom(id);
    await roomStore.saveSnapshot(id);
    io.to(id).emit('state:reset', { state, ts: new Date().toISOString() });
    return { ok: true, state };
  });

  io = new SocketIOServer(fastify.server, {
    cors: {
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*'
    }
  });

  const disconnectTimers = new Map();

  io.on('connection', async (socket) => {
    const roomId = socket.handshake.query.roomId;
    if (typeof roomId !== 'string' || roomId.length === 0) {
      socket.emit('error', { message: 'roomId required' });
      socket.disconnect(true);
      return;
    }
    try {
      await roomStore.initRoom(roomId);
    } catch (err) {
      socket.emit('error', { message: 'failed_to_load_room' });
      socket.disconnect(true);
      return;
    }

    socket.join(roomId);

    socket.emit('presence:sync', roomStore.getPresence(roomId));

    socket.on('op', async (op, ack) => {
      try {
        const result = await roomStore.applyOperation(roomId, op);
        io.to(roomId).emit('state:delta', {
          roomId,
          delta: result.delta,
          version: result.version,
          ts: new Date().toISOString()
        });
        if (typeof ack === 'function') {
          ack({ ok: true, version: result.version });
        }
      } catch (err) {
        if (typeof ack === 'function') {
          ack({
            ok: false,
            error: err.code || err.message,
            version: err.serverVersion,
            state: err.state
          });
        }
      }
    });

    socket.on('presence:update', async (payload = {}, ack) => {
      try {
        if (disconnectTimers.has(socket.id)) {
          clearTimeout(disconnectTimers.get(socket.id));
          disconnectTimers.delete(socket.id);
        }
        const presence = await roomStore.updatePresence(roomId, socket.id, payload);
        io.to(roomId).emit('presence:sync', presence);
        if (typeof ack === 'function') {
          ack({ ok: true });
        }
      } catch (err) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: err.message });
        }
      }
    });

    socket.on('disconnect', () => {
      const timer = setTimeout(async () => {
        const presence = await roomStore.clearPresence(roomId, socket.id);
        io.to(roomId).emit('presence:sync', presence);
        disconnectTimers.delete(socket.id);
      }, 30_000);
      disconnectTimers.set(socket.id, timer);
    });
  });

  const pruneInterval = setInterval(async () => {
    for (const roomId of roomStore.rooms.keys()) {
      const presence = await roomStore.prunePresence(roomId);
      if (presence.length) {
        io.to(roomId).emit('presence:sync', presence);
      }
    }
  }, 10_000);

  cron.schedule(
    '0 0 * * *',
    async () => {
      const roomIds = getKnownRoomIds(db);
      for (const roomId of roomIds) {
        const state = await roomStore.resetRoom(roomId);
        await roomStore.saveSnapshot(roomId);
        io.to(roomId).emit('state:reset', { state, ts: new Date().toISOString(), reason: 'daily' });
      }
    },
    { timezone: 'Asia/Tokyo' }
  );

  if (SNAPSHOT_ON_START) {
    const roomIds = getKnownRoomIds(db);
    for (const roomId of roomIds) {
      await roomStore.saveSnapshot(roomId);
    }
  }

  fastify.addHook('onClose', async () => {
    clearInterval(pruneInterval);
    for (const timer of roomStore.snapshotTimers.values()) {
      clearInterval(timer);
    }
    io.close();
    db.close();
  });

  return { fastify, io, roomStore };
}

const { fastify } = await buildServer();

fastify.listen({ port: PORT, host: HOST }).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
