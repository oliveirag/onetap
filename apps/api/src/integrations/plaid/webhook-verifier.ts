import { createHash, timingSafeEqual } from 'node:crypto';
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import type { PlaidGateway } from './gateway.js';

/**
 * Verifies the Plaid-Verification JWT per https://plaid.com/docs/api/webhooks/webhook-verification/
 *  - header alg must be ES256; key fetched by kid (cached)
 *  - token issued within the last 5 minutes
 *  - request_body_sha256 claim must equal sha256(raw body)
 */
export class PlaidWebhookVerifier {
  private readonly keys = new Map<string, { key: Awaited<ReturnType<typeof importJWK>>; expiresAt: number | null }>();

  constructor(private readonly gateway: PlaidGateway) {}

  async verify(rawBody: Buffer, token: string | undefined, now = Date.now()): Promise<boolean> {
    if (!token) return false;
    let kid: string | undefined;
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== 'ES256') return false;
      kid = header.kid;
    } catch {
      return false;
    }
    if (!kid) return false;
    let cached = this.keys.get(kid);
    if (!cached || (cached.expiresAt && cached.expiresAt * 1000 < now)) {
      const jwk = (await this.gateway.getWebhookVerificationKey(kid)) as JWK & { expired_at?: number | null };
      cached = { key: await importJWK(jwk, 'ES256'), expiresAt: jwk.expired_at ?? null };
      this.keys.set(kid, cached);
    }
    try {
      const { payload } = await jwtVerify(token, cached.key, { algorithms: ['ES256'], maxTokenAge: '5 min', currentDate: new Date(now) });
      const claimed = String(payload.request_body_sha256 ?? '');
      const actual = createHash('sha256').update(rawBody).digest('hex');
      return claimed.length === actual.length && timingSafeEqual(Buffer.from(claimed), Buffer.from(actual));
    } catch {
      return false;
    }
  }
}
