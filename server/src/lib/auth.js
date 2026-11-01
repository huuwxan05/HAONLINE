import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, get, now } from '../db.js';
import { forbidden, unauthorized } from './errors.js';
import { randomToken, sha256 } from './security.js';

export function tokenHash(token) {
  return sha256(`${token}:${config.secret}`);
}

export function createSession(userId, req, device = null) {
  const token = randomToken(32);
  const sessionId = crypto.randomUUID();
  const created = now();
  const expires = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, device, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, userId, tokenHash(token), device, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 500), created, created, expires);
  return { token, sessionId, expires_at: expires };
}

export function resolveToken(token) {
  if (!token) return null;
  const session = get(
    `SELECT s.*, u.role, u.status, u.email, u.username, u.display_name, u.avatar_url
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    tokenHash(token),
  );
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  if (session.status !== 'active') return null;
  return session;
}

export function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  if (req.headers['x-session-token']) return String(req.headers['x-session-token']);
  return null;
}

export function attachUser(req, _res, next) {
  const token = readToken(req);
  const session = resolveToken(token);
  if (session) {
    req.user = session;
    req.sessionId = session.id;
    const last = new Date(session.last_seen_at).getTime();
    if (Date.now() - last > 60000) {
      db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), session.id);
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), session.user_id);
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('Cần quyền quản trị'));
    next();
  };
}

export function revokeSession(sessionId, userId) {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?').run(now(), sessionId, userId);
}

export function revokeAllSessions(userId, exceptSessionId = null) {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?')
    .run(now(), userId, exceptSessionId || '');
}

export function createAuthToken(userId, type, { minutes = 15, meta = null, code = null } = {}) {
  const token = randomToken(24);
  db.prepare(
    `INSERT INTO auth_tokens (id, user_id, type, token_hash, code, expires_at, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(), userId, type, tokenHash(token), code,
    new Date(Date.now() + minutes * 60000).toISOString(),
    meta ? JSON.stringify(meta) : null, now(),
  );
  return token;
}

export function consumeAuthToken(token, type) {
  const row = get('SELECT * FROM auth_tokens WHERE token_hash = ? AND type = ?', tokenHash(token), type);
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(now(), row.id);
  return row;
}

export function findAuthTokenByCode(userId, type, code) {
  const row = get(
    'SELECT * FROM auth_tokens WHERE user_id = ? AND type = ? AND code = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
    userId, type, String(code),
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export function markAuthTokenUsed(id) {
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(now(), id);
}
