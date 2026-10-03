import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const SESSION_DAYS = 30;

export function createUser(db, email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El email no es válido.');
  if (String(password || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new Error('Ya existe una cuenta con ese email.');
  const hash = bcrypt.hashSync(password, 10);
  const slug = crypto.randomBytes(5).toString('hex');
  const info = db
    .prepare('INSERT INTO users (email, password_hash, status_slug, created_at) VALUES (?, ?, ?, ?)')
    .run(email, hash, slug, Date.now());
  return info.lastInsertRowid;
}

export function verifyUser(db, email, password) {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return null;
  return u;
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token, userId, Date.now() + SESSION_DAYS * 86400e3);
  return token;
}

export function userFromSession(db, token) {
  if (!token) return null;
  return db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?')
    .get(token, Date.now()) || null;
}

export function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
