import { EventEmitter } from 'node:events';
import type { CardPresentEvent, ReaderDriver, ReaderDriverEvents } from './types.js';
import { toHex } from './types.js';

type PcscModule = typeof import('pcsc-mini');
type PcscReader = import('pcsc-mini').Reader;
type PcscClient = import('pcsc-mini').Client;

export interface PcscDriverOptions {
  /** Only readers whose PC/SC name matches are used. Default: the ACR1252 PICC (contactless) slot. */
  readerFilter?: RegExp;
}

/**
 * Real PC/SC driver built on `pcsc-mini` (prebuilt N-API binaries for macOS arm64,
 * talks to Apple's CryptoTokenKit PC/SC service). The ACR1252U exposes two slots,
 * "... PICC 0" (contactless) and "... SAM 0"; only the PICC slot is used.
 */
export class PcscReaderDriver extends EventEmitter<ReaderDriverEvents> implements ReaderDriver {
  readonly kind = 'pcsc' as const;
  private pcsc: PcscModule | null = null;
  private client: PcscClient | null = null;
  private readonly connected = new Map<string, { reader: PcscReader; present: boolean }>();
  private readonly filter: RegExp;
  private restartTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(opts: PcscDriverOptions = {}) {
    super();
    this.filter = opts.readerFilter ?? /ACR1252.*PICC/i;
  }

  static async load(): Promise<PcscModule> {
    try {
      return await import('pcsc-mini');
    } catch (err) {
      const e = new Error(`pcsc-mini native binding unavailable: ${(err as Error).message}`) as Error & { code?: string };
      e.code = 'PCSC_BINDING_UNAVAILABLE';
      throw e;
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.pcsc ??= await PcscReaderDriver.load();
    this.client = new this.pcsc.Client()
      .on('reader', (r) => this.onReader(r))
      .on('error', (err) => {
        this.emit('error', err as Error & { code?: string });
        this.scheduleRestart();
      });
    this.client.start();
  }

  /** PC/SC service hiccups (e.g. sleep/wake) stop monitoring; restart with backoff. */
  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return;
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      try {
        this.client?.stop();
      } catch {
        /* already stopped */
      }
      try {
        await this.start();
      } catch (err) {
        this.emit('error', err as Error);
        this.scheduleRestart();
      }
    }, 2_000);
  }

  private onReader(reader: PcscReader): void {
    const name = reader.name();
    if (!this.filter.test(name)) return;
    const entry = { reader, present: false };
    this.connected.set(name, entry);
    this.emit('reader-connected', name);
    const { ReaderStatus } = this.pcsc!;

    reader.on('change', (status, atr) => {
      const present = status.has(ReaderStatus.PRESENT) && !status.has(ReaderStatus.MUTE);
      if (present && !entry.present) {
        entry.present = true;
        const evt: CardPresentEvent = { readerName: name, atr: toHex(atr) };
        this.emit('card-present', evt);
      } else if (!present && entry.present && (status.has(ReaderStatus.EMPTY) || !status.has(ReaderStatus.PRESENT))) {
        entry.present = false;
        this.emit('card-removed', name);
      }
    });
    reader.on('disconnect', () => {
      if (entry.present) this.emit('card-removed', name);
      this.connected.delete(name);
      this.emit('reader-disconnected', name);
    });
  }

  readers(): string[] {
    return [...this.connected.keys()];
  }

  async transmit(readerName: string, apdu: Uint8Array): Promise<Uint8Array> {
    const entry = this.connected.get(readerName);
    if (!entry) throw Object.assign(new Error(`Reader not connected: ${readerName}`), { code: 'NFC_READER_DISCONNECTED' });
    const { CardMode, CardDisposition } = this.pcsc!;
    const card = await entry.reader.connect(CardMode.SHARED);
    try {
      return await card.transmit(apdu);
    } finally {
      await card.disconnect(CardDisposition.LEAVE).catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    try {
      this.client?.stop();
    } catch {
      /* ignore */
    }
    this.connected.clear();
  }
}
