import type { ReaderDriver } from './driver/types.js';
import { toHex } from './driver/types.js';

/** PC/SC Part 3 pseudo-APDU: GET DATA (UID). Supported by the ACR1252U PICC interface. */
export const GET_UID_APDU = Uint8Array.of(0xff, 0xca, 0x00, 0x00, 0x00);

export class UidReadError extends Error {
  constructor(message: string, public readonly sw?: string) {
    super(message);
    this.name = 'UidReadError';
  }
}

export function parseGetDataResponse(res: Uint8Array): string {
  if (res.length < 2) throw new UidReadError('Short response to GET DATA');
  const sw = toHex(res.slice(-2));
  if (sw !== '9000') throw new UidReadError(sw === '6A81' ? 'GET DATA not supported by this card' : `GET DATA failed (SW=${sw})`, sw);
  const uid = toHex(res.slice(0, -2));
  if (uid.length < 8) throw new UidReadError('UID too short');
  return uid;
}

export async function readUid(driver: ReaderDriver, readerName: string): Promise<string> {
  return parseGetDataResponse(await driver.transmit(readerName, GET_UID_APDU));
}
