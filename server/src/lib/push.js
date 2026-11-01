import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, db } from '../db.js';

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function vapidKeys() {
  if (!config.vapid.privateKey) return null;
  const d = Buffer.from(config.vapid.privateKey, 'base64url');
  if (d.length !== 32) return null;
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const publicKey = ecdh.getPublicKey();
  const key = crypto.createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256', d: b64url(d),
      x: b64url(publicKey.subarray(1, 33)), y: b64url(publicKey.subarray(33, 65)),
    },
    format: 'jwk',
  });
  return { key, publicKey: b64url(publicKey) };
}

function vapidHeaders(endpoint, keys) {
  let audience;
  try {
    audience = new URL(endpoint).origin;
  } catch {
    return null;
  }
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: config.vapid.subject,
  }));
  const data = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(data), { key: keys.key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64url(signature)}, k=${keys.publicKey}`;
}

// Payload-less Web Push: wakes the service worker, which fetches /api/notifications.
// Encrypted payload delivery would require ECDH+AES128GCM encryption of the body.
export async function sendPushToUser(userId) {
  if (!config.vapid.privateKey) return { delivered: 0, skipped: 'vapid_not_configured' };
  const keys = vapidKeys();
  if (!keys) return { delivered: 0, skipped: 'invalid_vapid_key' };
  const subs = all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
  let delivered = 0;
  for (const sub of subs) {
    const authorization = vapidHeaders(sub.endpoint, keys);
    if (!authorization) continue;
    try {
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: { TTL: '60', Authorization: authorization, 'Content-Length': '0' },
      });
      if (res.ok) delivered += 1;
      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      }
    } catch (err) {
      console.error(`[push] delivery failed: ${err.message}`);
    }
  }
  return { delivered };
}

export function pushStatus() {
  return {
    configured: Boolean(config.vapid.privateKey && config.vapid.publicKey),
    public_key: config.vapid.publicKey || null,
  };
}
