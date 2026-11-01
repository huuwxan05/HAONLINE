import { migrate, db } from './db.js';

migrate();
const applied = db.prepare('SELECT name, applied_at FROM schema_migrations ORDER BY name').all();
for (const row of applied) console.log(`${row.name}  ${row.applied_at}`);
console.log(`[db] ${applied.length} migration(s) applied`);
