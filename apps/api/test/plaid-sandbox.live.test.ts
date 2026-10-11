/**
 * LIVE Plaid Sandbox end-to-end test. Opt-in only:
 *
 *   PLAID_LIVE=1 PLAID_CLIENT_ID=… PLAID_SECRET=… npx vitest run apps/api/test/plaid-sandbox.live.test.ts
 *
 * Drives the real HTTP API (Supabase-style JWT auth) with the real PlaidSdkGateway
 * against https://sandbox.plaid.com. Data is written to an in-memory PGlite
 * database, never to Supabase. Link's UI is replaced by /sandbox/public_token/create,
 * which yields the same public_token the mobile app receives from Link.
 */
import { describe, expect, it } from 'vitest';
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from 'plaid';
import { PlaidSdkGateway } from '../src/integrations/plaid/sdk-gateway.js';
import { TokenCipher } from '../src/lib/crypto.js';
import { createHarness, createUser } from './helpers.js';

const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SECRET;
const live = process.env.PLAID_LIVE === '1' && Boolean(clientId && secret);
const ENC_KEY = Buffer.alloc(32, 9).toString('base64');
const FIRST_PLATYPUS = 'ins_109508';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!live)('Plaid Sandbox (live)', () => {
  const sandbox = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments.sandbox,
      baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret, 'Plaid-Version': '2020-09-14' } },
    }),
  );
  const gateway = new PlaidSdkGateway({ clientId: clientId!, secret: secret!, env: 'sandbox', products: [Products.Transactions], countryCodes: [CountryCode.Us] });

  async function publicToken() {
    const { data } = await sandbox.sandboxPublicTokenCreate({
      institution_id: FIRST_PLATYPUS,
      initial_products: [Products.Transactions],
      options: { override_username: 'user_good', override_password: 'pass_good' },
    });
    return data.public_token;
  }

  it('links, imports, syncs, handles login-required and disconnects', { timeout: 180_000 }, async () => {
    const h = await createHarness({ plaidGateway: gateway, env: { PLAID_TOKEN_ENCRYPTION_KEY: ENC_KEY } });
    const user = await createUser(h.db);
    const intruder = await createUser(h.db);
    const api = (path: string) => `/api/v1${path}`;

    // 1. Authentication is enforced on every Plaid route.
    for (const [m, p] of [['post', '/plaid/link-token'], ['post', '/plaid/exchange-token'], ['get', '/plaid/items'], ['get', '/accounts'], ['get', '/transactions']] as const) {
      expect((await h.http()[m](api(p))).status).toBe(401);
    }

    // 2. Link token (real /link/token/create).
    const lt = await h.http().post(api('/plaid/link-token')).set(user.auth).send({});
    expect(lt.status).toBe(200);
    expect(lt.body.data.linkToken).toMatch(/^link-sandbox-/);
    expect(lt.body.data.mode).toBe('create');

    // 3. Invalid public token → mapped Plaid error, nothing stored.
    const bad = await h.http().post(api('/plaid/exchange-token')).set(user.auth).send({ publicToken: 'public-sandbox-00000000-0000-0000-0000-000000000000' });
    expect(bad.status).toBe(502);
    expect(bad.body.error).toMatchObject({ code: 'PLAID_CONNECTION_FAILED', message: 'Plaid error: INVALID_PUBLIC_TOKEN' });
    expect((await h.db.query<{ n: number }>('select count(*)::int as n from plaid_items')).rows[0]!.n).toBe(0);

    // 4. Exchange a real Sandbox public token.
    const ex = await h.http().post(api('/plaid/exchange-token')).set(user.auth).send({ publicToken: await publicToken() });
    expect(ex.status).toBe(201);
    const itemId: string = ex.body.data.itemId;
    expect(ex.body.data.accountsImported).toBeGreaterThan(0);
    expect(JSON.stringify(ex.body)).not.toMatch(/access-sandbox/);

    const stored = await h.db.query<{ access_token_ciphertext: string; institution_name: string | null; status: string }>(
      'select access_token_ciphertext, institution_name, status from plaid_items where id = $1',
      [itemId],
    );
    const row = stored.rows[0]!;
    expect(row.access_token_ciphertext).toMatch(/^v1:/);
    expect(row.access_token_ciphertext).not.toContain('access-sandbox');
    expect(row.institution_name).toBe('First Platypus Bank');
    const accessToken = new TokenCipher(ENC_KEY).decrypt(row.access_token_ciphertext);
    expect(accessToken).toMatch(/^access-sandbox-/);

    // 5. Accounts (real /accounts/get), including a credit card.
    const accounts = (await h.http().get(api('/accounts')).set(user.auth)).body.data as { id: string; type: string; name: string; mask: string | null; connectionStatus: string }[];
    expect(accounts.length).toBeGreaterThan(0);
    const credit = accounts.filter((a) => a.type === 'credit');
    expect(credit.length).toBeGreaterThan(0);
    expect(accounts.every((a) => a.connectionStatus === 'ACTIVE')).toBe(true);
    console.info(`[live] imported ${accounts.length} accounts: ${accounts.map((a) => `${a.type}:${a.name}`).join(', ')}`);

    // Another user cannot see or act on this item.
    expect((await h.http().get(api(`/accounts/${accounts[0]!.id}`)).set(intruder.auth)).status).toBe(404);
    expect((await h.http().post(api(`/plaid/items/${itemId}/sync`)).set(intruder.auth)).status).toBe(404);
    expect((await h.http().delete(api(`/plaid/items/${itemId}`)).set(intruder.auth)).status).toBe(404);

    // 6. Transactions (real /transactions/sync), polling while Sandbox prepares data.
    let txns: unknown[] = [];
    for (let attempt = 0; attempt < 15 && txns.length === 0; attempt += 1) {
      const s = await h.http().post(api(`/plaid/items/${itemId}/sync`)).set(user.auth);
      expect(s.status).toBe(200);
      txns = (await h.http().get(api('/transactions?limit=100')).set(user.auth)).body.data.items;
      if (txns.length === 0) await sleep(3000);
    }
    expect(txns.length).toBeGreaterThan(0);
    console.info(`[live] synced ${txns.length} transactions (first page)`);

    // Re-sync is incremental and does not duplicate.
    const before = (await h.db.query<{ n: number }>('select count(*)::int as n from transactions')).rows[0]!.n;
    expect((await h.http().post(api(`/plaid/items/${itemId}/sync`)).set(user.auth)).status).toBe(200);
    const after = (await h.db.query<{ n: number }>('select count(*)::int as n from transactions')).rows[0]!.n;
    expect(after).toBe(before);

    // 7. Expired login (real /sandbox/item/reset_login) → LOGIN_REQUIRED + update-mode link token.
    await sandbox.sandboxItemResetLogin({ access_token: accessToken });
    const broken = await h.http().post(api(`/plaid/items/${itemId}/sync`)).set(user.auth);
    expect(broken.body.error.code).toBe('PLAID_ITEM_LOGIN_REQUIRED');
    const items = (await h.http().get(api('/plaid/items')).set(user.auth)).body.data as { id: string; status: string }[];
    expect(items.find((i) => i.id === itemId)?.status).toBe('LOGIN_REQUIRED');
    const repair = await h.http().post(api('/plaid/link-token')).set(user.auth).send({ itemId });
    expect(repair.status).toBe(200);
    expect(repair.body.data.mode).toBe('update');

    // 8. Disconnect (real /item/remove) → local data gone and the access token is revoked at Plaid.
    expect((await h.http().delete(api(`/plaid/items/${itemId}`)).set(user.auth)).status).toBe(200);
    expect((await h.http().get(api('/plaid/items')).set(user.auth)).body.data).toEqual([]);
    expect((await h.http().get(api('/accounts')).set(user.auth)).body.data).toEqual([]);
    expect((await h.db.query<{ n: number }>('select count(*)::int as n from transactions')).rows[0]!.n).toBe(0);
    const revoked = await sandbox.itemGet({ access_token: accessToken }).then(
      () => null,
      (e: { response?: { data?: { error_code?: string } } }) => e.response?.data?.error_code,
    );
    expect(revoked).toBe('ITEM_NOT_FOUND');

    await h.db.close();
  });
});
