import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../src/pglite.js';
import type { Database } from '../src/client.js';

// card_spending (20261010200300): purchases on connected credit cards, in OneTap categories.

async function userWithCards(db: Database, email: string) {
  const user = (await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])).rows[0]!.id;
  const item = (
    await db.query<{ id: string }>(`insert into plaid_items (user_id, plaid_item_id, access_token_ciphertext) values ($1, $2, 'x') returning id`, [user, `item-${email}`])
  ).rows[0]!.id;
  const account = async (name: string, type: string) =>
    (
      await db.query<{ id: string }>(
        `insert into financial_accounts (user_id, plaid_item_id, plaid_account_id, name, mask, type) values ($1, $2, $3, $4, '1234', $5) returning id`,
        [user, item, `${email}-${name}`, name, type],
      )
    ).rows[0]!.id;
  return { user, credit: await account('Gold Card', 'credit'), checking: await account('Checking', 'depository') };
}

async function txn(db: Database, user: string, account: string, id: string, cents: number, category: string | null, detailed: string | null) {
  await db.query(
    `insert into transactions (user_id, financial_account_id, plaid_transaction_id, name, amount_cents, date, category, category_detailed)
     values ($1, $2, $3, $3, $4, current_date, $5, $6)`,
    [user, account, id, cents, category, detailed],
  );
}

async function asUser<T>(db: Database, userId: string, sql: string): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.query('set local role authenticated');
    return (await tx.query<T>(sql)).rows;
  });
}

describe('card_spending view', () => {
  it('maps Plaid categories (detailed first) and keeps only purchases on credit cards', async () => {
    const db = await createTestDatabase();
    const a = await userWithCards(db, 'a@x.com');
    await txn(db, a.user, a.credit, 'groceries', 5_000, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES');
    await txn(db, a.user, a.credit, 'coffee', 450, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE'); // primary fallback: dining
    await txn(db, a.user, a.credit, 'gas', 4_000, 'TRANSPORTATION', 'TRANSPORTATION_GAS');
    await txn(db, a.user, a.credit, 'netflix', 1_549, 'ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES');
    await txn(db, a.user, a.credit, 'flight', 30_000, 'TRAVEL', 'TRAVEL_FLIGHTS');
    await txn(db, a.user, a.credit, 'shoes', 8_000, 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_CLOTHING');
    await txn(db, a.user, a.credit, 'unknown', 100, null, null);
    await txn(db, a.user, a.credit, 'payment', -20_000, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'); // money in
    await txn(db, a.user, a.credit, 'refund', -450, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE');
    await txn(db, a.user, a.credit, 'transfer', 1_000, 'TRANSFER_OUT', 'TRANSFER_OUT_ACCOUNT_TRANSFER');
    await txn(db, a.user, a.checking, 'rent', 150_000, 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_RENT'); // not a card

    const rows = await asUser<{ merchant: string; category_id: string; amount_cents: number; account_name: string }>(
      db,
      a.user,
      'select merchant, category_id, amount_cents, account_name from card_spending order by merchant',
    );
    expect(rows.map((r) => [r.merchant, r.category_id])).toEqual([
      ['coffee', 'dining'],
      ['flight', 'travel'],
      ['gas', 'gas'],
      ['groceries', 'groceries'],
      ['netflix', 'streaming'],
      ['shoes', 'general'],
      ['unknown', 'general'],
    ]);
    expect(rows.every((r) => r.account_name === 'Gold Card')).toBe(true);
    await db.close();
  });

  it("shows a user only their own spending", async () => {
    const db = await createTestDatabase();
    const a = await userWithCards(db, 'a@x.com');
    const b = await userWithCards(db, 'b@x.com');
    await txn(db, a.user, a.credit, 'mine', 1_000, 'FOOD_AND_DRINK', null);
    await txn(db, b.user, b.credit, 'theirs', 2_000, 'FOOD_AND_DRINK', null);
    expect(await asUser(db, a.user, 'select merchant from card_spending')).toEqual([{ merchant: 'mine' }]);
    await db.close();
  });
});
