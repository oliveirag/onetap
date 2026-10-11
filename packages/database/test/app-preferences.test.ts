import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../src/pglite.js';
import type { Database } from '../src/client.js';

// The OneTap app writes a few columns directly with the user's JWT (20261010200100_app_preferences.sql).

async function seedUsers(db: Database) {
  const ids: { user: string; card: string }[] = [];
  for (const email of ['u1@x.com', 'u2@x.com']) {
    const user = (await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])).rows[0]!.id;
    const card = (
      await db.query<{ id: string }>(
        `insert into mock_funding_accounts (user_id, display_name, fictional_issuer, credit_limit_cents) values ($1, 'Card', 'Bank', 1000) returning id`,
        [user],
      )
    ).rows[0]!.id;
    ids.push({ user, card });
  }
  return ids as [{ user: string; card: string }, { user: string; card: string }];
}

/** Runs one statement as an authenticated user; returns rows touched or the error message. */
async function asUser(db: Database, userId: string, sql: string, params: unknown[] = []): Promise<number | string> {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      await tx.query('set local role authenticated');
      return (await tx.query(sql, params)).rowCount;
    });
  } catch (e) {
    return String(e);
  }
}

describe('app preferences: column-level writes for the signed-in user', () => {
  it('lets a user set their routing mode, manual card and default card', async () => {
    const db = await createTestDatabase();
    const [a] = await seedUsers(db);
    expect(
      await asUser(db, a.user, `update profiles set routing_mode = 'manual', manual_card_id = $2, default_card_id = $2 where id = $1`, [a.user, a.card]),
    ).toBe(1);
    const p = await db.query('select routing_mode, manual_card_id, default_card_id from profiles where id = $1', [a.user]);
    expect(p.rows[0]).toEqual({ routing_mode: 'manual', manual_card_id: a.card, default_card_id: a.card });
    await db.close();
  });

  it("rejects pointing a profile at another user's card", async () => {
    const db = await createTestDatabase();
    const [a, b] = await seedUsers(db);
    expect(await asUser(db, a.user, 'update profiles set manual_card_id = $2 where id = $1', [a.user, b.card])).toMatch(/one of the user's cards/);
    await db.close();
  });

  it('lets a user reorder and re-match only their own cards', async () => {
    const db = await createTestDatabase();
    const [a, b] = await seedUsers(db);
    const product = (await db.query<{ id: string }>(`select id from card_products where product_slug = 'amex-gold'`)).rows[0]!.id;
    expect(
      await asUser(db, a.user, `update mock_funding_accounts set priority = 3, card_product_id = $2, match_source = 'user' where id = $1`, [a.card, product]),
    ).toBe(1);
    // RLS hides the other user's row: the update matches nothing.
    expect(await asUser(db, a.user, 'update mock_funding_accounts set priority = 5 where id = $1', [b.card])).toBe(0);
    const rows = await db.query('select id, priority, match_source from mock_funding_accounts order by priority');
    expect(rows.rows).toEqual([
      { id: a.card, priority: 3, match_source: 'user' },
      { id: b.card, priority: 10, match_source: 'auto' },
    ]);
    await db.close();
  });

  it('keeps balances, status and other profile columns read-only, and blocks inserts and deletes', async () => {
    const db = await createTestDatabase();
    const [a] = await seedUsers(db);
    expect(await asUser(db, a.user, 'update mock_funding_accounts set credit_limit_cents = 99999999 where id = $1', [a.card])).toMatch(/permission denied/);
    expect(await asUser(db, a.user, `update mock_funding_accounts set status = 'CLOSED' where id = $1`, [a.card])).toMatch(/permission denied/);
    expect(await asUser(db, a.user, `update profiles set status = 'SUSPENDED' where id = $1`, [a.user])).toMatch(/permission denied/);
    expect(await asUser(db, a.user, 'delete from mock_funding_accounts where id = $1', [a.card])).toMatch(/permission denied/);
    expect(
      await asUser(db, a.user, `insert into mock_funding_accounts (user_id, display_name, fictional_issuer) values ($1, 'X', 'Y')`, [a.user]),
    ).toMatch(/permission denied/);
    await db.close();
  });

  it('exposes the routing reference data read-only', async () => {
    const db = await createTestDatabase();
    const [a] = await seedUsers(db);
    expect(await asUser(db, a.user, 'select 1 from card_product_rates')).toBe(66);
    expect(await asUser(db, a.user, `select 1 from mcc_map where mcc = '5814' and category_id = 'dining'`)).toBe(1);
    expect(await asUser(db, a.user, `update card_product_rates set multiplier = 10`)).toBe(0);
    await db.close();
  });
});
