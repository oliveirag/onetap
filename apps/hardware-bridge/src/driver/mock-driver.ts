import { EventEmitter } from 'node:events';
import type { ReaderDriver, ReaderDriverEvents } from './types.js';

/** Scriptable reader for automated tests. NOT evidence of physical hardware behaviour. */
export class MockReaderDriver extends EventEmitter<ReaderDriverEvents> implements ReaderDriver {
  readonly kind = 'mock' as const;
  private readonly cards = new Map<string, { uid: string; atr: string } | null>();
  failNextTransmit: Error | null = null;

  async start() {}
  async stop() {}
  readers() {
    return [...this.cards.keys()];
  }
  connectReader(name: string) {
    this.cards.set(name, null);
    this.emit('reader-connected', name);
  }
  disconnectReader(name: string) {
    if (this.cards.get(name)) this.emit('card-removed', name);
    this.cards.delete(name);
    this.emit('reader-disconnected', name);
  }
  present(name: string, uid: string, atr = '3B8F8001804F0CA000000306030001000000006A') {
    this.cards.set(name, { uid, atr });
    this.emit('card-present', { readerName: name, atr });
  }
  remove(name: string) {
    this.cards.set(name, null);
    this.emit('card-removed', name);
  }
  async transmit(name: string, apdu: Uint8Array): Promise<Uint8Array> {
    if (this.failNextTransmit) {
      const e = this.failNextTransmit;
      this.failNextTransmit = null;
      throw e;
    }
    const card = this.cards.get(name);
    if (!card) throw Object.assign(new Error('No card'), { code: 'SCARD_E_NO_SMARTCARD' });
    if (apdu[0] === 0xff && apdu[1] === 0xca) return Uint8Array.from([...Buffer.from(card.uid, 'hex'), 0x90, 0x00]);
    return Uint8Array.of(0x6a, 0x81);
  }
}
