import { describe, expect, it } from 'vitest';
import type { PlaidAccount } from '../src/integrations/plaid/gateway.js';
import { CITI_CHECKING, CITI_DC, PLATYPUS_CC } from './fake-plaid.js';
import { bridgePost, createHarness, createUser, enrollCard, tap, terminalReq, type Harness } from './helpers.js';

const UID = '04A1B2C3D4E5F6';

// Test data: what Plaid would report for the user's accounts.
const AMEX_GOLD: PlaidAccount = { ...CITI_DC, accountId: 'acc-amex-gold', name: 'Gold Card', officialName: 'American Express Gold Card', mask: '1008', current: 842.17, available: 14_157.83, limit: 15_000 };
const SAPPHIRE: PlaidAccount = { ...CITI_DC, accountId: 'acc-csp', name: 'Chase Sapphire Preferred', officialName: null, mask: '4417', current: 1_240.5, available: null, limit: 10_000 };

/** Plaid Link + exchange, as the app does before calling /onetap/connect-cards. */
async function link(h: Harness, user: { auth: Record<string, string> }, accounts: PlaidAccount[], institutionId = 'ins_platypus') {
  const res = await h.http().post('/api/v1/plaid/exchange-token').set(user.auth).send({ publicToken: h.plaid.addInstitution({ institutionId, accounts }) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function cards(h: Harness, userId: string) {
  return (
    await h.db.query<{ id: string; display_name: string; last4: string | null; current_balance_cents: number; credit_limit_cents: number; slug: string; priority: number; fictional_issuer: string }>(
      `select m.id, m.display_name, m.last4, m.current_balance_cents, m.credit_limit_cents, p.product_slug as slug, m.priority, m.fictional_issuer
         from mock_funding_accounts m left join card_products p on p.id = m.card_product_id
        where m.user_id = $1 order by m.priority`,
      [userId],
    )
  ).rows;
}

describe('OneTap setup: connect cards from Plaid', () => {
  it('turns each connected credit account into a routable card using only what Plaid reports', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    await link(h, user, [AMEX_GOLD, SAPPHIRE, CITI_DC, PLATYPUS_CC, CITI_CHECKING]);
    const res = await h.http().post('/api/v1/onetap/connect-cards').set(user.auth).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = await cards(h, user.id);
    expect(rows.map((r) => [r.display_name, r.last4, r.slug, r.current_balance_cents, r.credit_limit_cents])).toEqual([
      ['American Express Gold Card', '1008', 'amex-gold', 84_217, 1_500_000],
      ['Chase Sapphire Preferred', '4417', 'chase-sapphire-preferred', 124_050, 1_000_000],
      ['Citi Double Cash Card', '4321', 'citi-double-cash', 41_055, 500_000],
      // No catalog match: routes as the generic Other card (1x).
      ['Plaid Diamond 12.5% APR Interest Credit Card', '3333', 'other-card', 41_000, 200_000],
    ]); // the checking account is not a card
    expect(rows.every((r) => r.fictional_issuer === 'First Platypus Bank')).toBe(true);
    expect(res.body.data.cardIds).toEqual(rows.map((r) => r.id));
    const profile = await h.db.query('select default_card_id from profiles where id = $1', [user.id]);
    expect(profile.rows[0]).toEqual({ default_card_id: rows[0]!.id });
  });

  it('is idempotent and refreshes balances from Plaid on reconnect', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    await link(h, user, [AMEX_GOLD]);
    const first = (await h.http().post('/api/v1/onetap/connect-cards').set(user.auth).send({})).body.data;
    await h.db.query(`update financial_accounts set current_balance_cents = 5000 where plaid_account_id = 'acc-amex-gold'`);
    const again = (await h.http().post('/api/v1/onetap/connect-cards').set(user.auth).send({})).body.data;
    expect(again).toEqual(first);
    const rows = await cards(h, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.current_balance_cents).toBe(5_000);

    // A second bank adds its cards after the existing ones.
    await link(h, user, [SAPPHIRE], 'ins_chase');
    const more = (await h.http().post('/api/v1/onetap/connect-cards').set(user.auth).send({})).body.data;
    expect(more.cardIds).toHaveLength(2);
    expect(more.cardIds[0]).toBe(first.cardIds[0]);
  });

  it('says so when no connected account is a credit card', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    expect((await h.http().post('/api/v1/onetap/connect-cards').set(user.auth).send({})).body.error.code).toBe('NO_CREDIT_CARDS_CONNECTED');
    await link(h, user, [CITI_CHECKING]);
    const res = await h.http().post('/api/v1/onetap/connect-cards').set(user.auth).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_CREDIT_CARDS_CONNECTED');
    expect(await cards(h, user.id)).toEqual([]);
  });

  it('requires a signed-in user', async () => {
    const h = await createHarness();
    expect((await h.http().post('/api/v1/onetap/connect-cards').send({})).status).toBe(401);
  });
});

describe('OneTap setup: link the physical card', () => {
  it('waits for the NFC card to be tapped and returns only its last four', async () => {
    const h = await createHarness({ env: { ONETAP_ENROLL_WAIT_MS: '5000' } });
    const user = await createUser(h.db);
    const pending = h.http().post('/api/v1/onetap/card').set(user.auth).send({}).then((r) => r);
    let enrolled = { body: { data: { outcome: '' } } };
    for (let i = 0; i < 40 && enrolled.body.data?.outcome !== 'ENROLLED'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      enrolled = await bridgePost(h, '/hardware/tap-events', tap(UID));
    }
    expect(enrolled.body.data.outcome).toBe('ENROLLED');
    const res = await pending;
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ state: 'open', last4: expect.stringMatching(/^[0-9A-Z]{4}$/) });
    expect(Object.keys(res.body.data).sort()).toEqual(['id', 'last4', 'state']);

    // Already linked: answers at once.
    const again = await h.http().post('/api/v1/onetap/card').set(user.auth).send({});
    expect(again.body.data).toEqual(res.body.data);
  });

  it('reports a paused card after it is frozen', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const cardId = await enrollCard(h, user, UID);
    await h.http().patch(`/api/v1/reclaimed-cards/${cardId}/status`).set(user.auth).send({ status: 'FROZEN' });
    expect((await h.http().post('/api/v1/onetap/card').set(user.auth).send({})).body.data).toMatchObject({ id: cardId, state: 'paused' });
  });

  it('times out with a clear, retryable error when no card is tapped', async () => {
    const h = await createHarness({ env: { ONETAP_ENROLL_WAIT_MS: '1000' } });
    const user = await createUser(h.db);
    const res = await h.http().post('/api/v1/onetap/card').set(user.auth).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'NFC_ENROLLMENT_TIMEOUT', retryable: true });
    const open = await h.db.query(`select 1 from nfc_enrollments where user_id = $1 and status = 'PENDING'`, [user.id]);
    expect(open.rowCount).toBe(0);
  });
});

describe('OneTap end to end: tap at the terminal routes by category', () => {
  it('routes a Starbucks purchase to Amex Gold (4x dining) and stores the receipt fields', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    await link(h, user, [AMEX_GOLD, CITI_DC]);
    await h.http().post('/api/v1/onetap/connect-cards').set(user.auth).send({});
    await enrollCard(h, user, UID);

    const checkout = await terminalReq(h, 'POST', '/test-terminal/transactions', {
      merchantId: 'MID-STARBUCKS-0001',
      merchantName: 'Starbucks',
      mcc: '5814',
      amountCents: 1_250,
      currency: 'USD',
    });
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(201);
    const t = await bridgePost(h, '/hardware/tap-events', tap(UID, { presentedAt: new Date(Date.now() + 5000).toISOString() }));
    expect(t.body.data.authorization.result, JSON.stringify(t.body)).toBe('APPROVED');

    const row = (
      await h.db.query<Record<string, unknown>>(
        `select state, funding_account_name, funding_account_last4, category_id, routing_mode, decision_reason,
                multiplier::float8 as multiplier, points_earned, reward_value_cents, baseline_value_cents, best_value_cents,
                jsonb_array_length(alternatives) as alternatives
           from payment_transactions where id = $1`,
        [checkout.body.data.id],
      )
    ).rows[0];
    expect(row).toEqual({
      state: 'AUTHORIZED',
      funding_account_name: 'American Express Gold Card',
      funding_account_last4: '1008',
      category_id: 'dining',
      routing_mode: 'auto',
      decision_reason: 'best_rate',
      multiplier: 4,
      points_earned: 50,
      reward_value_cents: 50,
      baseline_value_cents: 50, // the default card is Amex Gold too
      best_value_cents: 50,
      alternatives: 1,
    });
  });
});
