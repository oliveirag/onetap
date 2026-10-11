import { describe, expect, it } from 'vitest';
import type { Database } from '@reclaimed/database';
import { createFunding, createUser, fundingRow, setup } from './helpers.js';

async function plaidCreditAccount(db: Database, userId: string) {
  const item = (await db.query<{ id: string }>(
    `insert into plaid_items (user_id, plaid_item_id, access_token_ciphertext, institution_name) values ($1, $2, 'v1:x', 'Citi') returning id`,
    [userId, `item-${Math.random()}`],
  )).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `insert into financial_accounts (user_id, plaid_item_id, plaid_account_id, name, type, subtype, current_balance_cents, credit_limit_cents)
     values ($1, $2, $3, 'Citi Double Cash', 'credit', 'credit card', 41_000, 500_000) returning id`.replace('41_000', '41000').replace('500_000', '500000'),
    [userId, item, `acc-${Math.random()}`],
  )).rows[0]!.id;
}

async function ctxWithAccounts() {
  const ctx = await setup();
  const user = await createUser(ctx.db);
  const account = await plaidCreditAccount(ctx.db, user);
  const checking = await createFunding(ctx.db, user, 'Mock Checking', { kind: 'DEPOSIT', balance: 100_000 });
  return { ctx, user, account, checking };
}

async function plaidBalance(db: Database, id: string) {
  return (await db.query<{ current_balance_cents: number }>('select current_balance_cents from financial_accounts where id = $1', [id])).rows[0]!
    .current_balance_cents;
}

describe('BillPaymentService (test mode)', () => {
  it('runs SUBMITTED → PROCESSING → COMPLETED without touching Plaid balances', async () => {
    const { ctx, user, account, checking } = await ctxWithAccounts();
    const { payment } = await ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 25_000, confirm: true, scenario: 'SUCCESS' }, 'bp-key-0001');
    expect(payment.state).toBe('SUBMITTED');
    expect(payment.testMode).toBe(true);
    expect((await fundingRow(ctx.db, checking)).pending_holds_cents).toBe(25_000);
    await ctx.billPay.tick(new Date(Date.now() + 1000));
    await ctx.billPay.tick(new Date(Date.now() + 2000));
    const after = await ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 25_000, confirm: true, scenario: 'SUCCESS' }, 'bp-key-0001');
    expect(after.replayed).toBe(true);
    expect(after.payment.state).toBe('COMPLETED');
    expect(after.payment.events.map((e) => e.state)).toEqual(['DRAFT', 'SUBMITTED', 'PROCESSING', 'COMPLETED']);
    expect(await fundingRow(ctx.db, checking)).toMatchObject({ pending_holds_cents: 0, current_balance_cents: 75_000 });
    expect(await plaidBalance(ctx.db, account)).toBe(41_000);
    expect(await ctx.ledger.findUnbalancedJournals(ctx.db)).toEqual([]);
  });

  it('rejects insufficient mock funds without creating a payment', async () => {
    const { ctx, user, account, checking } = await ctxWithAccounts();
    await expect(
      ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 100_001, confirm: true, scenario: 'SUCCESS' }, 'bp-key-nsf1'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect((await ctx.db.query('select 1 from bill_payment_intents')).rowCount).toBe(0);
  });

  it('rejects invalid amounts and non-credit targets', async () => {
    const { ctx, user, account, checking } = await ctxWithAccounts();
    await expect(
      ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 50, confirm: true, scenario: 'SUCCESS' }, null),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await ctx.db.query(`update financial_accounts set type = 'depository' where id = $1`, [account]);
    await expect(
      ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 5_000, confirm: true, scenario: 'SUCCESS' }, null),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('simulates a failed payment and releases the hold', async () => {
    const { ctx, user, account, checking } = await ctxWithAccounts();
    const { payment } = await ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 10_000, confirm: true, scenario: 'FAIL' }, null);
    await ctx.billPay.tick(new Date(Date.now() + 1000));
    await ctx.billPay.tick(new Date(Date.now() + 2000));
    const { rows } = await ctx.db.query<{ state: string; failure_reason: string }>('select state, failure_reason from bill_payment_intents where id = $1', [payment.id]);
    expect(rows[0]).toEqual({ state: 'FAILED', failure_reason: 'SIMULATED_ISSUER_REJECTION' });
    expect(await fundingRow(ctx.db, checking)).toMatchObject({ pending_holds_cents: 0, current_balance_cents: 100_000 });
  });

  it('simulates a returned payment after completion and restores funds', async () => {
    const { ctx, user, account, checking } = await ctxWithAccounts();
    const { payment } = await ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 10_000, confirm: true, scenario: 'RETURN' }, null);
    for (let i = 1; i <= 3; i++) await ctx.billPay.tick(new Date(Date.now() + i * 1000));
    const st = (await ctx.db.query<{ state: string }>('select state from bill_payment_intents where id = $1', [payment.id])).rows[0]!.state;
    expect(st).toBe('RETURNED');
    expect((await fundingRow(ctx.db, checking)).current_balance_cents).toBe(100_000);
    expect(await ctx.ledger.findUnbalancedJournals(ctx.db)).toEqual([]);
  });

  it('cancels a submitted payment but not a processing one', async () => {
    const { ctx, user, account, checking } = await ctxWithAccounts();
    const a = (await ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 1_000, confirm: true, scenario: 'SUCCESS' }, null)).payment;
    expect((await ctx.billPay.cancel(user, a.id)).state).toBe('CANCELED');
    expect((await fundingRow(ctx.db, checking)).pending_holds_cents).toBe(0);
    const b = (await ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 1_000, confirm: true, scenario: 'SUCCESS' }, null)).payment;
    await ctx.billPay.tick(new Date(Date.now() + 1000));
    await expect(ctx.billPay.cancel(user, b.id)).rejects.toMatchObject({ code: 'INVALID_PAYMENT_STATE' });
  });

  it('saves drafts and submits them later; other users cannot see them', async () => {
    const { ctx, user, account, checking } = await ctxWithAccounts();
    const draft = (await ctx.billPay.create(user, { financialAccountId: account, fundingAccountId: checking, amountCents: 2_000, confirm: false, scenario: 'SUCCESS' }, null)).payment;
    expect(draft.state).toBe('DRAFT');
    const other = await createUser(ctx.db);
    await expect(ctx.billPay.submit(other, draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await ctx.billPay.submit(user, draft.id)).state).toBe('SUBMITTED');
  });
});
