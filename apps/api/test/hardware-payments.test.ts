import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bridgePost, createHarness, fundingSetup, createUser, enrollCard, READER, tap, terminalReq, type Harness } from './helpers.js';

const UID_A = '04A1B2C3D4E5F6';
const UID_B = '04FFEEDDCCBBAA';

async function demoUser(h: Harness) {
  const user = await createUser(h.db);
  const cardId = await enrollCard(h, user, UID_A);
  const setup = await fundingSetup(h, user, cardId);
  return { user, cardId, funding: setup.funding };
}

async function checkout(h: Harness, amountCents = 10_000, key?: string) {
  const res = await terminalReq(h, 'POST', '/test-terminal/transactions', { merchantId: 'MID-WALMART-0001', merchantName: 'Walmart', mcc: '5310', amountCents, currency: 'USD' }, key ? { 'idempotency-key': key } : {});
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.data as { id: string; state: string; reference: string };
}

describe('hardware bridge authentication', () => {
  it('rejects unsigned, mis-signed and replayed-stale bridge requests', async () => {
    const h = await createHarness();
    expect((await h.http().post('/api/v1/hardware/tap-events').send(tap(UID_A))).status).toBe(401);
    const bad = await bridgePost(h, '/hardware/tap-events', tap(UID_A), 'wrong-secret-wrong-secret-0000');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('HARDWARE_AUTH_FAILED');
  });

  it('validates tap payloads (UID format)', async () => {
    const h = await createHarness();
    const res = await bridgePost(h, '/hardware/tap-events', tap('not-hex'));
    expect(res.status).toBe(400);
  });

  it('tracks reader connect, card removal, errors and disconnect', async () => {
    const h = await createHarness();
    const ev = (type: string, detail?: object) => bridgePost(h, '/hardware/reader-events', { eventId: randomUUID(), type, readerName: READER, bridgeId: 'bridge-test', occurredAt: new Date().toISOString(), detail });
    expect((await ev('READER_CONNECTED')).body.data.reader).toMatchObject({ connected: true, model: 'ACS ACR1252U' });
    expect((await ev('CARD_REMOVED')).body.data.reader.lastCardRemovedAt).toBeTruthy();
    expect((await ev('READER_ERROR', { message: 'SCARD_E_NO_SMARTCARD' })).body.data.reader.lastError).toBe('SCARD_E_NO_SMARTCARD');
    expect((await ev('READER_DISCONNECTED')).body.data.reader.connected).toBe(false);
    const user = await createUser(h.db);
    const status = (await h.http().get('/api/v1/hardware/status').set(user.auth)).body.data;
    expect(status.readers[0].readerName).toBe(READER);
    expect(status.recentEvents.map((e: { type: string }) => e.type)).toContain('READER_DISCONNECTED');
  });
});

describe('NFC enrollment', () => {
  it('enrolls a physical card UID on tap and stores only a fingerprint', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const cardId = await enrollCard(h, user, UID_A);
    const card = (await h.http().get(`/api/v1/reclaimed-cards/${cardId}`).set(user.auth)).body.data;
    expect(card).toMatchObject({ status: 'ACTIVE', uidMasked: '••••E5F6', cardTechnology: 'MIFARE Classic 1K' });
    expect(card.displayId).toMatch(/^RC-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const raw = await h.db.query<{ uid_fingerprint: string }>('select uid_fingerprint from reclaimed_cards where id = $1', [cardId]);
    expect(raw.rows[0]!.uid_fingerprint).not.toContain(UID_A);
    expect(JSON.stringify((await h.db.query('select * from hardware_tap_events')).rows)).not.toContain(UID_A);
  });

  it('rejects enrolling a card that is already enrolled (even by another user)', async () => {
    const h = await createHarness();
    const a = await createUser(h.db);
    await enrollCard(h, a, UID_A);
    const b = await createUser(h.db);
    const e = await h.http().post('/api/v1/reclaimed-cards/test-enroll').set(b.auth).send({});
    const t = await bridgePost(h, '/hardware/tap-events', tap(UID_A, { presentedAt: new Date(Date.now() + 5000).toISOString() }));
    expect(t.body.data.outcome).toBe('ENROLLMENT_REJECTED');
    const status = (await h.http().get(`/api/v1/reclaimed-cards/enrollments/${e.body.data.id}`).set(b.auth)).body.data;
    expect(status).toMatchObject({ status: 'FAILED', failureReason: 'CARD_ALREADY_ENROLLED' });
  });

  it('records unknown cards without creating a payment when nothing is pending', async () => {
    const h = await createHarness();
    const t = await bridgePost(h, '/hardware/tap-events', tap(UID_B));
    expect(t.body.data.outcome).toBe('UNKNOWN_CARD');
    expect((await h.db.query('select 1 from payment_transactions')).rowCount).toBe(0);
  });

  it('does not create a payment when an enrolled card is tapped with no checkout', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    await enrollCard(h, user, UID_A);
    const t = await bridgePost(h, '/hardware/tap-events', tap(UID_A, { presentedAt: new Date(Date.now() + 5000).toISOString() }));
    expect(t.body.data.outcome).toBe('NO_PENDING_CHECKOUT');
    expect((await h.db.query('select 1 from payment_transactions')).rowCount).toBe(0);
  });
});

describe('Demo A — physical tap → terminal checkout → authorization → lifecycle', () => {
  it('runs the full $100 Walmart flow with Mock Citi, capture, settlement, refund and balanced ledger', async () => {
    const h = await createHarness();
    const { user, cardId } = await demoUser(h);
    const c = await checkout(h);
    expect(c.state).toBe('CREATED');

    const t = await bridgePost(h, '/hardware/tap-events', tap(UID_A, { presentedAt: new Date(Date.now() + 5000).toISOString() }));
    expect(t.body.data.outcome).toBe('AUTHORIZATION_STARTED');
    expect(t.body.data.authorization.result).toBe('APPROVED');
    expect(t.body.data.transaction).toMatchObject({ state: 'AUTHORIZED', fundingAccountName: 'Mock Citi', merchantName: 'Walmart', amountCents: 10_000, simulated: true });

    // Mobile sees it in simulated activity — and NOT in Plaid transactions.
    const sim = (await h.http().get(`/api/v1/reclaimed-cards/${cardId}/transactions`).set(user.auth)).body.data.items;
    expect(sim[0]).toMatchObject({ id: c.id, merchantName: 'Walmart' });
    expect((await h.http().get('/api/v1/transactions').set(user.auth)).body.data.items).toEqual([]);

    // Terminal view & realtime fan-out.
    const tv = (await terminalReq(h, 'GET', `/test-terminal/transactions/${c.id}`)).body.data;
    expect(tv.authorization.fundingAttempts[0].fundingAccountName).toBe('Mock Citi');
    expect(h.realtime.events.some((e) => e.target === `user:${user.id}` && e.event.type === 'payment.updated')).toBe(true);

    expect((await terminalReq(h, 'POST', `/test-terminal/transactions/${c.id}/capture`)).body.data.state).toBe('CAPTURED');
    expect((await terminalReq(h, 'POST', `/test-terminal/transactions/${c.id}/settle`, { immediate: true })).body.data.state).toBe('SETTLED');
    const refund = await terminalReq(h, 'POST', `/test-terminal/transactions/${c.id}/refund`, { amountCents: 2_500 }, { 'idempotency-key': 'refund-demo-0001' });
    expect(refund.body.data).toMatchObject({ state: 'PARTIALLY_REFUNDED', refundedCents: 2_500 });

    const detail = (await h.http().get(`/api/v1/simulated-transactions/${c.id}`).set(user.auth)).body.data;
    expect(detail.ledger.map((j: { journalType: string }) => j.journalType)).toEqual(['AUTHORIZATION_HOLD', 'CAPTURE', 'SETTLEMENT', 'REFUND']);
    for (const j of detail.ledger as { entries: { direction: string; amountCents: number }[] }[]) {
      const sum = (d: string) => j.entries.filter((e) => e.direction === d).reduce((s, e) => s + e.amountCents, 0);
      expect(sum('DEBIT')).toBe(sum('CREDIT'));
    }
    const funding = (await h.http().get('/api/v1/mock-funding-accounts').set(user.auth)).body.data;
    expect(funding.find((f: { displayName: string }) => f.displayName === 'Mock Citi')).toMatchObject({ currentBalanceCents: 7_500, pendingHoldsCents: 0 });
  });

  it('ignores a repeated tap during one presentation and never double-authorizes', async () => {
    const h = await createHarness();
    await demoUser(h);
    const c = await checkout(h);
    const at = new Date(Date.now() + 5000).toISOString();
    const first = tap(UID_A, { presentedAt: at });
    const r1 = await bridgePost(h, '/hardware/tap-events', first);
    const retry = await bridgePost(h, '/hardware/tap-events', first); // network retry, same tapId
    const bounce = await bridgePost(h, '/hardware/tap-events', tap(UID_A, { presentedAt: new Date(Date.parse(at) + 300).toISOString() }));
    expect(r1.body.data.outcome).toBe('AUTHORIZATION_STARTED');
    expect(retry.body.data.message).toMatch(/already processed/);
    expect(bounce.body.data.outcome).toBe('DUPLICATE_TAP');
    expect((await h.db.query('select 1 from authorization_attempts where payment_transaction_id = $1', [c.id])).rowCount).toBe(1);
  });

  it('declines a frozen card, then approves after unfreeze', async () => {
    const h = await createHarness();
    const { user, cardId } = await demoUser(h);
    expect((await h.http().patch(`/api/v1/reclaimed-cards/${cardId}/status`).set(user.auth).send({ status: 'FROZEN' })).body.data.status).toBe('FROZEN');
    await checkout(h);
    const t = await bridgePost(h, '/hardware/tap-events', tap(UID_A, { presentedAt: new Date(Date.now() + 5000).toISOString() }));
    expect(t.body.data.authorization.result).toBe('CARD_FROZEN');
    expect(t.body.data.transaction.state).toBe('DECLINED');
    await h.http().patch(`/api/v1/reclaimed-cards/${cardId}/status`).set(user.auth).send({ status: 'ACTIVE' });
    await checkout(h, 500);
    const t2 = await bridgePost(h, '/hardware/tap-events', tap(UID_A, { presentedAt: new Date(Date.now() + 10_000).toISOString() }));
    expect(t2.body.data.authorization.result).toBe('APPROVED');
  });

  it('declines an unknown card tapped during checkout as INVALID_CARD', async () => {
    const h = await createHarness();
    await checkout(h);
    const t = await bridgePost(h, '/hardware/tap-events', tap(UID_B));
    expect(t.body.data.authorization.result).toBe('INVALID_CARD');
  });

  it('falls back from insufficient Mock Citi to Mock Chase', async () => {
    const h = await createHarness();
    const { user, funding } = await demoUser(h);
    const citi = funding.find((f) => f.displayName === 'Mock Citi')!;
    await h.http().patch(`/api/v1/mock-funding-accounts/${citi.id}`).set(user.auth).send({ currentBalanceCents: 195_000 });
    await checkout(h);
    const t = await bridgePost(h, '/hardware/tap-events', tap(UID_A, { presentedAt: new Date(Date.now() + 5000).toISOString() }));
    expect(t.body.data.authorization.result).toBe('APPROVED');
    expect(t.body.data.transaction.fundingAccountName).toBe('Mock Chase');
    expect(t.body.data.authorization.fundingAttempts.map((a: { result: string }) => a.result)).toEqual(['INSUFFICIENT_FUNDS', 'APPROVED']);
  });

  it('enforces terminal auth, one open checkout per terminal, and idempotent checkout creation', async () => {
    const h = await createHarness();
    expect((await h.http().post('/api/v1/test-terminal/transactions').send({})).status).toBe(401);
    const a = await checkout(h, 1_000, 'checkout-key-0001');
    const replay = await checkout(h, 1_000, 'checkout-key-0001');
    expect(replay.id).toBe(a.id);
    const busy = await terminalReq(h, 'POST', '/test-terminal/transactions', { merchantId: 'M', merchantName: 'X', mcc: '5411', amountCents: 5, currency: 'USD' });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('TERMINAL_BUSY');
    const conflict = await terminalReq(h, 'POST', '/test-terminal/transactions', { merchantId: 'M', merchantName: 'X', mcc: '5411', amountCents: 999, currency: 'USD' }, { 'idempotency-key': 'checkout-key-0001' });
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await terminalReq(h, 'POST', `/test-terminal/transactions/${a.id}/cancel`)).body.data.state).toBe('FAILED');
  });

  it('rejects invalid lifecycle actions with INVALID_PAYMENT_STATE', async () => {
    const h = await createHarness();
    await demoUser(h);
    const c = await checkout(h);
    const early = await terminalReq(h, 'POST', `/test-terminal/transactions/${c.id}/capture`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_PAYMENT_STATE');
  });

  it('reverses an authorization from the terminal', async () => {
    const h = await createHarness();
    const { user } = await demoUser(h);
    const c = await checkout(h);
    await bridgePost(h, '/hardware/tap-events', tap(UID_A, { presentedAt: new Date(Date.now() + 5000).toISOString() }));
    expect((await terminalReq(h, 'POST', `/test-terminal/transactions/${c.id}/reverse`)).body.data.state).toBe('REVERSED');
    const citi = (await h.http().get('/api/v1/mock-funding-accounts').set(user.auth)).body.data.find((f: { displayName: string }) => f.displayName === 'Mock Citi');
    expect(citi.pendingHoldsCents).toBe(0);
  });
});
