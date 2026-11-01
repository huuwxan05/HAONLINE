import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { backup } from 'node:sqlite';
import { config } from './config.js';
import { db, migrate, now } from './db.js';

migrate();

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(config.backupDir, `haonline-${stamp}.db`);
await backup(db, target);

let size = fs.existsSync(target) ? fs.statSync(target).size : 0;
db.prepare('INSERT INTO backup_log (id, path, size, status, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(crypto.randomUUID(), target, size, 'completed', now());
console.log(`[backup] database -> ${target} (${size} bytes)`);

if (process.argv.includes('--full')) {
  const uploadsTarget = path.join(config.backupDir, `uploads-${stamp}.tar.gz`);
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('tar', ['-czf', uploadsTarget, '-C', config.dataDir, 'uploads'], { stdio: 'inherit' });
  if (result.status === 0) console.log(`[backup] uploads -> ${uploadsTarget}`);
  else console.error('[backup] tar failed; uploads were not archived');
} else {
  console.log('[backup] uploads not included (use --full to archive media too)');
}
