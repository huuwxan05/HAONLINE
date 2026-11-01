import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, get, now } from '../db.js';
import { wrap, ok, created } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword, verifyTotp, randomCode } from '../lib/security.js';
import {
  createSession, createAuthToken, consumeAuthToken, revokeSession, revokeAllSessions, requireAuth,
} from '../lib/auth.js';
import { sendMail, verificationEmail } from '../lib/mailer.js';
import { selfUser, notify, audit, track } from '../lib/social.js';
import { rateLimit } from '../lib/rateLimit.js';

const router = Router();
const authLimiter = rateLimit({ windowMs: 10 * 60000, max: 30 });

function createDefaults(userId) {
  db.prepare(
    `INSERT INTO privacy_settings (user_id, updated_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO NOTHING`,
  ).run(userId, now());
  db.prepare(
    `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES
      (?, 'theme', '"dark"', ?), (?, 'language', '"vi"', ?), (?, 'notifications_email', 'true', ?),
      (?, 'notifications_push', 'true', ?), (?, 'autoplay_reels', 'true', ?)
     ON CONFLICT(user_id, key) DO NOTHING`,
  ).run(userId, now(), userId, now(), userId, now(), userId, now(), userId, now());
}

async function issueVerification(user) {
  const code = randomCode(6);
  const token = createAuthToken(user.id, 'email_verify', { minutes: 30, code });
  const link = `${config.publicUrl}/?verify=${encodeURIComponent(token)}`;
  await sendMail({ to: user.email, subject: 'Xác minh email HAONLINE', body: verificationEmail(code) + `<p><a href="${link}">Hoặc bấm vào đây để xác minh</a></p>` });
  return { token, code };
}

function loginHistory(userId, req, success, reason = null) {
  db.prepare('INSERT INTO login_history (id, user_id, email, ip, user_agent, success, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, null, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 500), success ? 1 : 0, reason, now());
}

router.post('/register', authLimiter, wrap(async (req, res) => {
  const registration = get("SELECT value FROM app_settings WHERE key = 'registration_open'");
  if (registration && registration.value === 'false') throw forbidden('Đăng ký tài khoản đang tạm đóng');
  const email = v.email(req.body.email);
  const uname = v.username(req.body.username);
  const pass = v.password(req.body.password);
  const displayName = v.str(req.body.display_name, { field: 'Tên hiển thị', min: 1, max: 80 });
  const phone = v.optionalStr(req.body.phone, { field: 'Số điện thoại', max: 30 });
  if (get('SELECT id FROM users WHERE email = ?', email)) throw conflict('Email đã được sử dụng');
  if (get('SELECT id FROM users WHERE username = ?', uname)) throw conflict('Username đã được sử dụng');
  if (phone && get('SELECT id FROM users WHERE phone = ?', phone)) throw conflict('Số điện thoại đã được sử dụng');
  const userId = crypto.randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO users (id, email, phone, username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, email, phone, uname, hashPassword(pass), displayName, ts, ts);
  createDefaults(userId);
  const verification = await issueVerification({ id: userId, email });
  const session = createSession(userId, req, req.body.device || 'web');
  notify({ userId, kind: 'welcome', data: { message: 'Chào mừng bạn đến với HAONLINE' } });
  track(userId, 'register');
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  created(res, {
    user: selfUser(user),
    token: session.token,
    expires_at: session.expires_at,
    verification: config.mail.devMode && !config.isProd ? { token: verification.token, code: verification.code } : {},
  });
}));

router.post('/login', authLimiter, wrap(async (req, res) => {
  const email = v.email(req.body.email);
  const pass = String(req.body.password || '');
  const user = get('SELECT * FROM users WHERE lower(email) = ?', email);
  if (!user || user.status !== 'active' || !verifyPassword(pass, user.password_hash)) {
    loginHistory(user?.id || null, req, false, 'invalid_credentials');
    throw unauthorized('Email hoặc mật khẩu không đúng');
  }
  if (user.twofa_enabled) {
    const totpCode = req.body.totp || req.body.code;
    if (!totpCode) {
      loginHistory(user.id, req, false, 'twofa_required');
      return res.status(401).json({ error: { code: 'twofa_required', message: 'Cần mã xác thực 2 lớp' } });
    }
    if (!verifyTotp(user.twofa_secret, totpCode)) {
      loginHistory(user.id, req, false, 'twofa_invalid');
      throw unauthorized('Mã xác thực 2 lớp không đúng');
    }
  }
  loginHistory(user.id, req, true);
  const session = createSession(user.id, req, req.body.device || 'web');
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), user.id);
  track(user.id, 'login', null, null, { device: req.body.device || 'web' });
  ok(res, { user: selfUser(user), token: session.token, expires_at: session.expires_at });
}));

router.post('/logout', requireAuth, wrap(async (req, res) => {
  revokeSession(req.sessionId, req.user.user_id);
  ok(res, { ok: true });
}));

router.get('/me', requireAuth, wrap(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.user_id);
  const privacy = get('SELECT * FROM privacy_settings WHERE user_id = ?', user.id);
  const settings = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(user.id);
  const parsed = {};
  for (const row of settings) {
    try { parsed[row.key] = JSON.parse(row.value); } catch { parsed[row.key] = row.value; }
  }
  ok(res, { user: selfUser(user), privacy, settings: parsed });
}));

router.post('/email/verify', wrap(async (req, res) => {
  const token = req.body.token ? String(req.body.token) : null;
  const code = req.body.code ? String(req.body.code) : null;
  const email = req.body.email ? v.email(req.body.email) : null;
  let row = null;
  if (token) {
    row = consumeAuthToken(token, 'email_verify');
  } else if (code && email) {
    const user = get('SELECT * FROM users WHERE lower(email) = ?', email);
    if (!user) throw notFound('Không tìm thấy tài khoản');
    const candidate = get(
      "SELECT * FROM auth_tokens WHERE user_id = ? AND type = 'email_verify' AND code = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
      user.id, code,
    );
    if (candidate && new Date(candidate.expires_at).getTime() >= Date.now()) {
      db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(now(), candidate.id);
      row = candidate;
    }
  }
  if (!row) throw badRequest('Mã xác minh không đúng hoặc đã hết hạn');
  db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(now(), row.user_id);
  notify({ userId: row.user_id, kind: 'email_verified', data: { message: 'Email đã được xác minh' } });
  ok(res, { ok: true, verified: true });
}));

router.post('/email/resend', requireAuth, authLimiter, wrap(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.user_id);
  if (user.email_verified) return ok(res, { ok: true, already_verified: true });
  const verification = await issueVerification(user);
  ok(res, { ok: true, dev_code: config.mail.devMode && !config.isProd ? verification.code : undefined });
}));

router.post('/otp/request', authLimiter, wrap(async (req, res) => {
  const email = v.email(req.body.email);
  const purpose = v.oneOf(req.body.purpose, ['login', 'verify', 'reset'], 'purpose', 'login');
  const user = get('SELECT * FROM users WHERE lower(email) = ?', email);
  if (!user) return ok(res, { ok: true, sent: false });
  const code = randomCode(6);
  createAuthToken(user.id, `otp_${purpose}`, { minutes: 10, code });
  await sendMail({ to: email, subject: 'Mã OTP HAONLINE', body: verificationEmail(code) });
  ok(res, { ok: true, sent: true, dev_code: config.mail.devMode && !config.isProd ? code : undefined });
}));

router.post('/otp/verify', authLimiter, wrap(async (req, res) => {
  const email = v.email(req.body.email);
  const purpose = v.oneOf(req.body.purpose, ['login', 'verify', 'reset'], 'purpose', 'login');
  const code = v.str(req.body.code, { field: 'Mã OTP', min: 4, max: 10 });
  const user = get('SELECT * FROM users WHERE lower(email) = ?', email);
  if (!user || user.status !== 'active') throw unauthorized('Tài khoản không hợp lệ');
  const row = get(
    'SELECT * FROM auth_tokens WHERE user_id = ? AND type = ? AND code = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
    user.id, `otp_${purpose}`, code,
  );
  if (!row || new Date(row.expires_at).getTime() < Date.now()) throw unauthorized('Mã OTP không đúng hoặc đã hết hạn');
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(now(), row.id);
  if (purpose === 'verify') {
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);
    return ok(res, { ok: true, verified: true });
  }
  if (purpose === 'login') {
    loginHistory(user.id, req, true, 'otp');
    const session = createSession(user.id, req, req.body.device || 'web');
    return ok(res, { user: selfUser(user), token: session.token, expires_at: session.expires_at });
  }
  const resetToken = createAuthToken(user.id, 'password_reset', { minutes: 15 });
  ok(res, { ok: true, reset_token: resetToken });
}));

router.post('/password/forgot', authLimiter, wrap(async (req, res) => {
  const email = v.email(req.body.email);
  const user = get('SELECT * FROM users WHERE lower(email) = ?', email);
  if (!user) return ok(res, { ok: true, sent: true });
  const token = createAuthToken(user.id, 'password_reset', { minutes: 30 });
  const link = `${config.publicUrl}/?reset=${encodeURIComponent(token)}`;
  await sendMail({ to: email, subject: 'Khôi phục tài khoản HAONLINE', body: `<p>Bấm vào liên kết để đặt lại mật khẩu (hết hạn sau 30 phút):</p><p><a href="${link}">${link}</a></p>` });
  ok(res, { ok: true, sent: true, dev_token: config.mail.devMode && !config.isProd ? token : undefined });
}));

router.post('/password/reset', authLimiter, wrap(async (req, res) => {
  const token = v.str(req.body.token, { field: 'Token', min: 10 });
  const pass = v.password(req.body.password);
  const row = consumeAuthToken(token, 'password_reset');
  if (!row) throw badRequest('Liên kết không hợp lệ hoặc đã hết hạn');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(pass), now(), row.user_id);
  revokeAllSessions(row.user_id);
  audit(row.user_id, 'password_reset', 'user', row.user_id);
  ok(res, { ok: true });
}));

router.get('/check-username', wrap(async (req, res) => {
  const uname = v.username(req.query.username);
  const taken = !!get('SELECT id FROM users WHERE username = ?', uname);
  ok(res, { username: uname, available: !taken });
}));

export default router;
