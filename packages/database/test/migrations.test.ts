import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, SUPABASE_TEST_BOOTSTRAP_SQL, wrapPglite } from '../src/pglite.js';
import { applyMigrations, applySeed } from '../src/migrations.js';
import { PG_PARSERS } from '../src/client.js';
import { upsertDevTerminal } from '../src/terminal-seed.js';

describe('migrations and seed', () => {
  it('applies every migration and seeds exactly 10 card products plus the generic Other card', async () => {
    const db = await createTestDatabase();
    const { rows } = await db.query<{ product_slug: string; card_network: string }>(
      'select product_slug, card_network from card_products where not is_generic order by product_slug',
    );
    expect(rows).toHaveLength(10);
    const generic = await db.query<{ product_slug: string }>('select product_slug from card_products where is_generic');
    expect(generic.rows).toEqual([{ product_slug: 'other-card' }]);
    expect(rows.find((r) => r.product_slug === 'citi-double-cash')?.card_network).toBe('MASTERCARD');
    expect(rows.find((r) => r.product_slug === 'amex-gold')?.card_network).toBe('AMEX');
    await db.close();
  });

  it('is idempotent: re-running migrations and the seed creates no duplicates', async () => {
    const pg = new PGlite({ parsers: PG_PARSERS });
    await pg.exec(SUPABASE_TEST_BOOTSTRAP_SQL);
    const db = wrapPglite(pg);
    const exec = { exec: (sql: string) => pg.exec(sql).then(() => undefined) };
    expect((await applyMigrations(db, exec)).length).toBeGreaterThan(5);
    expect(await applyMigrations(db, exec)).toEqual([]);
    await applySeed(db, exec);
    const before = await db.query<{ id: string; product_slug: string }>('select id, product_slug from card_products order by 2');
    expect(before.rows).toHaveLength(11);
    await applySeed(db, exec);
    await applySeed(db, exec);
    const after = await db.query<{ id: string; product_slug: string }>('select id, product_slug from card_products order by 2');
    expect(after.rows).toHaveLength(11);
    // Stable identifiers across re-seeds (Phase 2 depends on this).
    expect(after.rows).toEqual(before.rows);
    await db.close();
  });

  it('rejects duplicate card products via unique constraints', async () => {
    const db = await createTestDatabase();
    await expect(
      db.query(
        `insert into card_products (issuer_name, product_name, product_slug, card_network)
         values ('Citi', 'Citi Double Cash', 'citi-double-cash-2', 'MASTERCARD')`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);
    await db.close();
  });

  it('creates a profile and settings row when an auth user is created', async () => {
    const db = await createTestDatabase();
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ('a@example.com', '{"full_name":"Ada"}') returning id`,
    );
    const p = await db.query<{ full_name: string }>('select full_name from profiles where id = $1', [rows[0]!.id]);
    expect(p.rows[0]?.full_name).toBe('Ada');
    const s = await db.query('select 1 from user_settings where user_id = $1', [rows[0]!.id]);
    expect(s.rowCount).toBe(1);
    await db.close();
  });

  it('enforces RLS: an authenticated user reads only their own rows and cannot read secrets', async () => {
    const db = await createTestDatabase();
    const u1 = (await db.query<{ id: string }>(`insert into auth.users (email) values ('u1@x.com') returning id`)).rows[0]!.id;
    const u2 = (await db.query<{ id: string }>(`insert into auth.users (email) values ('u2@x.com') returning id`)).rows[0]!.id;
    for (const u of [u1, u2]) {
      await db.query(
        `insert into mock_funding_accounts (user_id, display_name, fictional_issuer, credit_limit_cents) values ($1, 'Mock', 'Mock Bank', 1000)`,
        [u],
      );
    }
    const asUser = await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u1]);
      await tx.query('set local role authenticated');
      const own = await tx.query<{ user_id: string }>('select user_id from mock_funding_accounts');
      const products = await tx.query('select 1 from card_products');
      let secretError: unknown = null;
      try {
        await tx.query('select 1 from plaid_items');
      } catch (e) {
        secretError = e;
      }
      return { own: own.rows, products: products.rowCount, secretError };
    });
    expect(asUser.own).toEqual([{ user_id: u1 }]);
    expect(asUser.products).toBe(11);
    expect(String(asUser.secretError)).toMatch(/permission denied/i);
    await db.close();
  });

  it('rejects unbalanced ledger journals at commit and blocks ledger mutation', async () => {
    const db = await createTestDatabase();
    await db.query(`insert into ledger_accounts (code, name, account_type) values ('A','A','ASSET'), ('B','B','LIABILITY')`);
    await expect(
      db.transaction(async (tx) => {
        const j = (await tx.query<{ id: string }>(
          `insert into ledger_journals (journal_type, description, idempotency_key) values ('CAPTURE','x','k1') returning id`,
        )).rows[0]!.id;
        await tx.query(
          `insert into ledger_entries (journal_id, ledger_account_id, direction, amount_cents)
           select $1, id, 'DEBIT', 100 from ledger_accounts where code = 'A'`,
          [j],
        );
      }),
    ).rejects.toThrow(/unbalanced/);
    const count = await db.query('select 1 from ledger_journals');
    expect(count.rowCount).toBe(0);
    await db.close();
  });

  it('enforces payment state transitions in the database', async () => {
    const db = await createTestDatabase();
    const t = await upsertDevTerminal(db, { terminalCode: 'T1', secret: 'secret-secret' });
    const p = (await db.query<{ id: string }>(
      `insert into payment_transactions (reference, terminal_id, merchant_id, merchant_name, mcc, amount_cents, expires_at)
       values ('R1', $1, 'M', 'Walmart', '5310', 100, now() + interval '1 minute') returning id`,
      [t.id],
    )).rows[0]!.id;
    await expect(db.query(`update payment_transactions set state = 'SETTLED' where id = $1`, [p])).rejects.toThrow(
      /Invalid payment state transition/,
    );
    await db.query(`update payment_transactions set state = 'AUTHORIZATION_PENDING' where id = $1`, [p]);
    await db.close();
  });

  it('lets client roles only read Plaid-reported tables and never touch Plaid secrets', async () => {
    const pg = new PGlite({ parsers: PG_PARSERS });
    await pg.exec(SUPABASE_TEST_BOOTSTRAP_SQL);
    // Hosted Supabase grants everything on new public tables to client roles by default.
    await pg.exec('alter default privileges in schema public grant all on tables to anon, authenticated');
    const db = wrapPglite(pg);
    await applyMigrations(db, { exec: (sql: string) => pg.exec(sql).then(() => undefined) });
    const can = async (role: string, table: string, priv: string) =>
      (await db.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [role, `public.${table}`, priv])).rows[0]!.ok;
    for (const t of ['financial_accounts', 'account_liabilities', 'transactions', 'user_cards']) {
      expect(await can('authenticated', t, 'SELECT')).toBe(true);
      for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(await can('authenticated', t, p)).toBe(false);
      expect(await can('anon', t, 'SELECT')).toBe(false);
    }
    for (const t of ['plaid_items', 'plaid_sync_state']) {
      for (const role of ['anon', 'authenticated']) expect(await can(role, t, 'SELECT')).toBe(false);
    }
    await db.close();
  });
});
