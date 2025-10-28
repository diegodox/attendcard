# Attend Card Backend

A Fastify + Socket.IO backend that manages attendance rooms with optimistic client updates, persistent snapshots, and operation logs powered by SQLite.

## Features

- Single-process Fastify server with integrated Socket.IO transport and static file hosting.
- SQLite (WAL enabled) persistence with room snapshots and move operation logs.
- Optimistic concurrency control with versioned card move operations and delta broadcasts.
- Presence tracking with automatic stale entry pruning and ghost-hold cleanup after disconnects.
- Daily room regeneration from templates at 00:00 JST plus manual reset endpoint.
- Periodic snapshotting every five minutes and replay-on-start recovery.
- Docker-friendly configuration with health check endpoint and static placeholder page.

## Getting Started

### Prerequisites

- Node.js 18+ (Fastify and Socket.IO depend on modern ESM support).
- SQLite 3 (for local development the bundled `better-sqlite3` binary is sufficient).

### Install dependencies

```bash
npm install
```

### Run the server

Start a production-like instance:

```bash
npm run start
```

Or run with file watching during development:

```bash
npm run dev
```

### Environment variables

| Name | Default | Description |
| ---- | ------- | ----------- |
| `PORT` | `3000` | HTTP/WS listening port. |
| `HOST` | `0.0.0.0` | Hostname binding. |
| `DATABASE_PATH` | `./data.sqlite` | SQLite file location. |
| `TEMPLATE_DIR` | `./templates` | Directory containing room templates. |
| `CORS_ORIGIN` | `*` | Allowed origins for Socket.IO connections (comma separated for multiple). |
| `SNAPSHOT_ON_START` | `false` | When `true`, forces a snapshot write for all known rooms during boot. |

## HTTP API

- `GET /rooms/:id/state` – Returns `{ state, presence }` for initial client hydration.
- `POST /rooms/:id/reset` – Regenerates the room from its template and broadcasts a `state:reset` event.
- `GET /healthz` – Basic health probe.

## WebSocket Events

Socket connections must provide a `roomId` query parameter.

- Client → Server `op` – `{ type: "move", cardId, toZone, clientV }`.
  - Ack success: `{ ok: true, version }`.
  - Ack conflict/error: `{ ok: false, error, version?, state? }`.
- Client → Server `presence:update` – `{ holding: cardId|null, ts? }`.
- Server → Client `state:delta` – `{ roomId, delta, version, ts }`.
- Server → Client `state:reset` – `{ state, ts, reason? }`.
- Server → Client `presence:sync` – `[{ clientId, holding, ts }]`.

## Persistence & Recovery

- Snapshots are saved automatically every five minutes and on manual resets.
- WAL mode keeps write performance high and allows concurrent reads.
- On boot, the latest snapshot is replayed together with move operations to reconstruct room state.
- Presence data lives in memory and is periodically pruned; stale entries disappear within ~30 seconds.

## Scheduling

- Daily reset cron at 00:00 JST (`Asia/Tokyo`) using room templates.
- Presence pruning runs every 10 seconds.

## Development Notes

The repo ships with a simple static placeholder page served from `/public`. Integrate your PWA build output by replacing the contents of that directory.
