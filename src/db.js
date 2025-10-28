import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data.sqlite');

export function createDatabase(dbPath = DEFAULT_DB_PATH) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_snapshots (
      room_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_ops (
      room_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      op_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, version)
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_room_snapshots_room_created ON room_snapshots(room_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_room_ops_room_version ON room_ops(room_id, version)');
  return db;
}

export function getKnownRoomIds(db) {
  const roomIds = new Set();
  const snapshotStmt = db.prepare('SELECT DISTINCT room_id FROM room_snapshots');
  for (const row of snapshotStmt.iterate()) {
    roomIds.add(row.room_id);
  }
  const opsStmt = db.prepare('SELECT DISTINCT room_id FROM room_ops');
  for (const row of opsStmt.iterate()) {
    roomIds.add(row.room_id);
  }
  return Array.from(roomIds);
}
