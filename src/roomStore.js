import fs from 'node:fs';
import path from 'node:path';
import { KeyedLock } from './utils/lock.js';

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const PRESENCE_STALE_MS = 30 * 1000;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function applyMoveOperation(state, op) {
  const card = state.cards.find((c) => c.id === op.cardId);
  if (!card) {
    throw new Error(`Card ${op.cardId} not found`);
  }
  card.zone = op.toZone;
  state.version = op.version;
}

export class RoomStore {
  constructor({ db, templateDir }) {
    this.db = db;
    this.templateDir = templateDir;
    this.rooms = new Map();
    this.presence = new Map();
    this.lock = new KeyedLock();
    this.opInsert = this.db.prepare(
      'INSERT OR REPLACE INTO room_ops(room_id, version, op_json, created_at) VALUES (?, ?, ?, datetime(\'now\'))'
    );
    this.snapshotInsert = this.db.prepare(
      'INSERT INTO room_snapshots(room_id, version, state_json, created_at) VALUES (?, ?, ?, datetime(\'now\'))'
    );
    this.snapshotLatestStmt = this.db.prepare(
      'SELECT state_json, version FROM room_snapshots WHERE room_id = ? ORDER BY version DESC LIMIT 1'
    );
    this.opsAfterStmt = this.db.prepare(
      'SELECT version, op_json FROM room_ops WHERE room_id = ? AND version > ? ORDER BY version ASC'
    );
    this.deleteOpsStmt = this.db.prepare('DELETE FROM room_ops WHERE room_id = ?');
    this.deleteSnapshotsStmt = this.db.prepare('DELETE FROM room_snapshots WHERE room_id = ?');
    this.snapshotTimers = new Map();
  }

  async initRoom(roomId) {
    return this.lock.withKey(roomId, async () => {
      if (this.rooms.has(roomId)) {
        return this.rooms.get(roomId);
      }
      let stateRecord = this.snapshotLatestStmt.get(roomId);
      let state;
      if (stateRecord) {
        state = JSON.parse(stateRecord.state_json);
      } else {
        state = this.loadTemplate(roomId);
      }
      const ops = this.opsAfterStmt.all(roomId, state.version || 0);
      for (const row of ops) {
        const op = JSON.parse(row.op_json);
        applyMoveOperation(state, op);
      }
      this.rooms.set(roomId, state);
      if (!this.snapshotTimers.has(roomId)) {
        const timer = setInterval(() => {
          this.saveSnapshot(roomId).catch((err) => {
            console.error('Snapshot error', roomId, err);
          });
        }, SNAPSHOT_INTERVAL_MS);
        this.snapshotTimers.set(roomId, timer);
      }
      return state;
    });
  }

  loadTemplate(roomId) {
    const explicitTemplate = path.join(this.templateDir, `${roomId}.json`);
    const defaultTemplate = path.join(this.templateDir, 'default-room.json');
    const templatePath = fs.existsSync(explicitTemplate) ? explicitTemplate : defaultTemplate;
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
    const state = deepClone(template);
    state.id = roomId;
    return state;
  }

  async getRoomState(roomId) {
    const room = await this.initRoom(roomId);
    return deepClone(room);
  }

  async applyOperation(roomId, op) {
    return this.lock.withKey(roomId, async () => {
      const state = await this.initRoom(roomId);
      if (op.type !== 'move') {
        throw new Error(`Unsupported op type: ${op.type}`);
      }
      if (typeof op.clientV !== 'number') {
        throw new Error('clientV required');
      }
      if (op.clientV !== state.version) {
        const error = new Error('version_conflict');
        error.code = 'VERSION_CONFLICT';
        error.serverVersion = state.version;
        error.state = deepClone(state);
        throw error;
      }
      const serverVersion = state.version + 1;
      const moveOp = {
        type: 'move',
        cardId: op.cardId,
        toZone: op.toZone,
        version: serverVersion
      };
      applyMoveOperation(state, moveOp);
      this.opInsert.run(roomId, serverVersion, JSON.stringify(moveOp));
      return {
        delta: moveOp,
        version: serverVersion,
        state: deepClone(state)
      };
    });
  }

  async saveSnapshot(roomId) {
    return this.lock.withKey(roomId, async () => {
      const state = await this.initRoom(roomId);
      this.snapshotInsert.run(roomId, state.version, JSON.stringify(state));
    });
  }

  async resetRoom(roomId) {
    return this.lock.withKey(roomId, async () => {
      const template = this.loadTemplate(roomId);
      this.deleteOpsStmt.run(roomId);
      this.deleteSnapshotsStmt.run(roomId);
      this.snapshotInsert.run(roomId, template.version || 0, JSON.stringify(template));
      this.rooms.set(roomId, template);
      this.presence.set(roomId, new Map());
      return deepClone(template);
    });
  }

  async updatePresence(roomId, clientId, payload = {}) {
    return this.lock.withKey(roomId, async () => {
      await this.initRoom(roomId);
      const presenceMap = this.presence.get(roomId) || new Map();
      const now = Date.now();
      presenceMap.set(clientId, {
        clientId,
        holding: payload.holding || null,
        ts: payload.ts || new Date(now).toISOString(),
        updatedAt: now
      });
      this.presence.set(roomId, presenceMap);
      return this.serializePresence(presenceMap.values());
    });
  }

  async clearPresence(roomId, clientId) {
    return this.lock.withKey(roomId, async () => {
      const presenceMap = this.presence.get(roomId);
      if (!presenceMap) return [];
      presenceMap.delete(clientId);
      this.presence.set(roomId, presenceMap);
      return this.serializePresence(presenceMap.values());
    });
  }

  async prunePresence(roomId) {
    return this.lock.withKey(roomId, async () => {
      const presenceMap = this.presence.get(roomId);
      if (!presenceMap) return [];
      const now = Date.now();
      for (const [clientId, entry] of presenceMap.entries()) {
        if (now - entry.updatedAt > PRESENCE_STALE_MS) {
          presenceMap.delete(clientId);
        }
      }
      this.presence.set(roomId, presenceMap);
      return this.serializePresence(presenceMap.values());
    });
  }

  getPresence(roomId) {
    const presenceMap = this.presence.get(roomId) || new Map();
    return this.serializePresence(presenceMap.values());
  }

  serializePresence(iterable) {
    return Array.from(iterable).map((entry) => ({
      clientId: entry.clientId,
      holding: entry.holding || null,
      ts: entry.ts
    }));
  }
}
