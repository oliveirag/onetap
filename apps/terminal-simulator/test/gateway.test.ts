import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyRequestSignature } from '@reclaimed/shared/node';
import { createGateway } from '../server/gateway.js';

let servers: { close: () => void }[] = [];
afterEach(() => { servers.forEach((s) => s.close()); servers = []; });

async function listen(s: Server) {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

describe('terminal gateway', () => {
  it('signs checkout requests for the API and never exposes the secret to the browser', async () => {
    const seen: { headers: Record<string, string | string[] | undefined>; body: string; url: string }[] = [];
    const fakeApi = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ headers: req.headers, body, url: req.url! });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: true, data: { id: 't1', state: 'CREATED' }, requestId: 'r' }));
      });
    });
    servers.push(fakeApi);
    const apiUrl = await listen(fakeApi);
    const gw = createGateway({ TERMINAL_API_URL: apiUrl, TEST_TERMINAL_ID: 'TERM-X', TEST_TERMINAL_SECRET: 'super-secret-terminal-key' } as NodeJS.ProcessEnv);
    servers.push(gw);
    const gwUrl = await listen(gw.server);

    const cfg = await (await fetch(`${gwUrl}/gateway/config`)).json();
    expect(JSON.stringify(cfg)).not.toContain('super-secret');
    expect(cfg.data.merchants[0].merchantName).toBe('Walmart');

    const r = await fetch(`${gwUrl}/gateway/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ merchantId: 'MID-WALMART-0001', merchantName: 'Walmart', mcc: '5310', amountCents: 10000, currency: 'USD' }) });
    expect((await r.json()).data.id).toBe('t1');
    const req = seen.find((s) => s.url === '/api/v1/test-terminal/transactions')!;
    expect(req.headers['x-reclaimed-terminal-id']).toBe('TERM-X');
    expect(verifyRequestSignature('super-secret-terminal-key', { timestamp: String(req.headers['x-reclaimed-timestamp']), method: 'POST', path: '/api/v1/test-terminal/transactions', body: req.body }, String(req.headers['x-reclaimed-signature']))).toBe(true);
  });

  it('rejects invalid checkout input before calling the API', async () => {
    const gw = createGateway({ TERMINAL_API_URL: 'http://127.0.0.1:9', TEST_TERMINAL_SECRET: 'x'.repeat(20) } as NodeJS.ProcessEnv);
    servers.push(gw);
    const gwUrl = await listen(gw.server);
    const r = await fetch(`${gwUrl}/gateway/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountCents: -1 }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('VALIDATION_FAILED');
  });
});
