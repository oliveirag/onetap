import type { EventEmitter } from 'node:events';

export interface CardPresentEvent {
  readerName: string;
  atr: string; // hex
}

export interface ReaderDriverEvents {
  'reader-connected': [readerName: string];
  'reader-disconnected': [readerName: string];
  'card-present': [CardPresentEvent];
  'card-removed': [readerName: string];
  error: [err: Error & { code?: string }, readerName?: string];
}

/**
 * Hardware abstraction for PC/SC contactless readers. PcscReaderDriver talks to the
 * real ACS ACR1252U; MockReaderDriver is used only by automated tests.
 */
export interface ReaderDriver extends EventEmitter<ReaderDriverEvents> {
  readonly kind: 'pcsc' | 'mock';
  start(): Promise<void>;
  stop(): Promise<void>;
  readers(): string[];
  /** Sends an APDU to the card currently on the reader and returns the raw response (data + SW1 SW2). */
  transmit(readerName: string, apdu: Uint8Array): Promise<Uint8Array>;
}

export const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex').toUpperCase();
