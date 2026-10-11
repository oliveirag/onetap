import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Queryable } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
export const SUPABASE_DIR = join(here, '..', 'supabase');
export const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');
export const SEED_FILE = join(SUPABASE_DIR, 'seed.sql');

export interface MigrationFile {
  version: string;
  name: string;
  path: string;
  sql: string;
}

export function listMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const [, version = '', name = ''] = /^(\d+)_(.+)\.sql$/.exec(f) ?? [];
      const path = join(MIGRATIONS_DIR, f);
      return { version, name, path, sql: readFileSync(path, 'utf8') };
    });
}

/** Multi-statement SQL executor (simple query protocol). */
export interface SqlExec {
  exec(sql: string): Promise<void>;
}

/**
 * Applies pending migrations, tracking them in supabase_migrations.schema_migrations
 * (the same table the Supabase CLI uses, so `supabase migration list` stays accurate).
 */
export async function applyMigrations(db: Queryable, runner: SqlExec): Promise<string[]> {
  await runner.exec(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text
    );`);
  const { rows } = await db.query<{ version: string }>('select version from supabase_migrations.schema_migrations');
  const done = new Set(rows.map((r) => r.version));
  const applied: string[] = [];
  for (const m of listMigrations()) {
    if (done.has(m.version)) continue;
    await runner.exec(`begin;\n${m.sql}\ncommit;`);
    await db.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)', [
      m.version,
      m.name,
      [m.sql],
    ]);
    applied.push(`${m.version}_${m.name}`);
  }
  return applied;
}

export async function applySeed(_db: Queryable, runner: SqlExec): Promise<void> {
  await runner.exec(readFileSync(SEED_FILE, 'utf8'));
}
