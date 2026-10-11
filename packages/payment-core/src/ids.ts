import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** Human-readable simulated transaction reference, e.g. RCL-20261010-7K3QX9. */
export function newPaymentReference(now: Date = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `RCL-${d}-${randomCode(6)}`;
}

/** Display ID for an enrolled Reclaimed test card, e.g. RC-7F3A-19C2. */
export function newCardDisplayId(): string {
  return `RC-${randomCode(4)}-${randomCode(4)}`;
}

export function newBatchReference(now: Date = new Date()): string {
  return `STL-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomCode(5)}`;
}

export function newProviderReference(prefix: string): string {
  return `${prefix}-${randomCode(10)}`;
}
