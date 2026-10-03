import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      status_slug TEXT UNIQUE NOT NULL,
      status_title TEXT NOT NULL DEFAULT 'Estado de los servicios',
      telegram_chat_id TEXT,
      notify_email INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitors (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      keyword TEXT,
      interval_s INTEGER NOT NULL,
      public INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      last_checked_at INTEGER,
      last_response_ms INTEGER,
      last_error TEXT,
      ssl_expires_at INTEGER,
      ssl_checked_at INTEGER,
      ssl_warned_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY,
      monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      response_ms INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS checks_monitor_at ON checks(monitor_id, at);
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY,
      monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      resolved_at INTEGER,
      cause TEXT
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Migraciones sencillas: columnas añadidas después de la primera versión.
  const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  for (const col of ['stripe_customer_id TEXT', 'stripe_subscription_id TEXT']) {
    if (!cols.has(col.split(' ')[0])) db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
  }
  return db;
}

// Porcentaje de comprobaciones correctas desde `since` (ms). null si no hay datos.
export function uptime(db, monitorId, since) {
  const r = db
    .prepare('SELECT COUNT(*) AS n, SUM(ok) AS ok FROM checks WHERE monitor_id = ? AND at >= ?')
    .get(monitorId, since);
  return r.n ? (100 * r.ok) / r.n : null;
}
