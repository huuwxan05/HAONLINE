import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, get, now } from './db.js';
import { attachUser } from './lib/auth.js';
import { ApiError } from './lib/errors.js';
import { stripeWebhookHandler } from './routes/monetization.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import postRoutes from './routes/posts.js';
import mediaRoutes from './routes/media.js';
import messageRoutes from './routes/messages.js';
import communityRoutes from './routes/communities.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import marketplaceRoutes from './routes/marketplace.js';
import accountRoutes from './routes/account.js';
import moderationRoutes from './routes/moderation.js';
import analyticsRoutes from './routes/analytics.js';
import monetizationRoutes from './routes/monetization.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
    if (!req.path.startsWith('/api')) {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "connect-src 'self' https: wss:",
        "font-src 'self' data:",
        "frame-ancestors 'self'",
        "base-uri 'self'",
      ].join('; '));
    }
    next();
  });

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = config.corsOrigins.length === 0 || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*');
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Filename, X-Session-Token');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '86400');
      }
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.post('/api/monetization/webhook/stripe', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhookHandler);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  const startedAt = Date.now();
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (config.env !== 'test') {
        const line = `[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`;
        if (res.statusCode >= 500) console.error(line);
        else if (!req.originalUrl.startsWith('/uploads') && !req.originalUrl.includes('.')) console.log(line);
      }
    });
    next();
  });

  app.use(attachUser);

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api') || req.path === '/api/health' || req.path === '/api/version') return next();
    const maintenance = get("SELECT value FROM app_settings WHERE key = 'maintenance_mode'");
    if (maintenance && maintenance.value === 'true' && req.path !== '/api/auth/login' && req.path !== '/api/auth/me') {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(503).json({ error: { code: 'maintenance', message: 'HAONLINE đang bảo trì, vui lòng quay lại sau' } });
      }
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    let integrity = 'unknown';
    try {
      integrity = get('PRAGMA integrity_check').integrity_check;
    } catch (err) {
      integrity = `error: ${err.message}`;
    }
    res.json({
      status: integrity === 'ok' ? 'ok' : 'degraded',
      version: config.version,
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      database: integrity,
      time: now(),
    });
  });

  app.get('/api/version', (_req, res) => {
    res.json({ name: 'HAONLINE', version: config.version, api: 'v1', env: config.env });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', userRoutes);
  app.use('/api', postRoutes);
  app.use('/api', mediaRoutes);
  app.use('/api', messageRoutes);
  app.use('/api', communityRoutes);
  app.use('/api', notificationRoutes);
  app.use('/api', searchRoutes);
  app.use('/api', marketplaceRoutes);
  app.use('/api', accountRoutes);
  app.use('/api', moderationRoutes);
  app.use('/api', analyticsRoutes);
  app.use('/api', monetizationRoutes);
  app.use('/api', adminRoutes);

  app.use('/api', (req, _res, next) => {
    next(new ApiError(404, 'not_found', `Không tìm thấy API ${req.method} ${req.originalUrl}`));
  });

  app.use('/uploads', express.static(config.uploadsDir, {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=604800, immutable'),
  }));

  app.use(express.static(config.webDir, {
    index: 'index.html',
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    if (!req.accepts('html')) return next();
    const file = path.join(config.webDir, 'index.html');
    if (!fs.existsSync(file)) return res.status(404).send('Web build not found. Run npm run web:build');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(file);
  });

  app.use((err, req, res, _next) => {
    let status = 500;
    let code = 'internal_error';
    let message = 'Đã xảy ra lỗi, vui lòng thử lại';
    let details = null;
    if (err instanceof ApiError) {
      status = err.status;
      code = err.code;
      message = err.message;
      details = err.details;
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      code = 'invalid_json';
      message = 'JSON không hợp lệ';
    } else if (err.type === 'entity.too.large') {
      status = 413;
      code = 'payload_too_large';
      message = 'Dữ liệu gửi lên quá lớn';
    } else if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      status = 409;
      code = 'conflict';
      message = 'Dữ liệu đã tồn tại';
    }
    if (status >= 500) {
      console.error(`[error] ${req.method} ${req.originalUrl}`, err);
      try {
        db.prepare('INSERT INTO error_logs (id, level, message, stack, context, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), 'error', String(err.message || err), String(err.stack || '').slice(0, 8000),
            JSON.stringify({ path: req.originalUrl, method: req.method, user_id: req.user?.user_id || null, request_id: req.requestId }), now());
      } catch {
        // logging must not throw
      }
    }
    res.status(status).json({
      error: {
        code,
        message,
        details: config.isProd && status >= 500 ? null : details,
        request_id: req.requestId,
      },
    });
  });

  return app;
}
