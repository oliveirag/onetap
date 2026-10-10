import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ReclaimedError } from '@reclaimed/shared';

export interface AuthenticatedUser {
  userId: string;
  email: string | null;
}

/** Verifies a Supabase access token. Never trust a client-supplied user id. */
export interface AuthVerifier {
  verify(accessToken: string): Promise<AuthenticatedUser>;
}

/** Privileged auth operations (account deletion). */
export interface AuthAdmin {
  deleteUser(userId: string): Promise<void>;
}

function toUser(payload: JWTPayload): AuthenticatedUser {
  if (!payload.sub) throw new ReclaimedError('AUTH_UNAUTHORIZED', 'Token has no subject.');
  if (payload.role && payload.role !== 'authenticated') throw new ReclaimedError('AUTH_UNAUTHORIZED', 'Token is not a user session.');
  return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
}

/**
 * Supabase verifier: asymmetric (ES256/RS256) tokens are verified locally against the
 * project's JWKS; legacy HS256 tokens are validated by Supabase Auth (getUser).
 */
export class SupabaseAuthVerifier implements AuthVerifier {
  private readonly jwks;
  private readonly issuer: string;
  private readonly client: SupabaseClient | null;

  constructor(supabaseUrl: string, apiKey: string | undefined) {
    const base = supabaseUrl.replace(/\/$/, '');
    this.issuer = `${base}/auth/v1`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    this.client = apiKey ? createClient(base, apiKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      throw new ReclaimedError('AUTH_UNAUTHORIZED', 'Malformed access token.');
    }
    if (alg && alg !== 'HS256') {
      try {
        const { payload } = await jwtVerify(token, this.jwks, { issuer: this.issuer, audience: 'authenticated' });
        return toUser(payload);
      } catch (err) {
        throw new ReclaimedError('AUTH_UNAUTHORIZED', 'Invalid or expired session.', { cause: err });
      }
    }
    if (!this.client) throw new ReclaimedError('AUTH_UNAUTHORIZED', 'Server cannot validate legacy tokens (no Supabase key).');
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) throw new ReclaimedError('AUTH_UNAUTHORIZED', 'Invalid or expired session.', { cause: error });
    return { userId: data.user.id, email: data.user.email ?? null };
  }
}

/** HS256 verifier for automated tests only. */
export class SharedSecretAuthVerifier implements AuthVerifier {
  private readonly key: Uint8Array;
  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }
  async verify(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.key, { audience: 'authenticated' });
      return toUser(payload);
    } catch (err) {
      throw new ReclaimedError('AUTH_UNAUTHORIZED', 'Invalid or expired session.', { cause: err });
    }
  }
}

export class SupabaseAuthAdmin implements AuthAdmin {
  private readonly client: SupabaseClient;
  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.client.auth.admin.deleteUser(userId);
    if (error) throw new ReclaimedError('INTERNAL_ERROR', 'Could not delete the auth user.', { cause: error });
  }
}
