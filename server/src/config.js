import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '../..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, '.env'));

const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
const inferredPublicUrl = process.env.RENDER_EXTERNAL_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
  || (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : '');

export const config = {
  root,
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8080),
  publicUrl: (process.env.PUBLIC_URL || inferredPublicUrl || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, ''),
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'haonline.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  backupDir: path.join(dataDir, 'backups'),
  webDir: path.resolve(root, process.env.WEB_DIR || 'web'),
  secret: process.env.APP_SECRET || 'dev-only-insecure-secret-change-me',
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 200),
  mail: {
    devMode: (process.env.MAIL_DEV_MODE ?? 'true') !== 'false',
    from: process.env.MAIL_FROM || 'no-reply@haonline.local',
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: (process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@haonline.local',
  },
  payments: {
    stripeSecret: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    currency: process.env.PAYMENT_CURRENCY || 'USD',
  },
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  version: '1.0.0',
};

if (config.isProd && config.secret === 'dev-only-insecure-secret-change-me') {
  throw new Error('APP_SECRET must be set to a strong random value in production');
}

for (const dir of [config.dataDir, config.uploadsDir, config.backupDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
