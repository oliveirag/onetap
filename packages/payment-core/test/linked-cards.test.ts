import { describe, expect, it } from 'vitest';
import type { Database } from '@reclaimed/database';
import { loadLinkedCardsForRewards } from '../src/index.js';
import { createFunding, createUser, setup } from './helpers.js';

async function item(db: Database, userId: string, institution: string, status = 'ACTIVE') {
  const { rows } = await db.query<{ id: string }>(
    `insert into plaid_items (user_id, plaid_item_id, access_token_ciphertext, institution_name, status)
     values ($1, $2, 'v1:x:y:z', $3, $4) returning id`,
    [userId, `item-${Math.random()}`, institution, status],
  );
  return rows[0]!.id;
}

async function account(db: Database, userId: string, itemId: string, name: string, opts: { type?: string; productSlug?: string; confirmed?: boolean } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into financial_accounts (user_id, plaid_item_id, plaid_account_id, name, mask, type, available_balance_cents, credit_limit_cents)
     values ($1, $2, $3, $4, '1234', $5, 400000, 500000) returning id`,
    [userId, itemId, `acc-${Math.random()}`, name, opts.type ?? 'credit'],
  );
  const id = rows[0]!.id;
  if (opts.productSlug) {
    await db.query(
      `insert into user_cards (user_id, financial_account_id, card_product_id, confirmed_by_user)
       select $1, $2, id, $4 from card_products where product_slug = $3`,
      [userId, id, opts.productSlug, opts.confirmed ?? true],
    );
  }
  return id;
}

describe('loadLinkedCardsForRewards', () => {
  it('exposes Plaid-linked credit cards with match confidence, health and mapped funding — and nothing else', async () => {
    const { db } = await setup();
    const user = await createUser(db);
    const other = await createUser(db);
    const citi = await item(db, user, 'Citibank Online');
    const chase = await item(db, user, 'Chase', 'LOGIN_REQUIRED');
    const gone = await item(db, user, 'Old Bank', 'REMOVED');

    const confirmed = await account(db, user, citi, 'Citi Double Cash', { productSlug: 'citi-double-cash', confirmed: true });
    const suggested = await account(db, user, citi, 'Citi Card', { productSlug: 'citi-double-cash', confirmed: false });
    const unmatched = await account(db, user, chase, 'Plaid Credit Card');
    await account(db, user, citi, 'Checking', { type: 'depository' });
    await account(db, user, gone, 'Removed Card');
    await account(db, other, await item(db, other, 'Citibank Online'), 'Someone else');

    const funding = await createFunding(db, user, 'Mock Citi');
    await db.query(`update mock_funding_accounts set card_product_id = (select id from card_products where product_slug = 'citi-double-cash') where id = $1`, [funding]);

    const cards = await loadLinkedCardsForRewards(db, user);
    const by = new Map(cards.map((c) => [c.financialAccountId, c]));
    expect(cards).toHaveLength(3);
    expect(by.get(confirmed)).toMatchObject({
      productMatch: 'CONFIRMED',
      cardProductSlug: 'citi-double-cash',
      connectionStatus: 'ACTIVE',
      availableCreditCents: 400000,
      creditLimitCents: 500000,
      mockFundingAccountIds: [funding],
      eligibleForRecommendations: true,
    });
    expect(by.get(suggested)).toMatchObject({ productMatch: 'SUGGESTED', eligibleForRecommendations: false });
    expect(by.get(unmatched)).toMatchObject({ productMatch: 'UNMATCHED', cardProductId: null, connectionStatus: 'LOGIN_REQUIRED', mockFundingAccountIds: [], eligibleForRecommendations: false });
    // No Plaid secrets or reward data leak through this interface.
    expect(JSON.stringify(cards)).not.toMatch(/v1:|access|reward|rate/i);
    await db.close();
  });
});
