import { PGlite } from '@electric-sql/pglite';
import { PG_PARSERS, type Database, type Queryable } from './client.js';
import { applyMigrations, applySeed } from './migrations.js';

/**
 * Minimal stand-ins for the pieces of Supabase that our migrations reference
 * (auth.users, auth.uid(), the anon/authenticated/service_role roles, the supabase_realtime publication).
 * Used ONLY for automated tests with PGlite; real environments use Supabase.
 */
export const SUPABASE_TEST_BOOTSTRAP_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists extensions;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$fn$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
-- Supabase creates this publication; migrations add tables to it for Realtime.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
`;

export function wrapPglite(pg: PGlite): Database {
  const wrap = (q: Pick<PGlite, 'query'>): Queryable => ({
    async query<T>(text: string, params?: unknown[]) {
      const res = await q.query<T>(text, params as unknown[]);
      return { rows: res.rows, rowCount: res.fields.length > 0 ? res.rows.length : (res.affectedRows ?? 0) };
    },
  });
  return {
    ...wrap(pg),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return pg.transaction(async (tx) => fn(wrap(tx)));
    },
    async close() {
      await pg.close();
    },
  };
}

/** Fresh in-memory Postgres with all Reclaimed migrations (and optionally the seed) applied. */
export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<Database> {
  const pg = new PGlite({ parsers: PG_PARSERS });
  await pg.exec(SUPABASE_TEST_BOOTSTRAP_SQL);
  const db = wrapPglite(pg);
  await applyMigrations(db, { exec: (sql) => pg.exec(sql).then(() => undefined) });
  if (options.seed ?? true) await applySeed(db, { exec: (sql) => pg.exec(sql).then(() => undefined) });
  return db;
}
