import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LithicSandboxProcessor, LithicSdkGateway, type LithicGateway } from '../src/integrations/lithic/lithic.js';
import { bridgePost, createHarness, createUser, enrollCard, fundingSetup, tap, terminalReq } from './helpers.js';

const ASA_SECRET = `whsec_${randomBytes(24).toString('base64')}`;

function standardWebhookHeaders(secret: string, body: string) {
  const id = `msg_${randomUUID()}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
}

/** Fake Lithic sandbox: records calls; signature checks use the REAL SDK verifier. */
class FakeLithic implements LithicGateway {
  readonly real = new LithicSdkGateway('test-api-key-not-used');
  calls: string[] = [];
  nextResult = 'APPROVED';
  async createVirtualCard() {
    this.calls.push('createVirtualCard');
    return { token: `card_${randomUUID()}`, lastFour: '0001' };
  }
  async simulateAuthorization(a: { cardToken: string; amountCents: number }) {
    this.calls.push(`simulateAuthorization:${a.amountCents}`);
    return { token: `txn_${randomUUID()}` };
  }
  async getTransaction(token: string) {
    return { token, status: this.nextResult === 'APPROVED' ? 'PENDING' : 'DECLINED', result: this.nextResult };
  }
  async simulateClearing(_t: string, amount: number) {
    this.calls.push(`simulateClearing:${amount}`);
  }
  async simulateVoid(_t: string, amount: number) {
    this.calls.push(`simulateVoid:${amount}`);
  }
  async simulateReturn(a: { amountCents: number }) {
    this.calls.push(`simulateReturn:${a.amountCents}`);
    return { token: `ret_${randomUUID()}` };
  }
  verifySignature(raw: string, headers: Record<string, string>, secret: string) {
    this.real.verifySignature(raw, headers, secret);
  }
}

describe('Lithic Sandbox adapter (mocked network, real signature verification)', () => {
  it('maps a card, authorizes via simulateAuthorization, clears and returns', async () => {
    const lithic = new FakeLithic();
    const h = await createHarness({ lithic, processor: new LithicSandboxProcessor(lithic), env: { PAYMENT_MODE: 'lithic_sandbox', LITHIC_ASA_SECRET: ASA_SECRET } });
    const user = await createUser(h.db);
    const cardId = await enrollCard(h, user, '04AABBCCDDEE11');
    await fundingSetup(h, user, cardId);
    const mapped = await h.http().post(`/api/v1/reclaimed-cards/${cardId}/lithic-card`).set(user.auth);
    expect(mapped.body.data.lithicSandboxMapped).toBe(true);

    const c = (await terminalReq(h, 'POST', '/test-terminal/transactions', { merchantId: 'MID-WALMART-0001', merchantName: 'Walmart', mcc: '5310', amountCents: 10_000, currency: 'USD' })).body.data;
    const t = await bridgePost(h, '/hardware/tap-events', tap('04AABBCCDDEE11', { presentedAt: new Date(Date.now() + 5000).toISOString() }));
    expect(t.body.data.authorization).toMatchObject({ result: 'APPROVED', processor: 'lithic_sandbox' });
    await terminalReq(h, 'POST', `/test-terminal/transactions/${c.id}/capture`);
    await terminalReq(h, 'POST', `/test-terminal/transactions/${c.id}/refund`, {}, { 'idempotency-key': 'lithic-refund-1' });
    expect(lithic.calls).toEqual(['createVirtualCard', 'simulateAuthorization:10000', 'simulateClearing:10000', 'simulateReturn:10000']);
  });

  it('maps a Lithic decline to a Reclaimed decline and releases the hold', async () => {
    const lithic = new FakeLithic();
    lithic.nextResult = 'INSUFFICIENT_FUNDS';
    const h = await createHarness({ lithic, processor: new LithicSandboxProcessor(lithic) });
    const user = await createUser(h.db);
    const cardId = await enrollCard(h, user, '04AABBCCDDEE22');
    const setup = await fundingSetup(h, user, cardId);
    await h.http().put(`/api/v1/reclaimed-cards/${cardId}/funding`).set(user.auth).send({ primaryFundingAccountId: setup.funding[0]!.id, secondaryFundingAccountId: null, fallbackEnabled: false });
    await h.http().post(`/api/v1/reclaimed-cards/${cardId}/lithic-card`).set(user.auth);
    await terminalReq(h, 'POST', '/test-terminal/transactions', { merchantId: 'M1', merchantName: 'Shell', mcc: '5541', amountCents: 4_000, currency: 'USD' });
    const t = await bridgePost(h, '/hardware/tap-events', tap('04AABBCCDDEE22', { presentedAt: new Date(Date.now() + 5000).toISOString() }));
    expect(t.body.data.authorization.result).toBe('INSUFFICIENT_FUNDS');
    expect(t.body.data.transaction.declineReason).toBe('LITHIC_INSUFFICIENT_FUNDS');
  });

  it('answers ASA requests with the documented {token, result} shape after verifying the signature', async () => {
    const lithic = new FakeLithic();
    const h = await createHarness({ lithic, env: { LITHIC_ASA_SECRET: ASA_SECRET } });
    const user = await createUser(h.db);
    const cardId = await enrollCard(h, user, '04AABBCCDDEE33');
    await fundingSetup(h, user, cardId);
    const token = (await h.http().post(`/api/v1/reclaimed-cards/${cardId}/lithic-card`).set(user.auth)).body.data;
    const cardToken = (await h.db.query<{ lithic_card_token: string }>('select lithic_card_token from reclaimed_cards where id = $1', [cardId])).rows[0]!.lithic_card_token;
    expect(token.lithicSandboxMapped).toBe(true);

    const body = JSON.stringify({ token: 'asa-1', amount: 1_000, status: 'AUTHORIZATION', card: { token: cardToken }, merchant: { descriptor: 'Walmart', mcc: '5310' } });
    const ok = await h.http().post('/api/v1/webhooks/lithic/asa').set(standardWebhookHeaders(ASA_SECRET, body)).set('content-type', 'application/json').send(body);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ token: 'asa-1', result: 'APPROVED' });

    await h.http().patch(`/api/v1/reclaimed-cards/${cardId}/status`).set(user.auth).send({ status: 'FROZEN' });
    const body2 = body.replace('asa-1', 'asa-2');
    const frozen = await h.http().post('/api/v1/webhooks/lithic/asa').set(standardWebhookHeaders(ASA_SECRET, body2)).set('content-type', 'application/json').send(body2);
    expect(frozen.body).toEqual({ token: 'asa-2', result: 'CARD_PAUSED' });

    const forged = await h.http().post('/api/v1/webhooks/lithic/asa').set(standardWebhookHeaders(`whsec_${randomBytes(24).toString('base64')}`, body)).set('content-type', 'application/json').send(body);
    expect(forged.status).toBe(401);
  });

  it('reports LITHIC_NOT_CONFIGURED without credentials', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const cardId = await enrollCard(h, user, '04AABBCCDDEE44');
    expect((await h.http().post(`/api/v1/reclaimed-cards/${cardId}/lithic-card`).set(user.auth)).body.error.code).toBe('LITHIC_NOT_CONFIGURED');
  });
});
