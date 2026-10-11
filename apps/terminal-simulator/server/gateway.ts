/**
 * Terminal gateway: holds the terminal secret server-side, signs requests to the
 * Reclaimed API, and relays the terminal's authenticated realtime stream to the
 * browser UI. The browser never sees the secret.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { ZodError } from 'zod';
import { API_PREFIX, TEST_MERCHANTS, createCheckoutSchema, refundSchema } from '@reclaimed/shared';
import { createTerminalClient, signRequest, TerminalApiError } from '@reclaimed/shared/node';

export function createGateway(env = process.env) {
  const apiUrl = env.TERMINAL_API_URL ?? env.APP_BASE_URL ?? 'http://localhost:4000';
  const terminalCode = env.TEST_TERMINAL_ID ?? 'TERM-DEV-001';
  const secret = env.TEST_TERMINAL_SECRET ?? '';
  const api = createTerminalClient({ baseUrl: apiUrl, terminalCode, secret });
  const app = express();
  app.use(express.json());

  const forward = (fn: (req: express.Request) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
    try {
      res.json({ success: true, data: await fn(req) });
    } catch (err) {
      if (err instanceof TerminalApiError) return res.status(err.status).json(err.body ?? { success: false, error: { code: err.code, message: err.message } });
      if (err instanceof ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION_FAILED', message: err.issues[0]?.message ?? 'Invalid input', retryable: false } });
      res.status(502).json({ success: false, error: { code: 'HARDWARE_BRIDGE_UNAVAILABLE', message: `Reclaimed API unreachable at ${apiUrl}: ${(err as Error).message}`, retryable: true } });
    }
  };

  app.get('/gateway/config', (_req, res) => res.json({ success: true, data: { terminalCode, apiUrl, merchants: TEST_MERCHANTS, configured: Boolean(secret) } }));
  app.get('/gateway/status', forward(() => api('GET', '/test-terminal/status')));
  app.post('/gateway/checkout', forward((req) => api('POST', '/test-terminal/transactions', createCheckoutSchema.parse(req.body), req.header('idempotency-key') ?? undefined)));
  app.get('/gateway/transactions/:id', forward((req) => api('GET', `/test-terminal/transactions/${encodeURIComponent(String(req.params.id))}`)));
  app.post('/gateway/transactions/:id/:action', forward(async (req) => {
    const action = String(req.params.action);
    if (!['capture', 'settle', 'reverse', 'refund', 'cancel'].includes(action)) throw new TerminalApiError(404, 'NOT_FOUND', 'Unknown action', null);
    const body = action === 'refund' ? refundSchema.parse(req.body ?? {}) : (req.body ?? {});
    return api('POST', `/test-terminal/transactions/${encodeURIComponent(String(req.params.id))}/${action}`, body, req.header('idempotency-key') ?? undefined);
  }));

  // Serve the built UI in non-dev mode.
  const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
  if (existsSync(web)) app.use(express.static(web));

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/gateway/events' });
  const browsers = new Set<WebSocket>();
  let upstream: WebSocket | null = null;
  let upstreamReady = false;

  const broadcast = (msg: unknown) => {
    for (const b of browsers) if (b.readyState === WebSocket.OPEN) b.send(JSON.stringify(msg));
  };
  const connectUpstream = () => {
    if (!secret) return;
    const ws = new WebSocket(`${apiUrl.replace(/^http/, 'ws')}${API_PREFIX}/realtime`);
    upstream = ws;
    ws.on('open', () => {
      const timestamp = new Date().toISOString();
      ws.send(JSON.stringify({ type: 'auth_terminal', terminalId: terminalCode, timestamp, signature: signRequest(secret, { timestamp, method: 'WS', path: `${API_PREFIX}/realtime`, body: terminalCode }) }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'ready') upstreamReady = true;
      broadcast(msg.type === 'event' ? msg.event : { type: 'gateway.status', upstream: msg.type });
    });
    ws.on('close', () => {
      upstreamReady = false;
      broadcast({ type: 'gateway.status', upstream: 'disconnected' });
      setTimeout(connectUpstream, 2_000);
    });
    ws.on('error', () => undefined);
  };
  wss.on('connection', (b) => {
    browsers.add(b);
    b.send(JSON.stringify({ type: 'gateway.status', upstream: upstreamReady ? 'ready' : 'connecting' }));
    b.on('close', () => browsers.delete(b));
  });
  connectUpstream();
  return { app, server, close: () => { upstream?.removeAllListeners(); upstream?.close(); wss.close(); server.close(); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.TERMINAL_GATEWAY_PORT ?? 5174);
  const { server } = createGateway();
  server.listen(port, '127.0.0.1', () => {
    console.log(`[terminal] gateway on http://127.0.0.1:${port} — open the UI at http://localhost:5173`);
    if (!process.env.TEST_TERMINAL_SECRET) console.warn('[terminal] TEST_TERMINAL_SECRET is not set; requests will fail authentication.');
  });
}
