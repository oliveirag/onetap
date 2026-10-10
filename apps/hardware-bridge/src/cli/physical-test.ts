/**
 * npm run hardware:test
 *
 * Guided PHYSICAL acceptance test for the ACS ACR1252U + generic NFC cards.
 * Every result is derived from real PC/SC events and real API responses observed
 * during this run. Nothing is mocked. Steps that cannot be performed are BLOCKED.
 *
 * Tests 7–10 need the API running (npm run dev:api) plus HARDWARE_BRIDGE_SECRET,
 * TEST_TERMINAL_ID and TEST_TERMINAL_SECRET in .env, and a card enrolled in the app
 * with mock funding configured (Cards → Reclaimed Card → Demo funding setup).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { API_PREFIX, HARDWARE_SIGNATURE_HEADER, HARDWARE_TIMESTAMP_HEADER, TERMINAL_ID_HEADER, type ApiResponse, type SimulatedTransactionDto, type TapResultDto } from '@reclaimed/shared';
import { signRequest } from '@reclaimed/shared/node';
import { PcscReaderDriver } from '../driver/pcsc-driver.js';
import { HardwareBridge, type Presentation } from '../bridge.js';
import { HttpBridgeApi } from '../api-client.js';
import { bridgeConfig } from '../config.js';
import { driverStatus, findAcsReaders, listUsbDevices } from '../diagnostics.js';

type Status = 'PASS' | 'FAIL' | 'BLOCKED';
interface Result {
  id: number;
  name: string;
  expected: string;
  actual: string;
  status: Status;
  evidence: string[];
  issues: string;
}

const cfg = bridgeConfig();
const rl = createInterface({ input: stdin, output: stdout });
const results: Result[] = [];
const quietLog = { info: () => undefined, warn: (m: string) => console.log(`    (warn) ${m}`), error: (m: string) => console.log(`    (error) ${m}`) };
const mask = (uid: string | null) => (uid ? `••••${uid.slice(-4)}` : 'n/a');
const ask = async (q: string) => (await rl.question(`\n  ${q} `)).trim().toLowerCase();

function waitFor<T>(register: (resolve: (v: T) => void) => () => void, ms: number): Promise<T | null> {
  return new Promise((resolveP) => {
    let cleanup = () => {};
    const timer = setTimeout(() => {
      cleanup();
      resolveP(null);
    }, ms);
    cleanup = register((v) => {
      clearTimeout(timer);
      cleanup();
      resolveP(v);
    });
  });
}

const driver = new PcscReaderDriver({ readerFilter: cfg.readerFilter });
const api = cfg.secret ? new HttpBridgeApi({ baseUrl: cfg.apiUrl, secret: cfg.secret, bridgeId: cfg.bridgeId, maxAttempts: 2 }) : null;
const bridge = new HardwareBridge(driver, api, quietLog, { bridgeId: cfg.bridgeId, heartbeatMs: api ? 10_000 : 0 });

const nextPresentation = (ms = 60_000) =>
  waitFor<Presentation>((res) => {
    const h = (p: Presentation) => res(p);
    bridge.on('presentation', h);
    return () => bridge.off('presentation', h);
  }, ms);
const nextRemoval = (ms = 60_000) =>
  waitFor<Presentation>((res) => {
    const h = (p: Presentation) => res(p);
    bridge.on('removed', h);
    return () => bridge.off('removed', h);
  }, ms);
const nextTapResult = (ms = 60_000) =>
  waitFor<{ p: Presentation; r: TapResultDto } | { p: Presentation; err: Error }>((res) => {
    const ok = (p: Presentation, r: TapResultDto) => res({ p, r });
    const bad = (p: Presentation, err: Error) => res({ p, err });
    bridge.on('tapResult', ok);
    bridge.on('tapError', bad);
    return () => {
      bridge.off('tapResult', ok);
      bridge.off('tapError', bad);
    };
  }, ms);
const readerEvent = (type: string, ms = 90_000) =>
  waitFor<string>((res) => {
    const h = (t: string, name: string) => t === type && res(name);
    bridge.on('reader', h);
    return () => bridge.off('reader', h);
  }, ms);

async function terminal<T>(method: 'GET' | 'POST', path: string, body?: unknown, idem?: string): Promise<T> {
  const code = process.env.TEST_TERMINAL_ID ?? 'TERM-DEV-001';
  const secret = process.env.TEST_TERMINAL_SECRET;
  if (!secret) throw new Error('TEST_TERMINAL_SECRET is not set');
  const full = `${API_PREFIX}${path}`;
  const raw = method === 'GET' ? '' : JSON.stringify(body ?? {});
  const timestamp = new Date().toISOString();
  const res = await fetch(`${cfg.apiUrl}${full}`, {
    method,
    headers: {
      'content-type': 'application/json',
      [TERMINAL_ID_HEADER]: code,
      [HARDWARE_TIMESTAMP_HEADER]: timestamp,
      [HARDWARE_SIGNATURE_HEADER]: signRequest(secret, { timestamp, method, path: full, body: raw }),
      ...(idem ? { 'idempotency-key': idem } : {}),
    },
    body: method === 'GET' ? undefined : raw,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

async function backendReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${cfg.apiUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

function record(r: Result) {
  results.push(r);
  const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⛔';
  console.log(`  ${icon} Test ${r.id} — ${r.name}: ${r.status}${r.status !== 'PASS' ? ` (${r.actual})` : ''}`);
}

async function main() {
  console.log('\nReclaimed — PHYSICAL hardware acceptance test (ACS ACR1252U)');
  console.log('Results come only from real reader events and live API responses.\n');
  const usb = findAcsReaders(listUsbDevices());
  const drv = driverStatus();
  await bridge.start();

  // ---- Test 1: reader detection
  let readerName = driver.readers()[0] ?? null;
  if (!readerName) {
    console.log('  Connect the ACR1252U now (waiting up to 60s)…');
    readerName = await readerEvent('READER_CONNECTED', 60_000);
  }
  record({
    id: 1, name: 'Reader detection', expected: 'ACR1252U discovered over USB and PC/SC (PICC slot).',
    actual: readerName ? `Detected PC/SC reader "${readerName}"` : 'No ACR1252 PICC reader appeared within 60s',
    status: readerName ? 'PASS' : 'FAIL',
    evidence: [`USB: ${usb.map((d) => `${d.name} VID 0x${d.vendorId?.toString(16)} PID 0x${d.productId?.toString(16)}`).join('; ') || 'no ACS USB device'}`, `Driver: ${drv.note}`, `PC/SC readers: ${driver.readers().join(', ') || 'none'}`],
    issues: readerName ? '' : 'Check cable/port; run npm run hardware:diagnose.',
  });
  if (!readerName) return finish();

  // ---- Test 2: NFC scan
  console.log('\n  Test 2: tap generic NFC card A and KEEP it on the reader.');
  const a = await nextPresentation();
  record({
    id: 2, name: 'NFC scan', expected: 'Card detected; type identified from ATR; UID read via GET DATA.',
    actual: a ? `Detected ${a.cardType}, UID ${mask(a.uid)}` : 'No card detected within 60s',
    status: a?.uid ? 'PASS' : a ? 'FAIL' : 'FAIL',
    evidence: a ? [`tapId ${a.tapId}`, `ATR ${a.atr}`, `presentedAt ${a.presentedAt}`] : [],
    issues: a && !a.uid ? 'Card detected but UID unreadable (unsupported card type?)' : '',
  });

  // ---- Test 3: removal
  console.log('\n  Test 3: remove the card from the reader.');
  const rem = await nextRemoval();
  record({
    id: 3, name: 'Card removal', expected: 'Removal event emitted for the same presentation.',
    actual: rem ? `Removal detected at ${rem.removedAt}` : 'No removal event within 60s',
    status: rem && a && rem.tapId === a.tapId ? 'PASS' : 'FAIL',
    evidence: rem ? [`tapId ${rem.tapId}`, `held ${Date.parse(rem.removedAt!) - Date.parse(rem.presentedAt)} ms`] : [],
    issues: '',
  });

  // ---- Test 4: repeated taps
  console.log('\n  Test 4: tap card A and HOLD it for ~5 seconds, remove it, then tap it again and remove it.');
  const seen: Presentation[] = [];
  const onP = (p: Presentation) => seen.push(p);
  bridge.on('presentation', onP);
  const r1 = await nextRemoval(90_000);
  const r2 = r1 ? await nextRemoval(60_000) : null;
  bridge.off('presentation', onP);
  const held = r1 ? Date.parse(r1.removedAt!) - Date.parse(r1.presentedAt) : 0;
  const okRepeat = seen.length === 2 && Boolean(r1 && r2) && seen[0]!.tapId !== seen[1]!.tapId && seen[0]!.uid === seen[1]!.uid;
  record({
    id: 4, name: 'Repeated taps', expected: 'Exactly one event per continuous presentation (2 placements → 2 events).',
    actual: `${seen.length} presentation event(s) for 2 placements; first hold ${held} ms`,
    status: okRepeat ? 'PASS' : 'FAIL',
    evidence: seen.map((p) => `tapId ${p.tapId} UID ${mask(p.uid)} at ${p.presentedAt}`),
    issues: held < 2000 ? 'First hold was shorter than 2s; repeat with a longer hold for stronger evidence.' : '',
  });

  // ---- Test 5: multiple cards
  const second = await ask('Test 5: do you have a SECOND generic NFC card? [y/N]');
  if (second === 'y') {
    console.log('  Tap card B (then remove it).');
    const b = await nextPresentation();
    await nextRemoval(30_000);
    const distinct = Boolean(b?.uid && a?.uid && b.uid !== a.uid);
    record({
      id: 5, name: 'Multiple cards', expected: 'Two cards produce distinct identifiers.',
      actual: b ? `Card B ${b.cardType} UID ${mask(b.uid)} vs card A ${mask(a?.uid ?? null)}` : 'Card B not detected',
      status: distinct ? 'PASS' : 'FAIL', evidence: b ? [`tapId ${b.tapId}`] : [], issues: '',
    });
  } else {
    record({ id: 5, name: 'Multiple cards', expected: 'Two cards produce distinct identifiers.', actual: 'Only one card available', status: 'BLOCKED', evidence: [], issues: 'Re-run with a second card.' });
  }

  // ---- Test 6: disconnection & recovery
  const doUnplug = await ask('Test 6: unplug/replug the reader now? [Y/n]');
  if (doUnplug !== 'n') {
    console.log('  Unplug the ACR1252U USB cable…');
    const gone = await readerEvent('READER_DISCONNECTED', 60_000);
    console.log(gone ? '  Disconnected. Plug it back in…' : '  (no disconnect seen)');
    const back = gone ? await readerEvent('READER_CONNECTED', 60_000) : null;
    let after: Presentation | null = null;
    if (back) {
      console.log('  Reconnected. Tap card A once more (then remove).');
      after = await nextPresentation(60_000);
      await nextRemoval(30_000);
    }
    record({
      id: 6, name: 'Disconnection', expected: 'Bridge survives unplug, reports it, and recovers on replug.',
      actual: !gone ? 'Disconnect not detected' : !back ? 'Reader did not come back within 60s' : after ? 'Recovered; card detected after reconnect' : 'Reconnected but no card detected',
      status: gone && back && after ? 'PASS' : 'FAIL',
      evidence: [`disconnected: ${gone ?? 'no'}`, `reconnected: ${back ?? 'no'}`, after ? `post-reconnect tapId ${after.tapId}` : ''].filter(Boolean),
      issues: '',
    });
  } else {
    record({ id: 6, name: 'Disconnection', expected: 'Bridge recovers on replug.', actual: 'Skipped by operator', status: 'BLOCKED', evidence: [], issues: '' });
  }

  // ---- Tests 7–10: backend
  const reachable = api ? await backendReachable() : false;
  const blocked = (id: number, name: string, expected: string, why: string) => record({ id, name, expected, actual: why, status: 'BLOCKED', evidence: [], issues: why });
  if (!api || !reachable) {
    const why = !api ? 'HARDWARE_BRIDGE_SECRET not set' : `API not reachable at ${cfg.apiUrl}`;
    blocked(7, 'Backend communication', 'Backend receives the tap.', why);
    blocked(8, 'Payment simulation', 'Tap during pending checkout → simulated authorization.', why);
    blocked(9, 'Frozen card', 'Frozen card tap → CARD_FROZEN decline.', why);
    blocked(10, 'Refund', 'Capture then refund the approved transaction.', why);
    return finish();
  }

  console.log('\n  Test 7: make sure card A is ENROLLED in the app (Cards → Reclaimed Card → Enroll). Then tap card A (and remove).');
  await ask('Press Enter when ready…');
  const t7 = await nextTapResult();
  await nextRemoval(30_000);
  const t7ok = t7 && 'r' in t7;
  record({
    id: 7, name: 'Backend communication', expected: 'Signed tap event accepted by the backend.',
    actual: !t7 ? 'No tap within 60s' : 'r' in t7 ? `Backend outcome ${t7.r.outcome}: ${t7.r.message}` : `Error: ${t7.err.message}`,
    status: t7ok ? 'PASS' : 'FAIL',
    evidence: t7 ? [`tapId ${t7.p.tapId}`] : [],
    issues: t7 && 'r' in t7 && t7.r.outcome === 'UNKNOWN_CARD' ? 'Card is not enrolled — enroll it before tests 8–10.' : '',
  });

  let approved: SimulatedTransactionDto | null = null;
  const checkout = async (amountCents: number, merchantName = 'Walmart') =>
    terminal<SimulatedTransactionDto>('POST', '/test-terminal/transactions', { merchantId: 'MID-WALMART-0001', merchantName, mcc: '5310', amountCents, currency: 'USD' });
  try {
    const c = await checkout(10_000);
    console.log(`\n  Test 8: checkout ${c.reference} for $100.00 at Walmart is waiting. Tap card A (and remove).`);
    const t8 = await nextTapResult();
    await nextRemoval(30_000);
    const res = t8 && 'r' in t8 ? t8.r : null;
    approved = res?.authorization?.result === 'APPROVED' ? res.transaction ?? null : null;
    record({
      id: 8, name: 'Payment simulation', expected: 'Simulated authorization runs for the pending checkout.',
      actual: res ? `Authorization ${res.authorization?.result ?? res.outcome} via ${res.transaction?.fundingAccountName ?? 'n/a'} (${res.authorization?.latency.totalMs ?? '?'} ms)` : 'No backend result',
      status: res?.outcome === 'AUTHORIZATION_STARTED' && res.authorization ? 'PASS' : 'FAIL',
      evidence: res ? [`transaction ${res.transaction?.reference}`, `state ${res.transaction?.state}`, `attempts ${res.authorization?.fundingAttempts.map((f) => `${f.fundingAccountName}:${f.result}`).join(', ')}`] : [],
      issues: res?.authorization && res.authorization.result !== 'APPROVED' ? `Declined (${res.authorization.declineReason}) — configure mock funding in the app.` : '',
    });
  } catch (err) {
    blocked(8, 'Payment simulation', 'Tap during pending checkout → simulated authorization.', (err as Error).message);
  }

  const frz = await ask('Test 9: FREEZE the card in the app (Cards → Reclaimed Card → Freeze), then press Enter (or type s to skip)…');
  if (frz !== 's') {
    try {
      const c = await checkout(500, 'Starbucks');
      console.log(`  Checkout ${c.reference} waiting. Tap card A (and remove).`);
      const t9 = await nextTapResult();
      await nextRemoval(30_000);
      const res = t9 && 'r' in t9 ? t9.r : null;
      record({
        id: 9, name: 'Frozen card', expected: 'Simulated decline with CARD_FROZEN.',
        actual: res ? `Result ${res.authorization?.result ?? res.outcome}` : 'No backend result',
        status: res?.authorization?.result === 'CARD_FROZEN' ? 'PASS' : 'FAIL',
        evidence: res ? [`transaction ${res.transaction?.reference} state ${res.transaction?.state}`] : [], issues: 'Remember to unfreeze the card.',
      });
    } catch (err) {
      blocked(9, 'Frozen card', 'CARD_FROZEN decline.', (err as Error).message);
    }
  } else blocked(9, 'Frozen card', 'CARD_FROZEN decline.', 'Skipped by operator');

  if (approved) {
    try {
      await terminal('POST', `/test-terminal/transactions/${approved.id}/capture`);
      const refunded = await terminal<SimulatedTransactionDto>('POST', `/test-terminal/transactions/${approved.id}/refund`, {}, `hwtest-refund-${approved.id}`);
      record({
        id: 10, name: 'Refund', expected: 'Captured simulated transaction fully refunded.',
        actual: `State ${refunded.state}, refunded ${refunded.refundedCents} cents`, status: refunded.state === 'REFUNDED' ? 'PASS' : 'FAIL',
        evidence: [`transaction ${refunded.reference}`], issues: '',
      });
    } catch (err) {
      record({ id: 10, name: 'Refund', expected: 'Captured simulated transaction fully refunded.', actual: (err as Error).message, status: 'FAIL', evidence: [], issues: '' });
    }
  } else blocked(10, 'Refund', 'Capture then refund an approved transaction.', 'Test 8 did not produce an approved transaction');
  return finish();
}

function finish() {
  const now = new Date().toISOString();
  const all = [...results].sort((x, y) => x.id - y.id);
  const md = [
    '# Reclaimed — Physical Hardware Test Results',
    '',
    `Generated by \`npm run hardware:test\` at **${now}** on ${driverStatus().platform}.`,
    `Reader filter: \`${cfg.readerFilter.source}\` · Bridge: \`${cfg.bridgeId}\` · API: ${cfg.apiUrl}`,
    '',
    'Every result below was produced by real PC/SC events from the ACS ACR1252U and live API responses during this run.',
    '',
    '| # | Test | Expected | Actual | Status |',
    '|---|------|----------|--------|--------|',
    ...all.map((r) => `| ${r.id} | ${r.name} | ${r.expected} | ${r.actual.replace(/\|/g, '/')} | **${r.status}** |`),
    '',
    '## Evidence and remaining issues',
    '',
    ...all.flatMap((r) => [`### Test ${r.id} — ${r.name} (${r.status})`, '', ...(r.evidence.length ? r.evidence.map((e) => `- ${e}`) : ['- (none)']), r.issues ? `- Remaining issue: ${r.issues}` : '', '']),
  ].join('\n');
  const repoRoot = resolve(process.cwd(), '..', '..');
  writeFileSync(join(repoRoot, 'docs', 'hardware-test-results.md'), md);
  mkdirSync(join(repoRoot, '.hardware-test-results'), { recursive: true });
  writeFileSync(join(repoRoot, '.hardware-test-results', `physical-${Date.now()}.json`), JSON.stringify({ generatedAt: now, results: all }, null, 2));
  console.log(`\n  Wrote docs/hardware-test-results.md (${all.filter((r) => r.status === 'PASS').length}/${all.length} PASS)\n`);
  rl.close();
  void bridge.stop().finally(() => process.exit(all.every((r) => r.status === 'PASS') ? 0 : 1));
}

main().catch((err) => {
  console.error(err);
  finish();
});
