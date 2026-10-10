import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCents, parseDollarsToCents, TEST_MODE_BANNER, type AuthorizationDto, type HardwareStatusDto, type SimulatedTransactionDto, type TestMerchant } from '@reclaimed/shared';
import { gateway, GatewayError, type GatewayConfig } from './api';

type LogEntry = { at: string; text: string; tone?: 'ok' | 'bad' | 'info' };

const RESULT_COPY: Record<string, string> = {
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  CARD_FROZEN: 'Card frozen',
  INVALID_CARD: 'Card not recognized',
  INSUFFICIENT_FUNDS: 'Insufficient funds',
  LIMIT_EXCEEDED: 'Limit exceeded',
  AUTHORIZATION_TIMEOUT: 'Timed out',
  INTERNAL_ERROR: 'System error',
};

export function App() {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [status, setStatus] = useState<HardwareStatusDto | null>(null);
  const [merchant, setMerchant] = useState<TestMerchant | null>(null);
  const [amount, setAmount] = useState('100.00');
  const [txn, setTxn] = useState<SimulatedTransactionDto | null>(null);
  const [auth, setAuth] = useState<AuthorizationDto | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upstream, setUpstream] = useState('connecting');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  const txnId = useRef<string | null>(null);

  const addLog = useCallback((text: string, tone?: LogEntry['tone']) => setLog((l) => [{ at: new Date().toLocaleTimeString(), text, tone }, ...l].slice(0, 40)), []);

  const refreshStatus = useCallback(() => gateway.status().then(setStatus).catch((e: Error) => setError(e.message)), []);
  const refreshTxn = useCallback(async () => {
    if (!txnId.current) return;
    const r = await gateway.transaction(txnId.current);
    setTxn(r.transaction);
    setAuth(r.authorization);
  }, []);

  useEffect(() => {
    gateway.config().then((c) => {
      setConfig(c);
      setMerchant(c.merchants[0] ?? null);
    }).catch((e: Error) => setError(e.message));
    void refreshStatus();
    const s = setInterval(refreshStatus, 5000);
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => { clearInterval(s); clearInterval(t); };
  }, [refreshStatus]);

  // Realtime relay from the gateway (authenticated upstream WebSocket).
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gateway/events`);
      ws.onmessage = (m) => {
        const e = JSON.parse(m.data);
        if (e.type === 'gateway.status') setUpstream(e.upstream);
        if (e.type === 'payment.updated' && e.transaction.id === txnId.current) {
          setTxn(e.transaction);
          if (e.authorization) setAuth(e.authorization);
          if (e.transaction.state === 'AUTHORIZATION_PENDING') addLog('Card tapped — authorizing…', 'info');
        }
        if (e.type === 'hardware.tap') {
          addLog(`NFC tap ${e.tap.uidMasked} (${e.tap.cardType ?? 'card'}) → ${e.tap.outcome}`, e.tap.outcome === 'UNKNOWN_CARD' || e.tap.outcome === 'DUPLICATE_TAP' ? 'bad' : 'info');
        }
        if (e.type === 'hardware.reader') {
          addLog(`Reader ${e.reader.connected ? 'connected' : 'disconnected'}: ${e.reader.readerName}`, e.reader.connected ? 'ok' : 'bad');
          void refreshStatus();
        }
      };
      ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
    };
    connect();
    return () => { closed = true; ws?.close(); };
  }, [addLog, refreshStatus]);

  // Polling fallback while waiting for a tap.
  useEffect(() => {
    if (!txn || !['CREATED', 'AUTHORIZATION_PENDING', 'SETTLEMENT_PENDING'].includes(txn.state)) return;
    const i = setInterval(() => void refreshTxn().catch(() => undefined), 1500);
    return () => clearInterval(i);
  }, [txn, refreshTxn]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof GatewayError ? `${e.code}: ${e.message}` : (e as Error).message); } finally { setBusy(false); }
  };

  const startCheckout = () => run(async () => {
    const cents = parseDollarsToCents(amount);
    if (!merchant || !cents) throw new Error('Choose a merchant and enter a valid amount.');
    const t = await gateway.checkout({ merchantId: merchant.merchantId, merchantName: merchant.merchantName, mcc: merchant.mcc, amountCents: cents, currency: 'USD' });
    txnId.current = t.id;
    setTxn(t);
    setAuth(null);
    addLog(`Checkout ${t.reference} created — ${merchant.merchantName} ${formatCents(cents)}`, 'info');
  });

  const act = (action: 'capture' | 'settle' | 'reverse' | 'refund' | 'cancel') => run(async () => {
    if (!txn) return;
    const body = action === 'refund' && refundAmount ? { amountCents: parseDollarsToCents(refundAmount) ?? undefined } : action === 'settle' ? { immediate: false } : {};
    const t = await gateway.action(txn.id, action, body);
    setTxn(t);
    addLog(`${action[0]!.toUpperCase()}${action.slice(1)} → ${t.state}`, 'ok');
    setRefundAmount('');
  });

  const reader = status?.readers.find((r) => r.connected) ?? status?.readers[0];
  const phase = useMemo(() => {
    if (!txn) return 'idle';
    if (txn.state === 'CREATED') return 'waiting';
    if (txn.state === 'AUTHORIZATION_PENDING') return 'authorizing';
    if (txn.authorizationResult === 'APPROVED') return 'approved';
    if (txn.state === 'FAILED' && !txn.authorizationResult) return 'expired';
    return 'declined';
  }, [txn]);
  const secondsLeft = txn ? Math.max(0, Math.round((Date.parse(txn.expiresAt) - now) / 1000)) : 0;

  return (
    <div className="shell">
      <div className="banner">{TEST_MODE_BANNER} · Simulated authorization only · Not a certified payment terminal</div>
      <header className="top">
        <div className="brand"><span className="mark">R</span> Reclaimed <span className="muted">Test Terminal {config?.terminalCode ?? ''}</span></div>
        <div className="pills">
          <Pill ok={Boolean(reader?.connected)} label={reader ? `${reader.model ?? 'Reader'} ${reader.connected ? 'connected' : 'disconnected'}` : 'No NFC reader'} />
          <Pill ok={Boolean(status?.bridgeConnected)} label={status?.bridgeConnected ? 'Bridge online' : 'Bridge offline'} />
          <Pill ok={upstream === 'ready'} label={upstream === 'ready' ? 'Live updates' : `Realtime ${upstream}`} />
          <Pill ok label={`Processor: ${status?.paymentMode ?? '—'}`} neutral />
        </div>
      </header>

      {error && <div className="error" role="alert">{error}</div>}
      {config && !config.configured && <div className="error">TEST_TERMINAL_SECRET is not set for the gateway. See docs/setup.md.</div>}

      <main className="grid">
        <section className="panel">
          <h2>New sale</h2>
          <label className="field">Merchant
            <select value={merchant?.merchantId ?? ''} onChange={(e) => setMerchant(config?.merchants.find((m) => m.merchantId === e.target.value) ?? null)} disabled={busy}>
              {config?.merchants.map((m) => <option key={m.merchantId} value={m.merchantId}>{m.merchantName} — MCC {m.mcc}</option>)}
            </select>
          </label>
          <div className="meta">
            <div><span>Merchant ID</span><code>{merchant?.merchantId}</code></div>
            <div><span>MCC</span><code>{merchant?.mcc}</code> <small>{merchant?.category}</small></div>
            <div><span>Currency</span><code>USD</code></div>
          </div>
          <label className="field">Amount (USD)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
          </label>
          <div className="quick">{['5.00', '25.00', '100.00', '2500.00'].map((v) => <button key={v} className="chip" onClick={() => setAmount(v)}>${v}</button>)}</div>
          <button className="primary" onClick={startCheckout} disabled={busy || phase === 'waiting' || phase === 'authorizing'}>Start checkout</button>
          {(phase === 'waiting') && <button className="ghost" onClick={() => act('cancel')} disabled={busy}>Cancel checkout</button>}
        </section>

        <section className={`screen ${phase}`} aria-live="polite">
          <div className="screen-head">
            <div>{txn?.merchantName ?? merchant?.merchantName ?? 'Merchant'}</div>
            <div className="mono">{txn?.reference ?? 'No transaction'}</div>
          </div>
          <div className="amount">{formatCents(txn?.amountCents ?? parseDollarsToCents(amount) ?? 0)}</div>
          <div className="state">
            {phase === 'idle' && <><div className="big">Ready</div><p>Enter a sale to begin.</p></>}
            {phase === 'waiting' && <><NfcIcon /><div className="big">Tap Reclaimed Card</div><p>Waiting for card · {secondsLeft}s</p></>}
            {phase === 'authorizing' && <><div className="spinner" /><div className="big">Authorizing…</div><p>Simulated authorization in progress</p></>}
            {phase === 'approved' && <><div className="big">✓ Approved</div><p>Funded by {txn?.fundingAccountName} (mock)</p></>}
            {phase === 'declined' && <><div className="big">✕ {RESULT_COPY[txn?.authorizationResult ?? 'DECLINED']}</div><p>{txn?.declineReason}</p></>}
            {phase === 'expired' && <><div className="big">Checkout ended</div><p>{txn?.declineReason}</p></>}
          </div>
          {txn && (
            <dl className="facts">
              <div><dt>Status</dt><dd>{txn.state}</dd></div>
              <div><dt>Authorization</dt><dd>{txn.authorizationResult ?? '—'}</dd></div>
              <div><dt>Captured</dt><dd>{formatCents(txn.capturedCents)}</dd></div>
              <div><dt>Refunded</dt><dd>{formatCents(txn.refundedCents)}</dd></div>
              {auth && <div><dt>Latency</dt><dd>{auth.latency.totalMs} ms (db {auth.latency.dbLookupMs} · funding {auth.latency.fundingEvaluationMs} · processor {auth.latency.processorMs})</dd></div>}
              {auth && auth.fundingAttempts.length > 0 && <div className="wide"><dt>Funding attempts</dt><dd>{auth.fundingAttempts.map((f) => `${f.sequence}. ${f.fundingAccountName}: ${f.result}`).join(' → ')}</dd></div>}
            </dl>
          )}
          {txn && (
            <div className="actions">
              <button onClick={() => act('capture')} disabled={busy || txn.state !== 'AUTHORIZED'}>Capture</button>
              <button onClick={() => act('settle')} disabled={busy || !['CAPTURED', 'PARTIALLY_REFUNDED'].includes(txn.state)}>Settle</button>
              <button onClick={() => act('reverse')} disabled={busy || txn.state !== 'AUTHORIZED'}>Reverse</button>
              <span className="refund">
                <input placeholder="Refund $ (blank = full)" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
                <button onClick={() => act('refund')} disabled={busy || !['CAPTURED', 'SETTLED', 'PARTIALLY_REFUNDED'].includes(txn.state)}>Refund</button>
              </span>
            </div>
          )}
        </section>

        <section className="panel log">
          <h2>Activity</h2>
          {reader && <p className="muted small">Last card: {reader.lastUidMasked ?? '—'} {reader.lastCardType ? `(${reader.lastCardType})` : ''} · {reader.lastCardPresentAt ? new Date(reader.lastCardPresentAt).toLocaleTimeString() : 'never'}</p>}
          <ul>{log.map((l, i) => <li key={i} className={l.tone}><time>{l.at}</time>{l.text}</li>)}</ul>
          {log.length === 0 && <p className="muted small">Taps, reader events and transaction updates appear here in real time.</p>}
        </section>
      </main>
    </div>
  );
}

function Pill({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
  return <span className={`pill ${neutral ? 'neutral' : ok ? 'ok' : 'bad'}`}><i />{label}</span>;
}

function NfcIcon() {
  return (
    <svg className="nfc" viewBox="0 0 64 64" aria-hidden>
      <path d="M22 18c6 8 6 20 0 28" /><path d="M31 12c9 12 9 28 0 40" /><path d="M40 6c12 16 12 36 0 52" />
    </svg>
  );
}
