import { describe, expect, it, vi } from 'vitest';
import type { HardwareReaderEvent, TapEvent, TapResultDto } from '@reclaimed/shared';
import { verifyRequestSignature } from '@reclaimed/shared/node';
import { HardwareBridge, type Presentation } from '../src/bridge.js';
import { MockReaderDriver } from '../src/driver/mock-driver.js';
import { parseAtr } from '../src/atr.js';
import { parseGetDataResponse } from '../src/uid.js';
import { HttpBridgeApi, type BridgeApi } from '../src/api-client.js';
import { detectReaderModelFromName } from './util.js';

const READER = 'ACS ACR1252 1S CL Reader PICC 0';
const silent = { info: () => {}, warn: () => {}, error: () => {} };

class FakeApi implements BridgeApi {
  taps: TapEvent[] = [];
  events: HardwareReaderEvent[] = [];
  async sendTap(t: TapEvent): Promise<TapResultDto> {
    this.taps.push(t);
    return { tapId: t.tapId, outcome: 'NO_PENDING_CHECKOUT', message: 'ok' };
  }
  async sendReaderEvent(e: HardwareReaderEvent) {
    this.events.push(e);
  }
  async heartbeat() {}
}

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('HardwareBridge (mock driver — NOT physical evidence)', () => {
  it('initializes, reports reader connect, detects a card and sends one tap', async () => {
    const d = new MockReaderDriver();
    const api = new FakeApi();
    const b = new HardwareBridge(d, api, silent, { bridgeId: 'b1', heartbeatMs: 0 });
    await b.start();
    d.connectReader(READER);
    d.present(READER, '04A1B2C3D4E5F6');
    await flush();
    expect(api.events.map((e) => e.type)).toEqual(['READER_CONNECTED']);
    expect(api.taps).toHaveLength(1);
    expect(api.taps[0]).toMatchObject({ uid: '04A1B2C3D4E5F6', readerName: READER, cardType: 'MIFARE Classic 1K', bridgeId: 'b1' });
  });

  it('emits exactly one tap per continuous presentation and a new one after removal', async () => {
    const d = new MockReaderDriver();
    const api = new FakeApi();
    const b = new HardwareBridge(d, api, silent, { bridgeId: 'b1', heartbeatMs: 0 });
    const removed: Presentation[] = [];
    b.on('removed', (p) => removed.push(p));
    await b.start();
    d.connectReader(READER);
    d.present(READER, '04A1B2C3D4E5F6');
    d.present(READER, '04A1B2C3D4E5F6'); // driver re-notifies while the card is still there
    d.present(READER, '04A1B2C3D4E5F6');
    await flush();
    expect(api.taps).toHaveLength(1);
    d.remove(READER);
    await flush();
    expect(removed).toHaveLength(1);
    expect(api.events.map((e) => e.type)).toContain('CARD_REMOVED');
    d.present(READER, '04A1B2C3D4E5F6');
    await flush();
    expect(api.taps).toHaveLength(2);
    expect(api.taps[0]!.tapId).not.toBe(api.taps[1]!.tapId);
  });

  it('distinguishes two cards', async () => {
    const d = new MockReaderDriver();
    const api = new FakeApi();
    const b = new HardwareBridge(d, api, silent, { bridgeId: 'b1', heartbeatMs: 0 });
    await b.start();
    d.connectReader(READER);
    d.present(READER, '04AAAAAAAAAAAA');
    await flush();
    d.remove(READER);
    d.present(READER, '04BBBBBBBBBBBB');
    await flush();
    expect(api.taps.map((t) => t.uid)).toEqual(['04AAAAAAAAAAAA', '04BBBBBBBBBBBB']);
  });

  it('reports unsupported cards without sending a tap', async () => {
    const d = new MockReaderDriver();
    const api = new FakeApi();
    const b = new HardwareBridge(d, api, silent, { bridgeId: 'b1', heartbeatMs: 0 });
    await b.start();
    d.connectReader(READER);
    d.failNextTransmit = Object.assign(new Error('SCARD_W_UNRESPONSIVE_CARD'), { code: 'SCARD_W_UNRESPONSIVE_CARD' });
    d.present(READER, '04A1B2C3D4E5F6', '3B00');
    await flush();
    expect(api.taps).toHaveLength(0);
    expect(api.events.at(-1)).toMatchObject({ type: 'READER_ERROR', detail: { code: 'NFC_CARD_UNSUPPORTED' } });
    expect(b.stats.errors).toBe(1);
  });

  it('survives reader disconnection and recovers on reconnection', async () => {
    const d = new MockReaderDriver();
    const api = new FakeApi();
    const b = new HardwareBridge(d, api, silent, { bridgeId: 'b1', heartbeatMs: 0 });
    await b.start();
    d.connectReader(READER);
    d.present(READER, '04A1B2C3D4E5F6');
    await flush();
    d.disconnectReader(READER);
    d.connectReader(READER);
    d.present(READER, '04A1B2C3D4E5F6');
    await flush();
    expect(api.events.map((e) => e.type)).toEqual(['READER_CONNECTED', 'CARD_REMOVED', 'READER_DISCONNECTED', 'READER_CONNECTED']);
    expect(api.taps).toHaveLength(2);
  });

  it('keeps running when the backend is unreachable', async () => {
    const d = new MockReaderDriver();
    const api = new FakeApi();
    api.sendTap = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const b = new HardwareBridge(d, api, silent, { bridgeId: 'b1', heartbeatMs: 0 });
    const errors: Error[] = [];
    b.on('tapError', (_p, e) => errors.push(e));
    await b.start();
    d.connectReader(READER);
    d.present(READER, '04A1B2C3D4E5F6');
    await flush();
    expect(errors[0]!.message).toBe('ECONNREFUSED');
  });
});

describe('HttpBridgeApi', () => {
  it('signs requests with HMAC and retries transient failures with the same tapId', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let n = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      n += 1;
      if (n === 1) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ success: true, data: { tapId: 'x', outcome: 'NO_PENDING_CHECKOUT', message: 'ok' }, requestId: 'r' }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = new HttpBridgeApi({ baseUrl: 'http://api.test', secret: 'secret-secret-secret', bridgeId: 'b1', fetchImpl });
    const tap: TapEvent = { tapId: '9f0e3c1a-2b3c-4d5e-8f70-1a2b3c4d5e6f', readerName: READER, bridgeId: 'b1', uid: '04A1B2C3', presentedAt: new Date().toISOString() };
    await api.sendTap(tap);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init.body).toBe(calls[1]!.init.body);
    const h = calls[1]!.init.headers as Record<string, string>;
    expect(verifyRequestSignature('secret-secret-secret', { timestamp: h['x-reclaimed-timestamp']!, method: 'POST', path: '/api/v1/hardware/tap-events', body: String(calls[1]!.init.body) }, h['x-reclaimed-signature']!)).toBe(true);
  });

  it('does not retry non-retryable errors', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      return new Response(JSON.stringify({ success: false, error: { code: 'HARDWARE_AUTH_FAILED', message: 'bad', retryable: false }, requestId: 'r' }), { status: 401 });
    }) as unknown as typeof fetch;
    const api = new HttpBridgeApi({ baseUrl: 'http://api.test', secret: 's'.repeat(16), bridgeId: 'b1', fetchImpl });
    await expect(api.heartbeat([])).rejects.toMatchObject({ code: 'HARDWARE_AUTH_FAILED' });
    expect(n).toBe(1);
  });
});

describe('card identification', () => {
  it('parses PC/SC Part 3 ATRs', () => {
    expect(parseAtr('3B8F8001804F0CA000000306030001000000006A')).toMatchObject({ cardType: 'MIFARE Classic 1K', supported: true });
    expect(parseAtr('3B8F8001804F0CA0000003060300030000000068').cardType).toBe('MIFARE Ultralight / NTAG21x');
    expect(parseAtr('3B8180018080').standard).toBe('ISO14443-4');
    expect(parseAtr('3B00').supported).toBe(false);
  });
  it('parses GET DATA responses and status words', () => {
    expect(parseGetDataResponse(Uint8Array.of(0x04, 0xa1, 0xb2, 0xc3, 0x90, 0x00))).toBe('04A1B2C3');
    expect(() => parseGetDataResponse(Uint8Array.of(0x6a, 0x81))).toThrow(/not supported/);
    expect(() => parseGetDataResponse(Uint8Array.of(0x63, 0x00))).toThrow(/SW=6300/);
  });
  it('filters the ACR1252 PICC slot and ignores the SAM slot', () => {
    expect(detectReaderModelFromName('ACS ACR1252 1S CL Reader PICC 0')).toBe(true);
    expect(detectReaderModelFromName('ACS ACR1252 1S CL Reader SAM 0')).toBe(false);
  });
});
