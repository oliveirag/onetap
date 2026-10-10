import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { HardwareEventType, TapResultDto } from '@reclaimed/shared';
import type { ReaderDriver } from './driver/types.js';
import { parseAtr } from './atr.js';
import { readUid } from './uid.js';
import type { BridgeApi } from './api-client.js';

export interface BridgeLogger {
  info(msg: string, data?: object): void;
  warn(msg: string, data?: object): void;
  error(msg: string, data?: object): void;
}

export interface Presentation {
  tapId: string;
  readerName: string;
  uid: string | null;
  atr: string;
  cardType: string;
  presentedAt: string;
  removedAt: string | null;
}

export interface BridgeEvents {
  presentation: [Presentation];
  removed: [Presentation];
  tapResult: [Presentation, TapResultDto];
  tapError: [Presentation, Error];
  reader: [HardwareEventType, string];
}

/**
 * Orchestrates driver → presentation tracking → backend.
 * One continuous presentation of a card produces exactly ONE tap event; the card
 * must be removed before another tap is emitted. A detected card never creates a
 * payment by itself — the backend only completes an existing pending checkout.
 */
export class HardwareBridge extends EventEmitter<BridgeEvents> {
  private readonly active = new Map<string, Presentation>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  readonly stats = { taps: 0, removals: 0, errors: 0, lastPresentation: null as Presentation | null, lastError: null as string | null };

  constructor(
    private readonly driver: ReaderDriver,
    private readonly api: BridgeApi | null,
    private readonly log: BridgeLogger,
    private readonly opts: { bridgeId: string; heartbeatMs?: number } = { bridgeId: 'bridge' },
  ) {
    super();
    driver.on('reader-connected', (name) => this.readerEvent('READER_CONNECTED', name));
    driver.on('reader-disconnected', (name) => {
      this.active.delete(name);
      this.readerEvent('READER_DISCONNECTED', name);
    });
    driver.on('card-present', (e) => void this.onPresent(e.readerName, e.atr));
    driver.on('card-removed', (name) => this.onRemoved(name));
    driver.on('error', (err, name) => {
      this.stats.errors += 1;
      this.stats.lastError = `${err.code ?? 'ERROR'}: ${err.message}`;
      this.log.error('reader error', { code: err.code, message: err.message, reader: name });
      if (name) this.readerEvent('READER_ERROR', name, { code: err.code ?? null, message: err.message });
    });
  }

  async start(): Promise<void> {
    await this.driver.start();
    if (this.api && (this.opts.heartbeatMs ?? 10_000) > 0) {
      const beat = () => this.api!.heartbeat(this.driver.readers()).catch((err) => this.log.warn('heartbeat failed', { message: (err as Error).message }));
      void beat();
      this.heartbeatTimer = setInterval(beat, this.opts.heartbeatMs ?? 10_000);
    }
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await this.driver.stop();
  }

  private readerEvent(type: HardwareEventType, readerName: string, detail?: Record<string, unknown>) {
    this.log.info(`reader ${type}`, { reader: readerName, ...detail });
    this.emit('reader', type, readerName);
    void this.api
      ?.sendReaderEvent({ eventId: randomUUID(), type, readerName, bridgeId: this.opts.bridgeId, occurredAt: new Date().toISOString(), detail })
      .catch((err) => this.log.warn('failed to report reader event', { type, message: (err as Error).message }));
  }

  private async onPresent(readerName: string, atr: string): Promise<void> {
    if (this.active.has(readerName)) return; // same presentation — never re-emit
    const info = parseAtr(atr);
    const p: Presentation = { tapId: randomUUID(), readerName, uid: null, atr, cardType: info.cardType, presentedAt: new Date().toISOString(), removedAt: null };
    this.active.set(readerName, p);
    try {
      p.uid = await readUid(this.driver, readerName);
    } catch (err) {
      this.stats.errors += 1;
      this.stats.lastError = (err as Error).message;
      this.log.warn('could not read card UID (unsupported card?)', { reader: readerName, cardType: info.cardType, message: (err as Error).message });
      this.emit('tapError', p, err as Error);
      this.readerEvent('READER_ERROR', readerName, { code: 'NFC_CARD_UNSUPPORTED', message: (err as Error).message, cardType: info.cardType });
      return;
    }
    this.stats.taps += 1;
    this.stats.lastPresentation = p;
    this.log.info('card presented', { reader: readerName, cardType: p.cardType, uid: `••••${p.uid.slice(-4)}`, tapId: p.tapId });
    this.emit('presentation', p);
    if (!this.api) return;
    try {
      const result = await this.api.sendTap({ tapId: p.tapId, readerName, bridgeId: this.opts.bridgeId, uid: p.uid, atr: atr || undefined, cardType: p.cardType, presentedAt: p.presentedAt });
      this.log.info('backend processed tap', { outcome: result.outcome, message: result.message, result: result.authorization?.result });
      this.emit('tapResult', p, result);
    } catch (err) {
      this.stats.errors += 1;
      this.stats.lastError = (err as Error).message;
      this.log.error('backend rejected/unreachable for tap', { message: (err as Error).message, code: (err as { code?: string }).code });
      this.emit('tapError', p, err as Error);
    }
  }

  private onRemoved(readerName: string): void {
    const p = this.active.get(readerName);
    this.active.delete(readerName);
    if (!p) return;
    p.removedAt = new Date().toISOString();
    this.stats.removals += 1;
    this.log.info('card removed', { reader: readerName, tapId: p.tapId });
    this.emit('removed', p);
    this.readerEvent('CARD_REMOVED', readerName, { tapId: p.tapId });
  }
}
