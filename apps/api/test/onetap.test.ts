import { describe, expect, it } from 'vitest';
import { bridgePost, createHarness, createUser, enrollCard, tap, terminalReq, type Harness } from './helpers.js';

const UID = '04A1B2C3D4E5F6';

async function cards(h: Harness, userId: string) {
  return (
    await h.db.query<{ id: string; display_name: string; last4: string; current_balance_cents: number; credit_limit_cents: number; slug: string; priority: number }>(
      `select m.id, m.display_name, m.last4, m.current_balance_cents, m.credit_limit_cents, p.product_slug as slug, m.priority
         from mock_funding_accounts m left join card_products p on p.id = m.card_product_id
        where m.user_id = $1 order by m.priority`,
      [userId],
    )
  ).rows;
}

describe('OneTap setup: connect test accounts (PRD F2 fallback)', () => {
  it('links a Plaid Sandbox test user and turns each credit card into a routable, pre-matched card', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const res = await h.http().post('/api/v1/onetap/connect-test-accounts').set(user.auth).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.source).toBe('plaid_sandbox');
    expect(h.plaid.sandboxCalls).toHaveLength(1);

    const rows = await cards(h, user.id);
    expect(rows.map((r) => [r.display_name, r.last4, r.slug, r.priority])).toEqual([
      ['American Express Gold Card', '1008', 'amex-gold', 1],
      ['Chase Sapphire Preferred', '4417', 'chase-sapphire-preferred', 2],
      ['Citi Custom Cash Card', '2290', 'citi-custom-cash', 3],
      ['Citi Double Cash Card', '7731', 'citi-double-cash', 4],
    ]);
    expect(rows[0]).toMatchObject({ current_balance_cents: 84_217, credit_limit_cents: 1_500_000 });
    expect(res.body.data.cardIds).toEqual(rows.map((r) => r.id));
    const profile = await h.db.query('select default_card_id from profiles where id = $1', [user.id]);
    expect(profile.rows[0]).toEqual({ default_card_id: rows[0]!.id });

    // Idempotent: a retry returns the same cards and links nothing new.
    const again = await h.http().post('/api/v1/onetap/connect-test-accounts').set(user.auth).send({});
    expect(again.body.data).toEqual({ source: 'existing', cardIds: res.body.data.cardIds });
    expect(h.plaid.sandboxCalls).toHaveLength(1);
  });

  it('creates the same cards directly when Plaid is not configured', async () => {
    const h = await createHarness({ env: { PLAID_TOKEN_ENCRYPTION_KEY: '' } });
    const user = await createUser(h.db);
    const res = await h.http().post('/api/v1/onetap/connect-test-accounts').set(user.auth).send({});
    expect(res.body.data.source).toBe('demo');
    expect((await cards(h, user.id)).map((r) => r.slug)).toEqual(['amex-gold', 'chase-sapphire-preferred', 'citi-custom-cash', 'citi-double-cash']);
  });

  it('requires a signed-in user', async () => {
    const h = await createHarness();
    expect((await h.http().post('/api/v1/onetap/connect-test-accounts').send({})).status).toBe(401);
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
    await h.http().post('/api/v1/onetap/connect-test-accounts').set(user.auth).send({});
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
      alternatives: 3,
    });
  });
});
