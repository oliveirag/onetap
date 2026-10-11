import pg from 'pg';
import { applyMigrations } from '../migrations.js';
import { createPgDatabase } from '../client.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. For local Supabase use postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  process.exit(1);
}
const raw = new pg.Client({ connectionString: url });
await raw.connect();
const db = createPgDatabase(url, { max: 1 });
try {
  const applied = await applyMigrations(db, { exec: async (sql) => void (await raw.query(sql)) });
  console.log(applied.length ? `Applied:\n  ${applied.join('\n  ')}` : 'Database is up to date.');
} finally {
  await raw.end();
  await db.close();
}
