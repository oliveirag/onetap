import { describe, expect, it } from 'vitest';
import type { Database } from '@reclaimed/database';
import { CategoryRoutingSelector, pointsEarned, rewardValueCents } from '../src/index.js';
import { authInput, createCard, createFunding, createUser, setup } from './helpers.js';

const STARBUCKS = { merchantId: 'MID-STARBUCKS-0001', merchantName: 'Starbucks', mcc: '5814', currency: 'USD' }; // dining
const WALMART = { merchantId: 'MID-WALMART-0001', merchantName: 'Walmart', mcc: '5310', currency: 'USD' }; // general
const SHELL = { merchantId: 'MID-SHELL-0001', merchantName: 'Shell', mcc: '5541', currency: 'USD' }; // gas

type Ctx = Awaited<ReturnType<typeof setup>>;

async function product(db: Database, slug: string) {
  return (await db.query<{ id: string }>('select id from card_products where product_slug = $1', [slug])).rows[0]!.id;
}

/** A credit card mapped to a catalog product, with a last four. */
async function card(ctx: Ctx, user: string, name: string, slug: string, opts: { priority?: number; limit?: number; last4?: string } = {}) {
  const id = await createFunding(ctx.db, user, name, { priority: opts.priority, limit: opts.limit });
  await ctx.db.query('update mock_funding_accounts set card_product_id = $2, last4 = $3 where id = $1', [
    id,
    await product(ctx.db, slug),
    opts.last4 ?? String(1000 + (opts.priority ?? 1)),
  ]);
  return id;
}

async function routed(ctx: Ctx, txnId: string) {
  return (
    await ctx.db.query<{
      funding_account_id: string;
      category_id: string;
      routing_mode: string;
      decision_reason: string;
      multiplier: string;
      points_earned: number;
      reward_value_cents: number;
      baseline_value_cents: number;
      best_value_cents: number;
      funding_account_last4: string;
      alternatives: { funding_account_id: string; name: string; last4: string; multiplier: number; value_cents: number }[];
    }>('select * from payment_transactions where id = $1', [txnId])
  ).rows[0]!;
}

async function pay(ctx: Ctx, merchant: typeof WALMART, amountCents: number, cardId: string) {
  const txn = await ctx.lifecycle.createCheckout({ terminalId: ctx.terminalId, ...merchant, amountCents });
  const out = await ctx.auth.authorize(authInput(txn, cardId));
  return { out, row: await routed(ctx, txn.id) };
}

describe('CategoryRoutingSelector', () => {
  it('routes dining to the card that earns the most and records the full decision', async () => {
    const ctx = await setup({ selector: new CategoryRoutingSelector() });
    const user = await createUser(ctx.db);
    const citi = await card(ctx, user, 'Citi Double Cash', 'citi-double-cash', { priority: 1, last4: '1111' }); // 2x dining
    const gold = await card(ctx, user, 'Amex Gold', 'amex-gold', { priority: 2, last4: '2222' }); // 4x dining
    const nfc = await createCard(ctx.db, user);

    const { out, row } = await pay(ctx, STARBUCKS, 2_500, nfc);
    expect(out.result).toBe('APPROVED');
    expect(row).toMatchObject({
      funding_account_id: gold,
      funding_account_last4: '2222',
      category_id: 'dining',
      routing_mode: 'auto',
      decision_reason: 'best_rate',
      points_earned: 100,
      reward_value_cents: 100, // $25 x 4 points x 1 cent
      baseline_value_cents: 50, // default card (lowest priority number): Citi 2x
      best_value_cents: 100,
    });
    expect(Number(row.multiplier)).toBe(4);
    expect(row.alternatives).toEqual([{ funding_account_id: citi, name: 'Citi Double Cash', last4: '1111', multiplier: 2, value_cents: 50 }]);
  });

  it('maps MCCs to categories and uses general for unlisted MCCs', async () => {
    const ctx = await setup({ selector: new CategoryRoutingSelector() });
    const user = await createUser(ctx.db);
    const custom = await card(ctx, user, 'Citi Custom Cash', 'citi-custom-cash', { priority: 1 }); // 5x gas, 1x else
    const dbl = await card(ctx, user, 'Citi Double Cash', 'citi-double-cash', { priority: 2 }); // 2x everything
    const nfc = await createCard(ctx.db, user);

    expect((await pay(ctx, SHELL, 1_000, nfc)).row).toMatchObject({ category_id: 'gas', funding_account_id: custom });
    expect((await pay(ctx, WALMART, 1_000, nfc)).row).toMatchObject({ category_id: 'general', funding_account_id: dbl });
    const unlisted = await pay(ctx, { ...WALMART, mcc: '9999' }, 1_000, nfc);
    expect(unlisted.row).toMatchObject({ category_id: 'general', funding_account_id: dbl });
  });

  it('breaks a tie with the user card order and says so', async () => {
    const ctx = await setup({ selector: new CategoryRoutingSelector() });
    const user = await createUser(ctx.db);
    await card(ctx, user, 'Venture X', 'capital-one-venture-x', { priority: 2 }); // 2x general
    const first = await card(ctx, user, 'Double Cash', 'citi-double-cash', { priority: 1 }); // 2x general
    const nfc = await createCard(ctx.db, user);
    expect((await pay(ctx, WALMART, 1_000, nfc)).row).toMatchObject({ funding_account_id: first, decision_reason: 'tie_priority' });
  });

  it('manual mode always uses the chosen card and compares it with what Auto would have earned', async () => {
    const ctx = await setup({ selector: new CategoryRoutingSelector() });
    const user = await createUser(ctx.db);
    const citi = await card(ctx, user, 'Citi Double Cash', 'citi-double-cash', { priority: 1 });
    await card(ctx, user, 'Amex Gold', 'amex-gold', { priority: 2 });
    await ctx.db.query(`update profiles set routing_mode = 'manual', manual_card_id = $2 where id = $1`, [user, citi]);
    const nfc = await createCard(ctx.db, user);

    const { row } = await pay(ctx, STARBUCKS, 2_500, nfc);
    expect(row).toMatchObject({ funding_account_id: citi, routing_mode: 'manual', decision_reason: 'manual', reward_value_cents: 50, best_value_cents: 100 });
  });

  it('falls back to the next best card when the best one cannot fund the purchase', async () => {
    const ctx = await setup({ selector: new CategoryRoutingSelector() });
    const user = await createUser(ctx.db);
    const citi = await card(ctx, user, 'Citi Double Cash', 'citi-double-cash', { priority: 1 });
    await card(ctx, user, 'Amex Gold', 'amex-gold', { priority: 2, limit: 1_000 }); // best for dining, but only $10 of credit
    const nfc = await createCard(ctx.db, user);

    const { out, row } = await pay(ctx, STARBUCKS, 2_500, nfc);
    expect(out.result).toBe('APPROVED');
    expect(out.authorization.fundingAttempts.map((a) => a.result)).toEqual(['INSUFFICIENT_FUNDS', 'APPROVED']);
    expect(row).toMatchObject({ funding_account_id: citi, decision_reason: 'fallback_default', reward_value_cents: 50, best_value_cents: 100 });
  });

  it('uses the profile default card as the baseline', async () => {
    const ctx = await setup({ selector: new CategoryRoutingSelector() });
    const user = await createUser(ctx.db);
    await card(ctx, user, 'Amex Gold', 'amex-gold', { priority: 1 });
    const flex = await card(ctx, user, 'Freedom Flex', 'chase-freedom-flex', { priority: 2 }); // 1x groceries
    await ctx.db.query('update profiles set default_card_id = $2 where id = $1', [user, flex]);
    const nfc = await createCard(ctx.db, user);
    const groceries = { merchantId: 'MID-WHOLEFOODS-0001', merchantName: 'Whole Foods Market', mcc: '5411', currency: 'USD' };
    expect((await pay(ctx, groceries, 10_000, nfc)).row).toMatchObject({ reward_value_cents: 400, baseline_value_cents: 100 });
  });

  it('writes no routing fields on a decline and ignores deposit accounts', async () => {
    const ctx = await setup({ selector: new CategoryRoutingSelector() });
    const user = await createUser(ctx.db);
    await createFunding(ctx.db, user, 'Mock Checking', { kind: 'DEPOSIT', balance: 500_000 });
    await card(ctx, user, 'Amex Gold', 'amex-gold', { limit: 1_000 });
    const nfc = await createCard(ctx.db, user);
    const { out, row } = await pay(ctx, STARBUCKS, 2_500, nfc);
    expect(out.result).toBe('INSUFFICIENT_FUNDS');
    expect(row).toMatchObject({ decision_reason: null, category_id: null, funding_account_id: null });
  });

  it('falls back to the configured primary account for a user with no credit cards', async () => {
    const ctx = await setup({ selector: new CategoryRoutingSelector() });
    const user = await createUser(ctx.db);
    const checking = await createFunding(ctx.db, user, 'Mock Checking', { kind: 'DEPOSIT', balance: 500_000 });
    const nfc = await createCard(ctx.db, user, { primary: checking });
    const { out, row } = await pay(ctx, WALMART, 1_000, nfc);
    expect(out.result).toBe('APPROVED');
    expect(row).toMatchObject({ funding_account_id: checking, decision_reason: null });
  });
});

describe('reward math', () => {
  it('computes integer cents and points', () => {
    expect(rewardValueCents(2_500, 4, 1)).toBe(100);
    expect(rewardValueCents(1_999, 1.5, 1)).toBe(30);
    expect(rewardValueCents(10_000, 2, 1.25)).toBe(250);
    expect(pointsEarned(1_999, 1.5)).toBe(30);
  });
});
