import { createHmac, timingSafeEqual } from 'node:crypto';
import { SIGNATURE_MAX_SKEW_MS } from '../constants';

/**
 * HMAC-SHA256 request signing used by the hardware bridge and terminal gateway.
 * Signature = hex(HMAC(secret, `${timestamp}.${method}.${path}.${body}`)).
 */
export function signRequest(secret: string, parts: { timestamp: string; method: string; path: string; body: string }): string {
  return createHmac('sha256', secret)
    .update(`${parts.timestamp}.${parts.method.toUpperCase()}.${parts.path}.${parts.body}`)
    .digest('hex');
}

export function verifyRequestSignature(
  secret: string,
  parts: { timestamp: string; method: string; path: string; body: string },
  signature: string,
  now: number = Date.now(),
): boolean {
  const ts = Date.parse(parts.timestamp);
  if (Number.isNaN(ts) || Math.abs(now - ts) > SIGNATURE_MAX_SKEW_MS) return false;
  const expected = Buffer.from(signRequest(secret, parts), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
export * from './terminal-client';
