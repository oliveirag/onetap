/**
 * OneTap end-to-end smoke test against a RUNNING local stack (npm run dev + local Supabase).
 * Drives the same calls as the mobile app (mobile/src/lib/backend.ts, api.ts) and the NFC bridge:
 *   sign in -> connect a Plaid Sandbox bank -> connect cards -> read them with the user's JWT (RLS) -> link the card with a tap
 *   -> terminal checkout -> tap -> routed receipt over Supabase Realtime -> manual mode.
 * Taps are SIMULATED signed bridge requests (no reader needed). Nothing here moves money.
 * The bank login stands in for Plaid Link: a Sandbox public token for PLAID_SANDBOX_USERNAME (a custom
 * user from your Plaid dashboard) or, if unset, for the test cards defined below.
 *
 *   npm run smoke:onetap
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { API_PREFIX, HARDWARE_BRIDGE_ID_HEADER, HARDWARE_SIGNATURE_HEADER, HARDWARE_TIMESTAMP_HEADER, type ApiResponse, type TapResultDto } from '@reclaimed/shared';
import { createTerminalClient, signRequest } from '@reclaimed/shared/node';

const API = process.env.APP_BASE_URL ?? 'http://localhost:4000';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// Same selects as mobile/src/lib/backend.ts.
const FUNDING_COLUMNS =
  'id, display_name, last4, match_source, priority, current_balance_cents, credit_limit_cents, status, card_product:card_products(product_slug, issuer_name, product_name, card_network, reward_type, reward_currency, cents_per_point, card_art, is_generic)';
const PAYMENT_COLUMNS =
  'id, user_id, reclaimed_card_id, processor, processor_reference, merchant_id, merchant_name, mcc, amount_cents, state, funding_account_id, ' +
  'category_id, routing_mode, decision_reason, multiplier, points_earned, reward_value_cents, baseline_value_cents, best_value_cents, alternatives, is_seeded, created_at';

const results: { step: string; ok: boolean; detail: string }[] = [];
function check(step: string, ok: boolean, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(token: string, path: string, body: unknown = {}): Promise<{ status: number; body: ApiResponse<T> }> {
  const res = await fetch(`${API}${API_PREFIX}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as ApiResponse<T> };
}

// Test data for this script only: a Plaid custom Sandbox user with four credit cards.
const TEST_CARDS = [
  { name: 'American Express Gold Card', mask: '1008', balance: 842.17, limit: 15_000 },
  { name: 'Chase Sapphire Preferred', mask: '4417', balance: 1_240.5, limit: 10_000 },
  { name: 'Citi Custom Cash Card', mask: '2290', balance: 96.4, limit: 5_000 },
  { name: 'Citi Double Cash Card', mask: '7731', balance: 412.77, limit: 8_000 },
];

/** What Plaid Link hands the app: a public token for a Sandbox bank login. */
async function sandboxPublicToken(): Promise<string> {
  if (process.env.PLAID_ENV !== 'sandbox') throw new Error('PLAID_ENV must be sandbox.');
  const username = process.env.PLAID_SANDBOX_USERNAME;
  const config = {
    override_accounts: TEST_CARDS.map((c) => ({ type: 'credit', subtype: 'credit card', starting_balance: c.balance, meta: { name: c.name, official_name: c.name, mask: c.mask, limit: c.limit } })),
  };
  const res = await fetch('https://sandbox.plaid.com/sandbox/public_token/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      institution_id: 'ins_109508',
      initial_products: ['transactions'],
      options: username ? { override_username: username, override_password: process.env.PLAID_SANDBOX_PASSWORD ?? 'pass_good' } : { override_username: 'user_custom', override_password: JSON.stringify(config) },
    }),
  });
  const json = (await res.json()) as { public_token?: string; error_message?: string };
  if (!json.public_token) throw new Error(`Plaid sandbox: ${json.error_message ?? res.status}`);
  return json.public_token;
}

async function bridgeTap(uid: string): Promise<TapResultDto> {
  const path = `${API_PREFIX}/hardware/tap-events`;
  const body = JSON.stringify({ tapId: randomUUID(), readerName: 'SIMULATED onetap-smoke reader (not hardware)', bridgeId: 'onetap-smoke', uid, cardType: 'MIFARE Classic 1K (simulated)', presentedAt: new Date().toISOString() });
  const timestamp = new Date().toISOString();
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [HARDWARE_TIMESTAMP_HEADER]: timestamp,
      [HARDWARE_BRIDGE_ID_HEADER]: 'onetap-smoke',
      [HARDWARE_SIGNATURE_HEADER]: signRequest(process.env.HARDWARE_BRIDGE_SECRET!, { timestamp, method: 'POST', path, body }),
    },
    body,
  });
  const json = (await res.json()) as ApiResponse<TapResultDto>;
  if (!json.success) throw new Error(`tap -> ${json.error.code}`);
  return json.data;
}

async function main() {
  if (!PUBLISHABLE || !SERVICE || !process.env.HARDWARE_BRIDGE_SECRET || !process.env.TEST_TERMINAL_SECRET) {
    throw new Error('Load .env first (SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, HARDWARE_BRIDGE_SECRET, TEST_TERMINAL_SECRET).');
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE_URL)) throw new Error(`Refusing to run against a non-local Supabase (${SUPABASE_URL}).`);

  // 1. A fresh, confirmed account, signed in like the app.
  const email = `onetap-smoke-${randomBytes(4).toString('hex')}@example.test`;
  const password = randomBytes(12).toString('hex');
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Smoke Test' } });
  if (created.error) throw created.error;
  const app = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
  const signIn = await app.auth.signInWithPassword({ email, password });
  check('Signed in with Supabase Auth', !!signIn.data.session, email);
  const token = signIn.data.session!.access_token;
  const userId = signIn.data.user!.id;

  // 2. Setup step 1: Plaid Link (bank login) -> exchange -> connect cards, as the app does.
  const exchange = await api<{ accountsImported: number }>(token, '/plaid/exchange-token', { publicToken: await sandboxPublicToken() });
  check('Linked a Plaid Sandbox bank', exchange.status === 201, exchange.body.success ? `${exchange.body.data.accountsImported} accounts` : JSON.stringify(exchange.body));
  const connect = await api<{ cardIds: string[] }>(token, '/onetap/connect-cards');
  check('Connected cards from Plaid', connect.status === 200 && connect.body.success && connect.body.data.cardIds.length > 0,
    connect.body.success ? `${connect.body.data.cardIds.length} cards` : JSON.stringify(connect.body));
  const customUser = !!process.env.PLAID_SANDBOX_USERNAME;

  // 3. The app's reads with the user's JWT.
  const cards = await app.from('mock_funding_accounts').select(FUNDING_COLUMNS).eq('kind', 'CREDIT').neq('status', 'CLOSED').order('priority');
  const names = (cards.data ?? []).map((c) => `${(c.card_product as unknown as { product_slug: string } | null)?.product_slug}:${c.last4}`);
  check('App reads its cards with products (RLS)', !cards.error && (customUser ? names.length > 0 : names.join() === 'amex-gold:1008,chase-sapphire-preferred:4417,citi-custom-cash:2290,citi-double-cash:7731'), cards.error?.message ?? names.join(' '));
  const rates = await app.from('card_product_rates').select('category_id, multiplier, card_product:card_products(product_slug)');
  check('App reads reward rates', !rates.error && (rates.data?.length ?? 0) === 66, rates.error?.message ?? `${rates.data?.length} rows`);
  const profile = await app.from('profiles').select('id, full_name, routing_mode, manual_card_id, default_card_id').single();
  check('App reads its profile', !profile.error && profile.data?.routing_mode === 'auto' && profile.data?.default_card_id === cards.data?.[0]?.id, profile.error?.message);
  const others = await app.from('mock_funding_accounts').select('id').neq('user_id', userId);
  check("App can't see other users' cards", !others.error && others.data?.length === 0);

  // 4. Setup step 4: link the OneTap card by tapping it while the request waits.
  const uid = `04${randomBytes(6).toString('hex').toUpperCase()}`;
  const linking = api<{ id: string; last4: string; state: string }>(token, '/onetap/card');
  await sleep(600);
  const enrollTap = await bridgeTap(uid);
  const linked = await linking;
  check('Linked the OneTap card with a tap', enrollTap.outcome === 'ENROLLED' && linked.body.success && linked.body.data.state === 'open',
    linked.body.success ? `•••• ${linked.body.data.last4}` : JSON.stringify(linked.body));
  const oneTap = await app.from('reclaimed_cards').select('id, display_id, status').in('status', ['ACTIVE', 'FROZEN']).limit(1).maybeSingle();
  check('App reads its OneTap card', !oneTap.error && oneTap.data?.id === (linked.body.success ? linked.body.data.id : ''));

  // 5. Realtime: the app's listener (TransactionListener.tsx).
  const received: Record<string, unknown>[] = [];
  await app.realtime.setAuth(token);
  const channel = app
    .channel(`tx-${userId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payment_transactions', filter: `user_id=eq.${userId}` }, (p) => {
      if ((p.new as { decision_reason: string | null }).decision_reason) received.push(p.new);
    });
  // SUBSCRIBED arrives before the database listener is live; Realtime then sends a system message.
  const ready = new Promise<void>((resolve) =>
    channel.on('system', {}, (m: { extension?: string; status?: string }) => m.extension === 'postgres_changes' && m.status === 'ok' && resolve()),
  );
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Realtime did not subscribe')), 10_000);
    channel.subscribe((s) => s === 'SUBSCRIBED' && (clearTimeout(t), resolve()));
  });
  await Promise.race([ready, sleep(5_000)]);
  check('Subscribed to Realtime as the user', true);

  // 6. Store checkout, then tap. The expected winner comes from the same cards and rates the app reads:
  // highest multiplier x cents per point for dining, ties to the user's card order.
  type CardRow = { id: string; display_name: string; last4: string | null; card_product: { product_slug: string; cents_per_point: number | string } | null };
  const rateRows = (rates.data ?? []) as unknown as { category_id: string; multiplier: number | string; card_product: { product_slug: string } | null }[];
  const perDollar = (c: CardRow) =>
    Number(rateRows.find((r) => r.category_id === 'dining' && r.card_product?.product_slug === (c.card_product?.product_slug ?? 'other-card'))?.multiplier ?? 1) *
    Number(c.card_product?.cents_per_point ?? 1);
  const ranked = [...((cards.data ?? []) as unknown as CardRow[])].sort((a, b) => perDollar(b) - perDollar(a));
  const best = ranked[0]!;
  const tie = ranked.length > 1 && perDollar(ranked[1]!) === perDollar(best);
  const expectedValue = Math.round((1_250 * perDollar(best)) / 100);
  const terminal = createTerminalClient({ baseUrl: API, terminalCode: process.env.TEST_TERMINAL_ID ?? 'TERM-DEV-001', secret: process.env.TEST_TERMINAL_SECRET! });
  const pay = async (merchant: { merchantId: string; merchantName: string; mcc: string }, amountCents: number) => {
    const checkout = await terminal<{ id: string }>('POST', '/test-terminal/transactions', { ...merchant, amountCents, currency: 'USD' });
    await sleep(1_600); // past the tap debounce window
    const tap = await bridgeTap(uid);
    for (let i = 0; i < 50 && !received.some((r) => r.id === checkout.id); i++) await sleep(100);
    return { checkout, tap, event: received.find((r) => r.id === checkout.id) };
  };

  const started = Date.now();
  const dining = await pay({ merchantId: 'MID-STARBUCKS-0001', merchantName: 'Starbucks', mcc: '5814' }, 1_250);
  check('Tap approved at the terminal', dining.tap.authorization?.result === 'APPROVED', dining.tap.transaction?.fundingAccountName ?? '');
  const ev = dining.event as Record<string, unknown> | undefined;
  check('Routed receipt arrived over Realtime', !!ev, ev ? `${Date.now() - started} ms after checkout` : 'no event');
  check(
    `Dining routed to the best card (${best.display_name})`,
    ev?.funding_account_id === best.id && ev?.category_id === 'dining' && ev?.decision_reason === (tie ? 'tie_priority' : 'best_rate') && Number(ev?.reward_value_cents) === expectedValue,
    ev ? `${ev.funding_account_name} ${Number(ev.multiplier)}x, +${ev.reward_value_cents}¢, ${(ev.alternatives as unknown[]).length} alternatives` : '',
  );
  const feed = await app.from('payment_transactions').select(PAYMENT_COLUMNS).not('decision_reason', 'is', null).order('created_at', { ascending: false }).limit(200);
  check('App feed shows the routed transaction', !feed.error && feed.data?.[0]?.id === dining.checkout.id, feed.error?.message);

  // 7. Manual mode, set by the app on its own profile.
  const chosen = ranked[ranked.length - 1]!; // the least rewarding card, so Manual differs from Auto
  const setManual = await app.from('profiles').update({ routing_mode: 'manual', manual_card_id: chosen.id }).eq('id', userId).select('routing_mode').single();
  check(`App switched to Manual on ${chosen.display_name}`, !setManual.error && setManual.data?.routing_mode === 'manual', setManual.error?.message);
  const manual = await pay({ merchantId: 'MID-STARBUCKS-0001', merchantName: 'Starbucks', mcc: '5814' }, 1_250);
  const mev = manual.event as Record<string, unknown> | undefined;
  check('Manual mode charged the chosen card', mev?.funding_account_id === chosen.id && mev?.decision_reason === 'manual' && Number(mev?.best_value_cents) === expectedValue,
    mev ? `${mev.funding_account_name}, +${mev.reward_value_cents}¢ vs best ${mev.best_value_cents}¢` : 'no event');
  const blocked = await app.from('mock_funding_accounts').update({ credit_limit_cents: 99_999_999 }).eq('id', chosen.id).select('id');
  check("App can't raise its own credit limit", !!blocked.error, blocked.error?.message ?? 'update succeeded');

  await app.removeChannel(channel);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (simulated taps, mock processor, no real money).`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL ', err instanceof Error ? err.message : err);
  process.exit(1);
});
