import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function startTestServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haonline-test-'));
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = dir;
  process.env.DB_PATH = path.join(dir, 'haonline.db');
  process.env.APP_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.PUBLIC_URL = 'http://127.0.0.1';
  process.env.MAIL_DEV_MODE = 'true';
  process.env.PORT = '0';

  const database = await import('../src/db.js');
  database.migrate();
  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, url, { token, body, rawBody, headers = {} } = {}) {
    const opts = { method, headers: { ...headers } };
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (rawBody !== undefined) {
      opts.body = rawBody;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${base}${url}`, opts);
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    return { status: res.status, data, headers: res.headers };
  }

  async function register(prefix = 'user', overrides = {}) {
    const suffix = crypto.randomBytes(5).toString('hex');
    const username = (overrides.username || `${prefix}${suffix}`).slice(0, 32);
    const email = overrides.email || `${prefix}.${suffix}@example.com`;
    const password = overrides.password || 'Passw0rd123';
    const res = await request('POST', '/api/auth/register', {
      body: {
        email,
        username,
        password,
        display_name: overrides.display_name || prefix,
      },
    });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.data)}`);
    return { ...res.data, email, username, password };
  }

  function setRole(userId, role) {
    database.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
      .run(role, new Date().toISOString(), userId);
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    try { database.db.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return {
    base,
    dir,
    db: database.db,
    request,
    register,
    setRole,
    close,
  };
}
