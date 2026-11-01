import crypto from 'node:crypto';
import { config } from './config.js';
import { db, get, migrate, now } from './db.js';
import { hashPassword, randomToken } from './lib/security.js';

migrate();

const email = (process.env.ADMIN_EMAIL || 'admin@haonline.local').toLowerCase();
const password = process.env.ADMIN_PASSWORD || `Ha-${randomToken(9)}`;
const username = process.env.ADMIN_USERNAME || 'admin';

let user = get('SELECT * FROM users WHERE lower(email) = ?', email);
if (user) {
  db.prepare("UPDATE users SET role = 'admin', status = 'active' WHERE id = ?").run(user.id);
  console.log(`[seed] existing user ${email} promoted to admin (password unchanged)`);
} else {
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO users (id, email, username, password_hash, role, display_name, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', ?, 1, ?, ?)`,
  ).run(id, email, username, hashPassword(password), 'HAONLINE Admin', ts, ts);
  db.prepare('INSERT INTO privacy_settings (user_id, updated_at) VALUES (?, ?) ON CONFLICT DO NOTHING').run(id, ts);
  db.prepare("INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, 'theme', '\"dark\"', ?) ON CONFLICT DO NOTHING").run(id, ts);
  console.log(`[seed] admin created: ${email} / ${password}`);
  console.log('[seed] change this password after first login');
}
console.log(`[seed] environment=${config.env}`);
