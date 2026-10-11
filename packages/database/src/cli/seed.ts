import pg from 'pg';
import { applySeed } from '../migrations.js';
import { createPgDatabase } from '../client.js';
import { upsertDevTerminal } from '../terminal-seed.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. For local Supabase use postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  process.exit(1);
}
const raw = new pg.Client({ connectionString: url });
await raw.connect();
const db = createPgDatabase(url, { max: 1 });
try {
  await applySeed(db, { exec: async (sql) => void (await raw.query(sql)) });
  const { rows } = await db.query<{ count: number }>('select count(*)::int as count from public.card_products');
  console.log(`card_products: ${rows[0]?.count} rows (idempotent upsert on product_slug)`);
  const code = process.env.TEST_TERMINAL_ID ?? 'TERM-DEV-001';
  const secret = process.env.TEST_TERMINAL_SECRET;
  if (secret) {
    const t = await upsertDevTerminal(db, { terminalCode: code, secret });
    console.log(`test terminal ${t.terminal_code} ready (${t.id})`);
  } else {
    console.warn('TEST_TERMINAL_SECRET not set — skipped dev terminal upsert.');
  }
} finally {
  await raw.end();
  await db.close();
}
