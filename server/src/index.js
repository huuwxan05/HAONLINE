import { createApp } from './app.js';
import { migrate } from './db.js';
import { config } from './config.js';

migrate();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`[haonline] ${config.version} listening on ${config.publicUrl} (${config.host}:${config.port})`);
  console.log(`[haonline] env=${config.env} data=${config.dataDir}`);
  if (!config.isProd) {
    console.log('[haonline] dev mode: email codes are returned in API responses and stored in email_outbox');
  }
});

function shutdown(signal) {
  console.log(`[haonline] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('[haonline] unhandled rejection', err);
});
process.on('uncaughtException', (err) => {
  console.error('[haonline] uncaught exception', err);
});

export { app, server };
