import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import request from 'supertest';
import { createTestDatabase } from '@reclaimed/database/testing';
import { upsertDevTerminal, type Database } from '@reclaimed/database';
import { HARDWARE_BRIDGE_ID_HEADER, HARDWARE_SIGNATURE_HEADER, HARDWARE_TIMESTAMP_HEADER, TERMINAL_ID_HEADER, type TapEvent } from '@reclaimed/shared';
import { signRequest } from '@reclaimed/shared/node';
import { MockPaymentProcessor, type PaymentProcessor } from '@reclaimed/payment-core';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { buildContext } from '../src/build-context.js';
import { createApp } from '../src/app.js';
import { SharedSecretAuthVerifier, type AuthAdmin } from '../src/lib/auth.js';
import { NoopPublisher } from '../src/realtime/hub.js';
import { FakePlaidGateway } from './fake-plaid.js';
import type { LithicGateway } from '../src/integrations/lithic/lithic.js';
import type { PlaidGateway } from '../src/integrations/plaid/gateway.js';

export const JWT_SECRET = 'test-jwt-secret-that-is-long-enough-123';
export const BRIDGE_SECRET = 'test-bridge-secret-0123456789abcdef';
export const TERMINAL_CODE = 'TERM-TEST-001';
export const TERMINAL_SECRET = 'test-terminal-secret-0123456789';

export async function createHarness(
  opts: { env?: Record<string, string>; processor?: PaymentProcessor; lithic?: LithicGateway | null; plaidGateway?: PlaidGateway } = {},
) {
  const db = await createTestDatabase();
  const config = loadConfig({
    NODE_ENV: 'test',
    HARDWARE_BRIDGE_SECRET: BRIDGE_SECRET,
    NFC_UID_PEPPER: 'test-pepper-0123456789abcdef',
    PLAID_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    PLAID_VERIFY_WEBHOOKS: 'true',
    TAP_DEBOUNCE_MS: '1500',
    LOG_LEVEL: 'silent',
    ...opts.env,
  });
  const logger = createLogger('silent', false);
  const plaid = new FakePlaidGateway();
  const realtime = new NoopPublisher();
  const deletedUsers: string[] = [];
  const authAdmin: AuthAdmin = {
    async deleteUser(userId) {
      deletedUsers.push(userId);
      await db.query('delete from auth.users where id = $1', [userId]);
    },
  };
  const terminal = await upsertDevTerminal(db, { terminalCode: TERMINAL_CODE, secret: TERMINAL_SECRET });
  const ctx = buildContext({ ...config, isDev: true }, logger, {
    db,
    authVerifier: new SharedSecretAuthVerifier(JWT_SECRET),
    authAdmin,
    plaidGateway: opts.plaidGateway ?? plaid,
    lithic: opts.lithic ?? null,
    processor: opts.processor ?? new MockPaymentProcessor(),
    realtime,
    terminalSecrets: new Map([[TERMINAL_CODE, TERMINAL_SECRET]]),
  });
  const app = createApp(ctx);
  return { app, ctx, db, plaid, realtime, deletedUsers, terminalId: terminal.id, http: () => request(app) };
}
export type Harness = Awaited<ReturnType<typeof createHarness>>;

export async function createUser(db: Database, email = `user-${randomUUID().slice(0, 8)}@example.com`, fullName = 'Test User') {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: fullName })],
  );
  const id = rows[0]!.id;
  const token = await new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  return { id, email, token, auth: { Authorization: `Bearer ${token}` } };
}

function signedHeaders(secret: string, method: string, path: string, body: unknown) {
  const timestamp = new Date().toISOString();
  const raw = body === undefined ? '' : JSON.stringify(body);
  return { timestamp, signature: signRequest(secret, { timestamp, method, path, body: raw }) };
}

export function bridgePost(h: Harness, path: string, body: unknown, secret = BRIDGE_SECRET) {
  const full = `/api/v1${path}`;
  const s = signedHeaders(secret, 'POST', full, body);
  return h
    .http()
    .post(full)
    .set(HARDWARE_TIMESTAMP_HEADER, s.timestamp)
    .set(HARDWARE_SIGNATURE_HEADER, s.signature)
    .set(HARDWARE_BRIDGE_ID_HEADER, 'bridge-test')
    .set('content-type', 'application/json')
    .send(JSON.stringify(body));
}

export function terminalReq(h: Harness, method: 'GET' | 'POST', path: string, body?: unknown, extra: Record<string, string> = {}) {
  const full = `/api/v1${path}`;
  const s = signedHeaders(TERMINAL_SECRET, method, full, method === 'GET' ? undefined : (body ?? {}));
  let r = method === 'GET' ? h.http().get(full) : h.http().post(full);
  r = r.set(TERMINAL_ID_HEADER, TERMINAL_CODE).set(HARDWARE_TIMESTAMP_HEADER, s.timestamp).set(HARDWARE_SIGNATURE_HEADER, s.signature);
  for (const [k, v] of Object.entries(extra)) r = r.set(k, v);
  return method === 'GET' ? r : r.set('content-type', 'application/json').send(JSON.stringify(body ?? {}));
}

export const READER = 'ACS ACR1252 1S CL Reader PICC 0';

export function tap(uid: string, overrides: Partial<TapEvent> = {}): TapEvent {
  return {
    tapId: randomUUID(),
    readerName: READER,
    bridgeId: 'bridge-test',
    uid,
    atr: '3B8F8001804F0CA000000306030001000000006A',
    cardType: 'MIFARE Classic 1K',
    presentedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Enrolls a physical-card UID for the user via the real enrollment flow. */
export async function enrollCard(h: Harness, user: { auth: Record<string, string> }, uid: string) {
  const e = await h.http().post('/api/v1/reclaimed-cards/test-enroll').set(user.auth).send({ nickname: 'Test card' });
  if (e.status !== 201) throw new Error(`enroll failed ${e.status} ${JSON.stringify(e.body)}`);
  const t = await bridgePost(h, '/hardware/tap-events', tap(uid));
  if (t.body.data?.outcome !== 'ENROLLED') throw new Error(`tap did not enroll: ${JSON.stringify(t.body)}`);
  return t.body.data.enrollment.reclaimedCardId as string;
}

/**
 * Test data: two simulated credit accounts and a checking account, created through the public
 * API. With a card id, they become its primary/secondary funding with fallback.
 */
export async function fundingSetup(h: Harness, user: { auth: Record<string, string> }, cardId?: string) {
  const products = (await h.http().get('/api/v1/card-products').set(user.auth)).body.data as { id: string; productSlug: string }[];
  const product = (slug: string) => products.find((p) => p.productSlug === slug)!.id;
  const create = async (body: Record<string, unknown>) => {
    const res = await h.http().post('/api/v1/mock-funding-accounts').set(user.auth).send(body);
    if (res.status !== 201) throw new Error(`funding setup failed ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data as { id: string; displayName: string };
  };
  const citi = await create({ displayName: 'Mock Citi', fictionalIssuer: 'Mock Citi (fictional)', kind: 'CREDIT', cardProductId: product('citi-double-cash'), limitOrBalanceCents: 200_000, priority: 1 });
  const chase = await create({ displayName: 'Mock Chase', fictionalIssuer: 'Mock Chase (fictional)', kind: 'CREDIT', cardProductId: product('chase-sapphire-preferred'), limitOrBalanceCents: 500_000, priority: 2 });
  const checking = await create({ displayName: 'Mock Checking', fictionalIssuer: 'Mock Bank (fictional)', kind: 'DEPOSIT', limitOrBalanceCents: 300_000, priority: 3 });
  if (cardId) {
    await h.http().put(`/api/v1/reclaimed-cards/${cardId}/funding`).set(user.auth).send({ primaryFundingAccountId: citi.id, secondaryFundingAccountId: chase.id, fallbackEnabled: true });
  }
  return { funding: [citi, chase, checking] };
}
