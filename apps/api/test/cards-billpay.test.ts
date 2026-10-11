import { describe, expect, it } from 'vitest';
import { createHarness, createUser, fundingSetup, type Harness } from './helpers.js';
import { CHASE_GENERIC, CITI_DC } from './fake-plaid.js';

async function linked(h: Harness, accounts = [CITI_DC], institutionId = 'ins_citi') {
  const user = await createUser(h.db);
  await h.http().post('/api/v1/plaid/exchange-token').set(user.auth).send({ publicToken: h.plaid.addInstitution({ institutionId, accounts }) });
  const acct = (await h.http().get('/api/v1/accounts?type=credit').set(user.auth)).body.data[0];
  return { user, acct };
}

describe('Demo D — seeded card products', () => {
  it('searches the 10 seeded products', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    expect((await h.http().get('/api/v1/card-products').set(user.auth)).body.data).toHaveLength(10);
    const citi = (await h.http().get('/api/v1/card-products?search=double').set(user.auth)).body.data;
    expect(citi.map((p: { productName: string }) => p.productName)).toEqual(['Citi Double Cash']);
    expect((await h.http().get('/api/v1/card-products?search=amex').set(user.auth)).body.data).toHaveLength(2);
  });

  it('flags ambiguous issuer-only matches and lets the user confirm; two users share one product row', async () => {
    const h = await createHarness();
    const a = await linked(h, [CHASE_GENERIC], 'ins_chase');
    const m = (await h.http().get(`/api/v1/accounts/${a.acct.id}/card-product-matches`).set(a.user.auth)).body.data;
    expect(m.ambiguous).toBe(true);
    expect(m.matches.map((x: { product: { issuerName: string } }) => x.product.issuerName)).toEqual(['Chase', 'Chase', 'Chase']);
    expect(a.acct.cardProduct).toBeNull();

    const products = (await h.http().get('/api/v1/card-products?search=double cash').set(a.user.auth)).body.data;
    const dc = products[0].id;
    // Correct/confirm (the product choice is the user's).
    const b = await linked(h);
    for (const u of [a, b]) {
      const res = await h.http().put(`/api/v1/accounts/${u.acct.id}/card-product`).set(u.user.auth).send({ cardProductId: dc });
      expect(res.body.data).toMatchObject({ cardProductConfirmed: true, cardProduct: { id: dc, productName: 'Citi Double Cash' } });
    }
    expect((await h.db.query('select count(*)::int as n from card_products where not is_generic')).rows[0]).toEqual({ n: 10 });
    expect((await h.db.query('select count(distinct card_product_id)::int as n from user_cards')).rows[0]).toEqual({ n: 1 });
    // Persisted.
    expect((await h.http().get(`/api/v1/accounts/${b.acct.id}`).set(b.user.auth)).body.data.cardProduct.productSlug).toBe('citi-double-cash');
    // Users cannot touch each other's accounts.
    expect((await h.http().put(`/api/v1/accounts/${a.acct.id}/card-product`).set(b.user.auth).send({ cardProductId: dc })).status).toBe(404);
  });
});

describe('Demo C — bill payments (TEST MODE)', () => {
  it('submits, progresses and records a simulated payment without changing the Plaid balance', async () => {
    const h = await createHarness({ env: { BILL_PAY_STEP_MS: '0' } });
    const { user, acct } = await linked(h);
    const setup = await fundingSetup(h, user);
    const checking = setup.funding.find((f) => f.displayName === 'Mock Checking')!;
    const res = await h.http().post('/api/v1/bill-pay/payments').set(user.auth).set('idempotency-key', 'billpay-0001').send({ financialAccountId: acct.id, fundingAccountId: checking.id, amountCents: 5_000 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ state: 'SUBMITTED', testMode: true });
    const dup = await h.http().post('/api/v1/bill-pay/payments').set(user.auth).set('idempotency-key', 'billpay-0001').send({ financialAccountId: acct.id, fundingAccountId: checking.id, amountCents: 5_000 });
    expect(dup.status).toBe(200);
    expect(dup.body.data.id).toBe(res.body.data.id);
    await h.ctx.services.billPay.tick(new Date(Date.now() + 1000));
    await h.ctx.services.billPay.tick(new Date(Date.now() + 2000));
    const p = (await h.http().get(`/api/v1/bill-pay/payments/${res.body.data.id}`).set(user.auth)).body.data;
    expect(p.state).toBe('COMPLETED');
    expect((await h.http().get('/api/v1/bill-pay/payments').set(user.auth)).body.data.items).toHaveLength(1);
    expect((await h.http().get(`/api/v1/accounts/${acct.id}`).set(user.auth)).body.data.currentBalanceCents).toBe(41055);
  });

  it('rejects insufficient funds and invalid amounts', async () => {
    const h = await createHarness();
    const { user, acct } = await linked(h);
    const f = (await h.http().post('/api/v1/mock-funding-accounts').set(user.auth).send({ displayName: 'Mock Checking', fictionalIssuer: 'Mock', kind: 'DEPOSIT', limitOrBalanceCents: 1_000 })).body.data;
    const nsf = await h.http().post('/api/v1/bill-pay/payments').set(user.auth).send({ financialAccountId: acct.id, fundingAccountId: f.id, amountCents: 2_000 });
    expect(nsf.status).toBe(402);
    expect(nsf.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await h.http().post('/api/v1/bill-pay/payments').set(user.auth).send({ financialAccountId: acct.id, fundingAccountId: f.id, amountCents: -5 })).status).toBe(400);
  });
});
