import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { ReclaimedError } from '@reclaimed/shared';

/** AES-256-GCM envelope for Plaid access tokens: v1:<iv>:<tag>:<ciphertext> (base64). */
export class TokenCipher {
  private readonly key: Buffer;
  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('PLAID_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).');
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(envelope: string): string {
    const [v, iv, tag, data] = envelope.split(':');
    if (v !== 'v1' || !iv || !tag || !data) throw new ReclaimedError('INTERNAL_ERROR', 'Unrecognized token envelope.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}

/**
 * Keyed fingerprint of an NFC UID. Raw UIDs are never persisted; the pepper
 * lives only in server configuration.
 */
export function uidFingerprint(pepper: string, uidHex: string): string {
  return createHmac('sha256', pepper).update(uidHex.toUpperCase()).digest('hex');
}

export function maskUid(uidHex: string): string {
  const u = uidHex.toUpperCase();
  return `••••${u.slice(-4)}`;
}
