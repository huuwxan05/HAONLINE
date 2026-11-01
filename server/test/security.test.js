import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let app;
let alice;
let bob;

before(async () => {
  app = await startTestServer();
  alice = await app.register('securealice', { display_name: 'Secure Alice' });
  bob = await app.register('securebob', { display_name: 'Secure Bob' });
});

after(async () => {
  await app.close();
});

test('security headers and SPA fallback are present', async () => {
  const page = await app.request('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(page.headers.get('x-powered-by'), null);

  const health = await app.request('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.database, 'ok');
  assert.ok(health.headers.get('x-request-id'));
});

test('protected endpoints reject anonymous and malformed requests', async () => {
  const feed = await app.request('GET', '/api/feed');
  assert.equal(feed.status, 200);

  const me = await app.request('GET', '/api/auth/me');
  assert.equal(me.status, 401);

  const post = await app.request('POST', '/api/posts', { body: { body: 'anonymous' } });
  assert.equal(post.status, 401);

  const malformed = await app.request('POST', '/api/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    rawBody: '{"email":',
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.data.error.code, 'invalid_json');

  const injection = await app.request('POST', '/api/auth/login', {
    body: { email: "admin@example.com' OR 1=1 --", password: 'anything' },
  });
  assert.equal(injection.status, 400);
  assert.equal(injection.data.error.code, 'bad_request');
});

test('normal users cannot access admin APIs or delete foreign posts', async () => {
  const dashboard = await app.request('GET', '/api/admin/dashboard', { token: bob.token });
  assert.equal(dashboard.status, 403);

  const post = await app.request('POST', '/api/posts', {
    token: alice.token,
    body: { body: 'Bài viết riêng của Alice' },
  });
  const deleted = await app.request('DELETE', `/api/posts/${post.data.post.id}`, { token: bob.token });
  assert.equal(deleted.status, 403);
});

test('admin APIs work for promoted staff and maintenance/features are enforced', async () => {
  app.setRole(alice.user.id, 'admin');
  const dashboard = await app.request('GET', '/api/admin/dashboard', { token: alice.token });
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.data.users.total >= 2);

  const backup = await app.request('POST', '/api/admin/backups', { token: alice.token });
  assert.equal(backup.status, 201);
  assert.equal(backup.data.backup.status, 'completed');

  const outbox = await app.request('GET', '/api/admin/email-outbox', { token: alice.token });
  assert.equal(outbox.status, 200);
  assert.ok(outbox.data.items.length >= 2);

  const enabled = await app.request('PATCH', '/api/admin/settings', {
    token: alice.token,
    body: { settings: { maintenance_mode: true } },
  });
  assert.equal(enabled.status, 200);

  const blocked = await app.request('GET', '/api/feed', { token: bob.token });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.data.error.code, 'maintenance');

  const loginStillWorks = await app.request('POST', '/api/auth/login', {
    body: { email: bob.email, password: bob.password },
  });
  assert.equal(loginStillWorks.status, 200);

  const disabled = await app.request('PATCH', '/api/admin/settings', {
    token: alice.token,
    body: { settings: { maintenance_mode: false } },
  });
  assert.equal(disabled.status, 200);

  const restored = await app.request('GET', '/api/feed', { token: bob.token });
  assert.equal(restored.status, 200);

  const featuresOff = await app.request('PATCH', '/api/admin/settings', {
    token: alice.token,
    body: { settings: { feature_live: false, feature_calls: false, feature_marketplace: false } },
  });
  assert.equal(featuresOff.status, 200);

  const liveOff = await app.request('POST', '/api/live', { token: bob.token, body: { title: 'Off' } });
  assert.equal(liveOff.status, 403);
  const callsOff = await app.request('POST', '/api/calls', { token: bob.token, body: { kind: 'voice' } });
  assert.equal(callsOff.status, 403);
  const marketOff = await app.request('POST', '/api/marketplace/products', {
    token: bob.token,
    body: { title: 'Off', price_cents: 1000 },
  });
  assert.equal(marketOff.status, 403);

  const featuresOn = await app.request('PATCH', '/api/admin/settings', {
    token: alice.token,
    body: { settings: { feature_live: true, feature_calls: true, feature_marketplace: true } },
  });
  assert.equal(featuresOn.status, 200);
});

test('privacy settings hide profiles and search results', async () => {
  const privacy = await app.request('PATCH', '/api/privacy', {
    token: alice.token,
    body: { profile_visibility: 'private', searchable: false, who_can_message: 'none' },
  });
  assert.equal(privacy.status, 200);

  const profile = await app.request('GET', `/api/users/${alice.user.id}`, { token: bob.token });
  assert.equal(profile.status, 200);
  assert.equal(profile.data.user.limited, true);
  assert.equal(profile.data.user.bio, '');

  const search = await app.request('GET', `/api/search?q=${alice.username}&type=users`, { token: bob.token });
  assert.equal(search.status, 200);
  assert.equal(search.data.users.some((user) => user.id === alice.user.id), false);

  const ownSearch = await app.request('GET', `/api/search?q=${alice.username}&type=users`, { token: alice.token });
  assert.equal(ownSearch.data.users.some((user) => user.id === alice.user.id), true);
});

test('blocking prevents profile access and direct messages', async () => {
  await app.request('PATCH', '/api/privacy', {
    token: alice.token,
    body: { who_can_message: 'everyone' },
  });

  const conversation = await app.request('POST', '/api/conversations', {
    token: bob.token,
    body: { kind: 'dm', member_ids: [alice.user.id] },
  });
  assert.equal(conversation.status, 201);
  const conversationId = conversation.data.conversation.id;

  const blocked = await app.request('POST', `/api/blocks/${alice.user.id}`, { token: bob.token });
  assert.equal(blocked.status, 200);

  const profile = await app.request('GET', `/api/users/${alice.user.id}`, { token: bob.token });
  assert.equal(profile.status, 403);

  const message = await app.request('POST', `/api/conversations/${conversationId}/messages`, {
    token: bob.token,
    body: { kind: 'text', body: 'Tin nhắn bị chặn' },
  });
  assert.equal(message.status, 403);

  const unblocked = await app.request('DELETE', `/api/blocks/${alice.user.id}`, { token: bob.token });
  assert.equal(unblocked.status, 204);
});

test('auth endpoints enforce rate limiting per client address', async () => {
  let limited = null;
  for (let i = 0; i < 31; i += 1) {
    limited = await app.request('POST', '/api/auth/login', {
      headers: { 'X-Forwarded-For': '203.0.113.77' },
      body: { email: 'nobody@example.com', password: 'WrongPass123' },
    });
  }
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error.code, 'rate_limited');
});
