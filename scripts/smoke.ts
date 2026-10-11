/**
 * npm run smoke — end-to-end API smoke test against a RUNNING local stack
 * (npm run db:start, npm run db:seed, npm run dev:api).
 *
 * Uses real Supabase Auth (sign-up + email OTP from Mailpit), the real API, the
 * real database and the realtime WebSocket. NFC taps are SOFTWARE-SIMULATED by
 * sending HMAC-signed bridge requests — this is NOT physical hardware evidence.
 */
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import { API_PREFIX, HARDWARE_BRIDGE_ID_HEADER, HARDWARE_SIGNATURE_HEADER, HARDWARE_TIMESTAMP_HEADER, type ApiResponse, type TapResultDto } from '@reclaimed/shared';
import { createTerminalClient, signRequest } from '@reclaimed/shared/node';

const API = process.env.APP_BASE_URL ?? 'http://localhost:4000';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const results: { step: string; ok: boolean; detail: string }[] = [];

function check(step: string, ok: boolean, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Smoke step failed: ${step}`);
}

async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${API_PREFIX}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(`${method} ${path} → ${json.error.code}: ${json.error.message}`);
  return json.data;
}

async function bridgeTap(uid: string): Promise<TapResultDto> {
  const path = `${API_PREFIX}/hardware/tap-events`;
  const body = JSON.stringify({ tapId: randomUUID(), readerName: 'SIMULATED smoke-test reader (not hardware)', bridgeId: 'smoke-sim', uid, cardType: 'MIFARE Classic 1K (simulated)', presentedAt: new Date().toISOString() });
  const timestamp = new Date().toISOString();
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [HARDWARE_TIMESTAMP_HEADER]: timestamp,
      [HARDWARE_BRIDGE_ID_HEADER]: 'smoke-sim',
      [HARDWARE_SIGNATURE_HEADER]: signRequest(process.env.HARDWARE_BRIDGE_SECRET!, { timestamp, method: 'POST', path, body }),
    },
    body,
  });
  const json = (await res.json()) as ApiResponse<TapResultDto>;
  if (!json.success) throw new Error(`tap → ${json.error.code}`);
  return json.data;
}

async function latestOtp(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text?: string; HTML?: string };
      const code = /\b(\d{6})\b/.exec(msg.Text ?? msg.HTML ?? '')?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('No verification email arrived in Mailpit');
}

async function main() {
  const anon = createClient(SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const email = `smoke-${Date.now()}@example.com`;
  const password = 'Smoke-test-password-1';

  // ---- Auth: registration, email verification, login, protected endpoint ----
  const signUp = await anon.auth.signUp({ email, password, options: { data: { full_name: 'Smoke Tester' } } });
  check('Sign-up requires email verification', !signUp.error && !signUp.data.session, signUp.error?.message ?? 'no session until verified');
  const blocked = await anon.auth.signInWithPassword({ email, password });
  check('Login blocked before verification', Boolean(blocked.error), blocked.error?.message ?? '');
  const otp = await latestOtp(email);
  const verified = await anon.auth.verifyOtp({ email, token: otp, type: 'email' });
  check('Email verified with OTP from Mailpit', !verified.error && Boolean(verified.data.session), verified.error?.message ?? 'session issued');
  const login = await anon.auth.signInWithPassword({ email, password });
  const token = login.data.session!.access_token;
  check('Login returns a Supabase session', Boolean(token), `JWT alg ${JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).alg}`);
  const me = await api<{ id: string; fullName: string }>(token, 'GET', '/me');
  check('API verifies the Supabase token and auto-created profile', me.fullName === 'Smoke Tester', me.id);
  const noAuth = await fetch(`${API}${API_PREFIX}/me`);
  check('Protected endpoint rejects anonymous request', noAuth.status === 401);

  // ---- Realtime ----
  const events: { type: string; transaction?: { state: string } }[] = [];
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}${API_PREFIX}/realtime`);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', accessToken: token })));
    ws.on('message', (m) => {
      const msg = JSON.parse(String(m));
      if (msg.type === 'ready') resolve();
      if (msg.type === 'event') events.push(msg.event);
      if (msg.type === 'error') reject(new Error(msg.message));
    });
  });
  check('Realtime WebSocket authenticated', true);

  // ---- Enrollment via (simulated) tap ----
  const uid = `04${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const enrollment = await api<{ id: string }>(token, 'POST', '/reclaimed-cards/test-enroll', { nickname: 'Smoke card' });
  const enrolledTap = await bridgeTap(uid);
  check('Enrollment completes on signed tap (software-simulated)', enrolledTap.outcome === 'ENROLLED', enrolledTap.enrollment?.reclaimedCardId ?? '');
  const cardId = enrolledTap.enrollment!.reclaimedCardId!;
  const enr = await api<{ status: string }>(token, 'GET', `/reclaimed-cards/enrollments/${enrollment.id}`);
  check('Enrollment status visible to the app', enr.status === 'COMPLETED');

  // ---- Funding & terminal checkout ----
  // Test data for this script: two simulated credit accounts as the card's primary and secondary.
  const products = await api<{ id: string; productSlug: string }[]>(token, 'GET', '/card-products');
  const product = (slug: string) => products.find((p) => p.productSlug === slug)?.id ?? null;
  const citiAcct = await api<{ id: string; displayName: string }>(token, 'POST', '/mock-funding-accounts', { displayName: 'Mock Citi', fictionalIssuer: 'Mock Citi (fictional)', kind: 'CREDIT', cardProductId: product('citi-double-cash'), limitOrBalanceCents: 200_000, priority: 1 });
  const chaseAcct = await api<{ id: string; displayName: string }>(token, 'POST', '/mock-funding-accounts', { displayName: 'Mock Chase', fictionalIssuer: 'Mock Chase (fictional)', kind: 'CREDIT', cardProductId: product('chase-sapphire-preferred'), limitOrBalanceCents: 500_000, priority: 2 });
  await api(token, 'PUT', `/reclaimed-cards/${cardId}/funding`, { primaryFundingAccountId: citiAcct.id, secondaryFundingAccountId: chaseAcct.id, fallbackEnabled: true });
  const setup = { funding: [citiAcct, chaseAcct] };
  check('Mock Citi (primary) and Mock Chase (secondary) configured', setup.funding.map((f) => f.displayName).join(',').includes('Mock Citi'));
  const terminal = createTerminalClient({ baseUrl: API, terminalCode: process.env.TEST_TERMINAL_ID ?? 'TERM-DEV-001', secret: process.env.TEST_TERMINAL_SECRET! });
  const checkout = await terminal<{ id: string; state: string }>('POST', '/test-terminal/transactions', { merchantId: 'MID-WALMART-0001', merchantName: 'Walmart', mcc: '5310', amountCents: 10_000, currency: 'USD' });
  check('Terminal created $100 Walmart checkout', checkout.state === 'CREATED');
  await new Promise((r) => setTimeout(r, 1600)); // past tap debounce window
  const authTap = await bridgeTap(uid);
  check('Tap authorized on Mock Citi', authTap.authorization?.result === 'APPROVED' && authTap.transaction?.fundingAccountName === 'Mock Citi', `${authTap.authorization?.latency.totalMs} ms`);
  await terminal('POST', `/test-terminal/transactions/${checkout.id}/capture`);
  await terminal('POST', `/test-terminal/transactions/${checkout.id}/settle`, { immediate: true });
  const refunded = await terminal<{ state: string; refundedCents: number }>('POST', `/test-terminal/transactions/${checkout.id}/refund`, { amountCents: 2_500 }, `smoke-refund-${checkout.id}`);
  check('Capture → settle → partial refund', refunded.state === 'PARTIALLY_REFUNDED' && refunded.refundedCents === 2_500);
  const detail = await api<{ ledger: { journalType: string; entries: { direction: string; amountCents: number }[] }[] }>(token, 'GET', `/simulated-transactions/${checkout.id}`);
  const balanced = detail.ledger.every((j) => j.entries.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + e.amountCents, 0) === j.entries.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + e.amountCents, 0));
  check('Ledger journals balanced', balanced, detail.ledger.map((j) => j.journalType).join(' → '));
  check('Mobile realtime received payment updates', events.some((e) => e.type === 'payment.updated'), `${events.length} events`);

  // ---- Frozen card ----
  await api(token, 'PATCH', `/reclaimed-cards/${cardId}/status`, { status: 'FROZEN' });
  await terminal('POST', '/test-terminal/transactions', { merchantId: 'MID-STARBUCKS-0001', merchantName: 'Starbucks', mcc: '5814', amountCents: 500, currency: 'USD' });
  await new Promise((r) => setTimeout(r, 1600));
  const frozenTap = await bridgeTap(uid);
  check('Frozen card declined', frozenTap.authorization?.result === 'CARD_FROZEN');
  await api(token, 'PATCH', `/reclaimed-cards/${cardId}/status`, { status: 'ACTIVE' });

  // ---- Insufficient funds → fallback ----
  const citi = setup.funding.find((f) => f.displayName === 'Mock Citi')!;
  await api(token, 'PATCH', `/mock-funding-accounts/${citi.id}`, { currentBalanceCents: 199_000 });
  await terminal('POST', '/test-terminal/transactions', { merchantId: 'MID-WALMART-0001', merchantName: 'Walmart', mcc: '5310', amountCents: 10_000, currency: 'USD' });
  await new Promise((r) => setTimeout(r, 1600));
  const fallbackTap = await bridgeTap(uid);
  check('Insufficient Mock Citi falls back to Mock Chase', fallbackTap.transaction?.fundingAccountName === 'Mock Chase', fallbackTap.authorization?.fundingAttempts.map((a) => `${a.fundingAccountName}:${a.result}`).join(' → '));

  ws.close();

  // ---- Account deletion (Supabase admin, cascades user data) ----
  await api(token, 'DELETE', '/me');
  const after = await fetch(`${API}${API_PREFIX}/me`, { headers: { Authorization: `Bearer ${token}` } });
  const relogin = await anon.auth.signInWithPassword({ email, password });
  check('Account deletion removes the user', after.status === 401 && Boolean(relogin.error), relogin.error?.message ?? '');
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} smoke checks passed (taps were software-simulated, not physical).`);
}

main().catch((err) => {
  console.error(`\n❌ ${(err as Error).message}`);
  process.exit(1);
});
