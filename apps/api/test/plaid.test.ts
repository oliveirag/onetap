import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHarness, createUser } from './helpers.js';
import { CHASE_GENERIC, CITI_CHECKING, CITI_DC, PLATYPUS_CC, txn } from './fake-plaid.js';

async function link(h: Awaited<ReturnType<typeof createHarness>>, user: { auth: Record<string, string> }, pub: string) {
  const res = await h.http().post('/api/v1/plaid/exchange-token').set(user.auth).send({ publicToken: pub });
  expect(res.status).toBe(201);
  return res.body.data.itemId as string;
}

describe('Plaid integration (mocked gateway)', () => {
  it('creates link tokens without exposing secrets and requests liabilities as optional', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const res = await h.http().post('/api/v1/plaid/link-token').set(user.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.linkToken).toMatch(/^link-sandbox-/);
    expect(res.body.data.mode).toBe('create');
    expect(h.plaid.linkTokenCalls[0]).toMatchObject({ userId: user.id, includeLiabilities: true });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|access-sandbox/);
  });

  it('sends android_package_name only for Android and redirect_uri only for non-Android clients', async () => {
    const h = await createHarness({ env: { PLAID_REDIRECT_URI: 'https://example.com/plaid' } });
    const user = await createUser(h.db);
    for (const platform of ['android', 'ios', undefined]) {
      const res = await h.http().post('/api/v1/plaid/link-token').set(user.auth).send(platform ? { platform } : {});
      expect(res.status).toBe(200);
    }
    const [android, ios, unknown] = h.plaid.linkTokenCalls;
    expect(android).toMatchObject({ androidPackageName: 'com.reclaimed.app', redirectUri: undefined });
    expect(ios).toMatchObject({ androidPackageName: undefined, redirectUri: 'https://example.com/plaid' });
    expect(unknown).toMatchObject({ androidPackageName: undefined, redirectUri: 'https://example.com/plaid' });
    expect((await h.http().post('/api/v1/plaid/link-token').set(user.auth).send({ platform: 'windows' })).status).toBe(400);
  });

  it('exchanges a public token, encrypts the access token and imports accounts', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const pub = h.plaid.addInstitution({ institutionId: 'ins_citi', accounts: [CITI_DC, CITI_CHECKING] });
    const itemId = await link(h, user, pub);
    const stored = await h.db.query<{ access_token_ciphertext: string; institution_name: string }>('select access_token_ciphertext, institution_name from plaid_items where id = $1', [itemId]);
    expect(stored.rows[0]!.access_token_ciphertext).toMatch(/^v1:/);
    expect(stored.rows[0]!.access_token_ciphertext).not.toContain('access-sandbox');
    expect(stored.rows[0]!.institution_name).toBe('Citibank Online');

    const accounts = (await h.http().get('/api/v1/accounts').set(user.auth)).body.data;
    expect(accounts).toHaveLength(2);
    const cc = accounts.find((a: { type: string }) => a.type === 'credit');
    expect(cc).toMatchObject({ mask: '4321', currentBalanceCents: 41055, creditLimitCents: 500000, availableBalanceCents: 458945 });
    // Strong, unambiguous match is auto-suggested but NOT marked user-confirmed.
    expect(cc.cardProduct.productSlug).toBe('citi-double-cash');
    expect(cc.cardProductConfirmed).toBe(false);
    const items = (await h.http().get('/api/v1/plaid/items').set(user.auth)).body.data;
    expect(JSON.stringify(items)).not.toContain('v1:');
  });

  it('supports multiple institutions and multiple accounts', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    await link(h, user, h.plaid.addInstitution({ institutionId: 'ins_citi', accounts: [CITI_DC, CITI_CHECKING] }));
    await link(h, user, h.plaid.addInstitution({ institutionId: 'ins_chase', accounts: [CHASE_GENERIC] }));
    expect((await h.http().get('/api/v1/plaid/items').set(user.auth)).body.data).toHaveLength(2);
    expect((await h.http().get('/api/v1/accounts?type=credit').set(user.auth)).body.data).toHaveLength(2);
    const dash = (await h.http().get('/api/v1/dashboard/summary').set(user.auth)).body.data;
    expect(dash.real.connectedCreditCards).toBe(2);
    expect(dash.real.totalKnownCreditBalanceCents).toBe(41055 + 9999);
  });

  it('syncs transactions with pagination, modifications, removals and pending→posted without duplicates', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const pub = h.plaid.addInstitution({ institutionId: 'ins_citi', accounts: [CITI_DC] });
    const fake = h.plaid.itemByPublic(pub);
    fake.pages.set(null, { added: [txn('t1', 'acc-citi-dc'), txn('p1', 'acc-citi-dc', { pending: true, amount: 5 })], modified: [], removed: [], nextCursor: 'c1', hasMore: true });
    fake.pages.set('c1', { added: [txn('t2', 'acc-citi-dc'), txn('ignored', 'acc-not-shared')], modified: [], removed: [], nextCursor: 'c2', hasMore: false });
    const itemId = await link(h, user, pub);
    let list = (await h.http().get('/api/v1/transactions').set(user.auth)).body.data.items;
    expect(list.map((t: { id: string; name: string }) => t.name).sort()).toEqual(['Purchase p1', 'Purchase t1', 'Purchase t2']);

    // Incremental: p1 posts as t3 (pending removed), t1 modified, duplicate t2 re-delivered.
    fake.pages.set('c2', {
      added: [txn('t3', 'acc-citi-dc', { pendingTransactionId: 'p1', amount: 5 }), txn('t2', 'acc-citi-dc')],
      modified: [txn('t1', 'acc-citi-dc', { amount: 20, name: 'Purchase t1 (adjusted)' })],
      removed: [{ transactionId: 'p1' }],
      nextCursor: 'c3',
      hasMore: false,
    });
    const sync = await h.http().post(`/api/v1/plaid/items/${itemId}/sync`).set(user.auth);
    expect(sync.body.data.transactions).toEqual({ added: 2, modified: 1, removed: 1 });
    list = (await h.http().get('/api/v1/transactions').set(user.auth)).body.data.items;
    expect(list).toHaveLength(3);
    expect(list.find((t: { name: string }) => t.name === 'Purchase t1 (adjusted)').amountCents).toBe(2000);
    expect(list.some((t: { pending: boolean }) => t.pending)).toBe(false);
    const state = await h.db.query<{ transactions_cursor: string }>('select transactions_cursor from plaid_sync_state where plaid_item_id = $1', [itemId]);
    expect(state.rows[0]!.transactions_cursor).toBe('c3');
  });

  it('restarts pagination from the saved cursor on TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const pub = h.plaid.addInstitution({ institutionId: 'ins_citi', accounts: [CITI_DC] });
    const fake = h.plaid.itemByPublic(pub);
    fake.pages.set(null, { added: [txn('a', 'acc-citi-dc')], modified: [], removed: [], nextCursor: 'k1', hasMore: true });
    fake.pages.set('k1', { added: [txn('b', 'acc-citi-dc')], modified: [], removed: [], nextCursor: 'k2', hasMore: false });
    h.plaid.mutateOnce = true;
    await link(h, user, pub);
    const list = (await h.http().get('/api/v1/transactions').set(user.auth)).body.data.items;
    expect(list).toHaveLength(2);
  });

  it('stores liabilities when available and never invents missing fields', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const pub = h.plaid.addInstitution({
      institutionId: 'ins_citi',
      accounts: [CITI_DC],
      liabilities: [{ accountId: 'acc-citi-dc', aprs: [{ aprType: 'purchase_apr', aprPercentage: 24.99 }], isOverdue: false, lastPaymentAmount: null, lastPaymentDate: null, lastStatementIssueDate: '2026-09-15', lastStatementBalance: 380.1, minimumPaymentAmount: 35, nextPaymentDueDate: '2026-10-12' }],
    });
    await link(h, user, pub);
    const acct = (await h.http().get('/api/v1/accounts').set(user.auth)).body.data[0];
    const l = (await h.http().get(`/api/v1/accounts/${acct.id}/liabilities`).set(user.auth)).body.data;
    expect(l).toMatchObject({ lastStatementBalanceCents: 38010, minimumPaymentCents: 3500, nextPaymentDueDate: '2026-10-12', aprs: [{ aprType: 'purchase_apr', aprPercentage: 24.99 }] });
    const billAccounts = (await h.http().get('/api/v1/bill-pay/accounts').set(user.auth)).body.data;
    expect(billAccounts[0].liability.minimumPaymentCents).toBe(3500);
  });

  it('marks items LOGIN_REQUIRED and offers update-mode link tokens', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const pub = h.plaid.addInstitution({ institutionId: 'ins_citi', accounts: [CITI_DC] });
    const itemId = await link(h, user, pub);
    h.plaid.itemByPublic(pub).loginRequired = true;
    const sync = await h.http().post(`/api/v1/plaid/items/${itemId}/sync`).set(user.auth);
    expect(sync.status).toBe(409);
    expect(sync.body.error.code).toBe('PLAID_ITEM_LOGIN_REQUIRED');
    const items = (await h.http().get('/api/v1/plaid/items').set(user.auth)).body.data;
    expect(items[0].status).toBe('LOGIN_REQUIRED');
    const update = await h.http().post('/api/v1/plaid/link-token').set(user.auth).send({ itemId });
    expect(update.body.data.mode).toBe('update');
  });

  it('disconnects an institution at Plaid and removes local data', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const other = await createUser(h.db);
    const pub = h.plaid.addInstitution({ institutionId: 'ins_citi', accounts: [CITI_DC] });
    const itemId = await link(h, user, pub);
    expect((await h.http().delete(`/api/v1/plaid/items/${itemId}`).set(other.auth)).status).toBe(404);
    expect((await h.http().delete(`/api/v1/plaid/items/${itemId}`).set(user.auth)).status).toBe(200);
    expect(h.plaid.itemByPublic(pub).removed).toBe(true);
    expect((await h.http().get('/api/v1/accounts').set(user.auth)).body.data).toEqual([]);
  });

  describe('webhook verification', () => {
    async function signedWebhook(h: Awaited<ReturnType<typeof createHarness>>, body: object, opts: { tamper?: boolean; iatOffset?: number } = {}) {
      const { publicKey, privateKey } = await generateKeyPair('ES256');
      const jwk = { ...(await exportJWK(publicKey)), kid: 'kid-1', alg: 'ES256', use: 'sig', expired_at: null };
      h.plaid.webhookKeys.set('kid-1', jwk);
      const raw = JSON.stringify(body);
      const token = await new SignJWT({ request_body_sha256: createHash('sha256').update(raw).digest('hex') })
        .setProtectedHeader({ alg: 'ES256', kid: 'kid-1', typ: 'JWT' })
        .setIssuedAt(Math.floor(Date.now() / 1000) + (opts.iatOffset ?? 0))
        .sign(privateKey);
      return h.http().post('/api/v1/webhooks/plaid').set('plaid-verification', token).set('content-type', 'application/json').send(opts.tamper ? raw.replace('SYNC', 'SYNX') : raw);
    }

    it('accepts a valid signature and triggers a sync', async () => {
      const h = await createHarness();
      const user = await createUser(h.db);
      const pub = h.plaid.addInstitution({ institutionId: 'ins_citi', accounts: [CITI_DC] });
      await link(h, user, pub);
      const fake = h.plaid.itemByPublic(pub);
      fake.pages.set('c-empty', { added: [txn('w1', 'acc-citi-dc')], modified: [], removed: [], nextCursor: 'w2', hasMore: false });
      const res = await signedWebhook(h, { webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: fake.itemId });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 300));
      const list = (await h.http().get('/api/v1/transactions').set(user.auth)).body.data.items;
      expect(list.map((t: { name: string }) => t.name)).toContain('Purchase w1');
      const ev = await h.db.query<{ verified: boolean; processed_at: Date | null }>(`select verified, processed_at from webhook_events where provider = 'plaid'`);
      expect(ev.rows[0]).toMatchObject({ verified: true });
    });

    it('rejects tampered bodies, stale tokens and missing signatures', async () => {
      const h = await createHarness();
      const body = { webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'x' };
      expect((await signedWebhook(h, body, { tamper: true })).status).toBe(401);
      expect((await signedWebhook(h, body, { iatOffset: -600 })).status).toBe(401);
      const none = await h.http().post('/api/v1/webhooks/plaid').send(body);
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe('WEBHOOK_VERIFICATION_FAILED');
    });
  });

  it('reports PLAID_NOT_CONFIGURED when credentials are missing', async () => {
    const h = await createHarness({ env: { PLAID_TOKEN_ENCRYPTION_KEY: '' } });
    const user = await createUser(h.db);
    const res = await h.http().post('/api/v1/plaid/link-token').set(user.auth).send({});
    // Empty key string is treated as missing.
    expect([503]).toContain(res.status);
  });

  it('leaves products unconfirmed for accounts that match no seeded product', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    await link(h, user, h.plaid.addInstitution({ institutionId: 'ins_platypus', accounts: [PLATYPUS_CC] }));
    const acct = (await h.http().get('/api/v1/accounts').set(user.auth)).body.data[0];
    expect(acct.cardProduct).toBeNull();
    const m = (await h.http().get(`/api/v1/accounts/${acct.id}/card-product-matches`).set(user.auth)).body.data;
    expect(m).toEqual({ matches: [], ambiguous: false });
  });
});
