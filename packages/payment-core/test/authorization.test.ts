import { describe, expect, it } from 'vitest';
import { MockPaymentProcessor, canTransition, assertTransition } from '../src/index.js';
import { authInput, createCard, createFunding, createUser, fundingRow, setup, WALMART } from './helpers.js';

async function checkout(ctx: Awaited<ReturnType<typeof setup>>, amountCents = 10_000) {
  return ctx.lifecycle.createCheckout({ terminalId: ctx.terminalId, ...WALMART, amountCents });
}

describe('AuthorizationService', () => {
  it('approves a $100 Walmart purchase on the primary mock account and places a hold', async () => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi', { limit: 200_000 });
    const chase = await createFunding(ctx.db, user, 'Mock Chase');
    const card = await createCard(ctx.db, user, { primary: citi, secondary: chase });
    const txn = await checkout(ctx);

    const out = await ctx.auth.authorize(authInput(txn, card));
    expect(out.result).toBe('APPROVED');
    expect(out.transaction.state).toBe('AUTHORIZED');
    expect(out.transaction.fundingAccountName).toBe('Mock Citi');
    expect(out.authorization.fundingAttempts).toHaveLength(1);
    expect(out.authorization.latency.totalMs).toBeGreaterThanOrEqual(0);
    expect((await fundingRow(ctx.db, citi)).pending_holds_cents).toBe(10_000);
    expect(await ctx.ledger.findUnbalancedJournals(ctx.db)).toEqual([]);
  });

  it('declines a frozen card with CARD_FROZEN and no hold', async () => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi');
    const card = await createCard(ctx.db, user, { primary: citi, status: 'FROZEN' });
    const out = await ctx.auth.authorize(authInput(await checkout(ctx), card));
    expect(out.result).toBe('CARD_FROZEN');
    expect(out.transaction.state).toBe('DECLINED');
    expect((await fundingRow(ctx.db, citi)).pending_holds_cents).toBe(0);
  });

  it.each(['DISABLED', 'REVOKED', 'UNREGISTERED'])('declines a %s card as INVALID_CARD', async (status) => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi');
    const card = await createCard(ctx.db, user, { primary: citi, status });
    const out = await ctx.auth.authorize(authInput(await checkout(ctx), card));
    expect(out.result).toBe('INVALID_CARD');
  });

  it('declines an unknown card id as INVALID_CARD', async () => {
    const ctx = await setup();
    const out = await ctx.auth.authorize(authInput(await checkout(ctx), '00000000-0000-4000-8000-000000000000'));
    expect(out.result).toBe('INVALID_CARD');
    expect(out.transaction.state).toBe('DECLINED');
  });

  it('falls back from an insufficient primary to the secondary account', async () => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi', { limit: 5_000 });
    const chase = await createFunding(ctx.db, user, 'Mock Chase', { limit: 300_000 });
    const card = await createCard(ctx.db, user, { primary: citi, secondary: chase, fallback: true });
    const out = await ctx.auth.authorize(authInput(await checkout(ctx), card));
    expect(out.result).toBe('APPROVED');
    expect(out.transaction.fundingAccountName).toBe('Mock Chase');
    expect(out.authorization.fundingAttempts.map((a) => [a.fundingAccountName, a.result])).toEqual([
      ['Mock Citi', 'INSUFFICIENT_FUNDS'],
      ['Mock Chase', 'APPROVED'],
    ]);
    expect((await fundingRow(ctx.db, citi)).pending_holds_cents).toBe(0);
    expect((await fundingRow(ctx.db, chase)).pending_holds_cents).toBe(10_000);
  });

  it('returns INSUFFICIENT_FUNDS when fallback is disabled', async () => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi', { limit: 5_000 });
    const chase = await createFunding(ctx.db, user, 'Mock Chase');
    const card = await createCard(ctx.db, user, { primary: citi, secondary: chase, fallback: false });
    const out = await ctx.auth.authorize(authInput(await checkout(ctx), card));
    expect(out.result).toBe('INSUFFICIENT_FUNDS');
    expect(out.authorization.fundingAttempts).toHaveLength(1);
    expect((await fundingRow(ctx.db, chase)).pending_holds_cents).toBe(0);
  });

  it('falls back on processor NSF decline and releases the first hold', async () => {
    let calls = 0;
    const processor = new MockPaymentProcessor();
    processor.authorize = async () => {
      calls += 1;
      return calls === 1
        ? { approved: false, processorReference: 'P1', declineCode: 'INSUFFICIENT_FUNDS', declineReason: 'NSF' }
        : { approved: true, processorReference: 'P2' };
    };
    const ctx = await setup({ processor });
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi');
    const chase = await createFunding(ctx.db, user, 'Mock Chase');
    const card = await createCard(ctx.db, user, { primary: citi, secondary: chase });
    const out = await ctx.auth.authorize(authInput(await checkout(ctx), card));
    expect(out.result).toBe('APPROVED');
    expect(out.transaction.fundingAccountName).toBe('Mock Chase');
    expect((await fundingRow(ctx.db, citi)).pending_holds_cents).toBe(0);
    expect(await ctx.ledger.findUnbalancedJournals(ctx.db)).toEqual([]);
  });

  it('enforces per-transaction and daily limits', async () => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi', { limit: 1_000_000 });
    const card = await createCard(ctx.db, user, { primary: citi, perTxn: 5_000, daily: 14_000 });
    const big = await ctx.auth.authorize(authInput(await checkout(ctx, 6_000), card));
    expect(big).toMatchObject({ result: 'LIMIT_EXCEEDED' });
    expect(big.transaction.declineReason).toBe('PER_TRANSACTION_LIMIT');
    expect((await ctx.auth.authorize(authInput(await checkout(ctx, 5_000), card))).result).toBe('APPROVED');
    expect((await ctx.auth.authorize(authInput(await checkout(ctx, 5_000), card))).result).toBe('APPROVED');
    const third = await ctx.auth.authorize(authInput(await checkout(ctx, 5_000), card));
    expect(third.result).toBe('LIMIT_EXCEEDED');
    expect(third.transaction.declineReason).toBe('DAILY_LIMIT');
  });

  it('is idempotent: a repeated authorization for the same checkout replays without a second hold', async () => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi');
    const card = await createCard(ctx.db, user, { primary: citi });
    const txn = await checkout(ctx);
    const [a, b] = await Promise.all([ctx.auth.authorize(authInput(txn, card)), ctx.auth.authorize(authInput(txn, card))]);
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.replayed)).toHaveLength(1);
    expect(outcomes.every((o) => o.result === 'APPROVED')).toBe(true);
    expect((await fundingRow(ctx.db, citi)).pending_holds_cents).toBe(10_000);
  });

  it('times out a slow processor, releases the hold and fails the transaction', async () => {
    const ctx = await setup({ processor: new MockPaymentProcessor({ latencyMs: 500 }), timeoutMs: 50 });
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi');
    const card = await createCard(ctx.db, user, { primary: citi });
    const out = await ctx.auth.authorize(authInput(await checkout(ctx), card));
    expect(out.result).toBe('AUTHORIZATION_TIMEOUT');
    expect(out.transaction.state).toBe('FAILED');
    expect((await fundingRow(ctx.db, citi)).pending_holds_cents).toBe(0);
    expect(await ctx.ledger.findUnbalancedJournals(ctx.db)).toEqual([]);
  });

  it('rejects an expired checkout with AUTHORIZATION_TIMEOUT', async () => {
    const ctx = await setup({ checkoutTtlMs: 1 });
    const user = await createUser(ctx.db);
    const citi = await createFunding(ctx.db, user, 'Mock Citi');
    const card = await createCard(ctx.db, user, { primary: citi });
    const txn = await checkout(ctx);
    await new Promise((r) => setTimeout(r, 20));
    const out = await ctx.auth.authorize(authInput(txn, card));
    expect(out.result).toBe('AUTHORIZATION_TIMEOUT');
    expect(out.transaction.declineReason).toBe('CHECKOUT_EXPIRED');
  });

  it('rejects requests that do not match the pending checkout or terminal', async () => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    const card = await createCard(ctx.db, user, {});
    const txn = await checkout(ctx);
    await expect(ctx.auth.authorize({ ...authInput(txn, card), amountCents: 1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      ctx.auth.authorize({ ...authInput(txn, card), terminalId: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toMatchObject({ code: 'TERMINAL_AUTH_FAILED' });
  });

  it('declines when no funding account exists', async () => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    const card = await createCard(ctx.db, user, {});
    const out = await ctx.auth.authorize(authInput(await checkout(ctx), card));
    expect(out.result).toBe('DECLINED');
    expect(out.transaction.declineReason).toBe('NO_FUNDING_ACCOUNT_CONFIGURED');
  });

  it('uses the lowest-priority active account as the default when no primary is configured', async () => {
    const ctx = await setup();
    const user = await createUser(ctx.db);
    await createFunding(ctx.db, user, 'Mock Chase', { priority: 2 });
    await createFunding(ctx.db, user, 'Mock Citi', { priority: 1 });
    const card = await createCard(ctx.db, user, {});
    const out = await ctx.auth.authorize(authInput(await checkout(ctx), card));
    expect(out.transaction.fundingAccountName).toBe('Mock Citi');
  });

  it('allows only one open checkout per terminal', async () => {
    const ctx = await setup();
    await checkout(ctx);
    await expect(checkout(ctx)).rejects.toMatchObject({ code: 'TERMINAL_BUSY' });
  });
});

describe('payment state machine', () => {
  it('permits the documented transitions only', () => {
    expect(canTransition('CREATED', 'AUTHORIZATION_PENDING')).toBe(true);
    expect(canTransition('AUTHORIZED', 'CAPTURED')).toBe(true);
    expect(canTransition('CAPTURED', 'AUTHORIZED')).toBe(false);
    expect(canTransition('DECLINED', 'CAPTURED')).toBe(false);
    expect(canTransition('REFUNDED', 'PARTIALLY_REFUNDED')).toBe(false);
    expect(() => assertTransition('SETTLED', 'CAPTURED')).toThrow(/Cannot move/);
  });
});
