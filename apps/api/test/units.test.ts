import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { signRequest } from '@reclaimed/shared/node';
import { TokenCipher, maskUid, uidFingerprint } from '../src/lib/crypto.js';
import { scoreMatches } from '../src/services/card-matching.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { createHarness, createUser, TERMINAL_CODE, TERMINAL_SECRET } from './helpers.js';
import { SharedSecretAuthVerifier } from '../src/lib/auth.js';

describe('crypto helpers', () => {
  it('round-trips and authenticates Plaid token ciphertext', () => {
    const c = new TokenCipher(Buffer.alloc(32, 1).toString('base64'));
    const env = c.encrypt('access-sandbox-123');
    expect(env).not.toContain('access-sandbox');
    expect(c.decrypt(env)).toBe('access-sandbox-123');
    const tampered = env.slice(0, -4) + (env.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => c.decrypt(tampered)).toThrow();
    expect(() => new TokenCipher('short')).toThrow(/32 bytes/);
  });
  it('fingerprints UIDs case-insensitively and masks them', () => {
    expect(uidFingerprint('pepper-pepper-pepper', '04a1b2')).toBe(uidFingerprint('pepper-pepper-pepper', '04A1B2'));
    expect(maskUid('04a1b2c3')).toBe('••••B2C3');
  });
});

describe('card product matching heuristics', () => {
  const p = (issuer: string, name: string, slug: string, kw: string[]) => ({ id: slug, issuer_name: issuer, product_name: name, product_slug: slug, card_network: 'VISA' as const, match_keywords: kw });
  const products = [p('Citi', 'Citi Double Cash', 'citi-double-cash', ['double cash']), p('Citi', 'Citi Custom Cash', 'citi-custom-cash', ['custom cash'])];
  it('does not confuse Citizens Bank with Citi', () => {
    expect(scoreMatches({ institution: 'Citizens Bank', name: 'Citizens Rewards Card', officialName: null }, products).matches).toEqual([]);
  });
  it('returns a single strong match as unambiguous', () => {
    const r = scoreMatches({ institution: 'Citibank Online', name: 'Citi Double Cash® Card', officialName: null }, products);
    expect(r.ambiguous).toBe(false);
    expect(r.matches[0]!.product.productSlug).toBe('citi-double-cash');
  });
});

describe('realtime hub', () => {
  it('authenticates users and terminals and routes events to the right sockets', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const hub = new RealtimeHub({ db: h.db, authVerifier: new SharedSecretAuthVerifier('test-jwt-secret-that-is-long-enough-123'), terminalSecrets: new Map([[TERMINAL_CODE, TERMINAL_SECRET]]), logger: createLogger('silent', false), hardwareToUsers: true });
    const server = createServer();
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, r));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/realtime`;
    const connect = (auth: object) =>
      new Promise<{ ws: WebSocket; messages: unknown[] }>((resolve, reject) => {
        const ws = new WebSocket(url);
        const messages: unknown[] = [];
        ws.on('message', (m) => {
          const msg = JSON.parse(String(m));
          messages.push(msg);
          if (msg.type === 'ready') resolve({ ws, messages });
          if (msg.type === 'error') reject(new Error(msg.message));
        });
        ws.on('open', () => ws.send(JSON.stringify(auth)));
      });
    const u = await connect({ type: 'auth', accessToken: user.token });
    const ts = new Date().toISOString();
    const t = await connect({ type: 'auth_terminal', terminalId: TERMINAL_CODE, timestamp: ts, signature: signRequest(TERMINAL_SECRET, { timestamp: ts, method: 'WS', path: '/api/v1/realtime', body: TERMINAL_CODE }) });
    await expect(connect({ type: 'auth', accessToken: 'bogus' })).rejects.toThrow(/failed/);

    hub.toUser(user.id, { type: 'card.updated', reclaimedCardId: 'c1' });
    hub.toTerminal(h.terminalId, { type: 'plaid.synced', plaidItemId: 'x' });
    await new Promise((r) => setTimeout(r, 100));
    expect(u.messages).toContainEqual({ type: 'event', event: { type: 'card.updated', reclaimedCardId: 'c1' } });
    expect(u.messages).not.toContainEqual(expect.objectContaining({ event: { type: 'plaid.synced', plaidItemId: 'x' } }));
    expect(t.messages).toContainEqual({ type: 'event', event: { type: 'plaid.synced', plaidItemId: 'x' } });
    u.ws.close();
    t.ws.close();
    hub.close();
    server.close();
  });
});

describe('Plaid configuration', () => {
  it('defaults to transactions in the US', () => {
    const c = loadConfig({});
    expect(c.PLAID_PRODUCTS).toEqual(['transactions']);
    expect(c.PLAID_COUNTRY_CODES).toEqual(['US']);
  });

  it('parses, normalizes and de-duplicates comma-separated lists', () => {
    const c = loadConfig({ PLAID_PRODUCTS: 'Transactions, liabilities,transactions', PLAID_COUNTRY_CODES: 'us,ca' });
    expect(c.PLAID_PRODUCTS).toEqual(['transactions', 'liabilities']);
    expect(c.PLAID_COUNTRY_CODES).toEqual(['US', 'CA']);
  });

  it('rejects unknown values and product lists without transactions', () => {
    expect(() => loadConfig({ PLAID_PRODUCTS: 'transactions,bogus' })).toThrow(/PLAID_PRODUCTS/);
    expect(() => loadConfig({ PLAID_PRODUCTS: 'liabilities' })).toThrow(/must include transactions/);
    expect(() => loadConfig({ PLAID_COUNTRY_CODES: 'XX' })).toThrow(/PLAID_COUNTRY_CODES/);
  });

  it('refuses production Plaid in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PLAID_ENV: 'production' })).toThrow(/not permitted/);
  });
});
