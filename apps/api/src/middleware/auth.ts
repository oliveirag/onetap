import type { NextFunction, Request, Response } from 'express';
import { ReclaimedError, HARDWARE_BRIDGE_ID_HEADER, HARDWARE_SIGNATURE_HEADER, HARDWARE_TIMESTAMP_HEADER, TERMINAL_ID_HEADER } from '@reclaimed/shared';
import { verifyRequestSignature } from '@reclaimed/shared/node';
import { hashSecret } from '@reclaimed/database';
import { timingSafeEqual } from 'node:crypto';
import type { AppContext } from '../context.js';

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
    user?: { userId: string; email: string | null };
    bridge?: { bridgeId: string };
    terminal?: { id: string; code: string; readerId: string | null };
  }
}

function bearer(req: Request): string | null {
  const h = req.header('authorization');
  if (!h) return null;
  const [scheme, token] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Requires a valid Supabase session and an ACTIVE profile row. */
export function requireUser(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) throw new ReclaimedError('AUTH_UNAUTHORIZED');
    const user = await ctx.authVerifier.verify(token);
    const { rows } = await ctx.db.query<{ status: string }>('select status from profiles where id = $1', [user.userId]);
    if (!rows[0]) throw new ReclaimedError('AUTH_UNAUTHORIZED', 'No profile exists for this session.');
    if (rows[0].status !== 'ACTIVE') throw new ReclaimedError('AUTH_FORBIDDEN', 'This account is suspended.');
    req.user = user;
    next();
  };
}

function signedParts(req: Request) {
  return {
    timestamp: req.header(HARDWARE_TIMESTAMP_HEADER) ?? '',
    method: req.method,
    path: req.originalUrl.split('?')[0]!,
    body: req.rawBody ? req.rawBody.toString('utf8') : '',
  };
}

/** HMAC authentication for the hardware bridge (HARDWARE_BRIDGE_SECRET). */
export function requireBridge(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const secret = ctx.config.HARDWARE_BRIDGE_SECRET;
    if (!secret) throw new ReclaimedError('FEATURE_DISABLED', 'HARDWARE_BRIDGE_SECRET is not configured.');
    const sig = req.header(HARDWARE_SIGNATURE_HEADER) ?? '';
    const bridgeId = req.header(HARDWARE_BRIDGE_ID_HEADER) ?? '';
    if (!bridgeId || !verifyRequestSignature(secret, signedParts(req), sig)) {
      throw new ReclaimedError('HARDWARE_AUTH_FAILED');
    }
    req.bridge = { bridgeId };
    next();
  };
}

/** Read-only hardware status: bridge HMAC, or (development only) a signed-in user. */
export function requireBridgeOrDevUser(ctx: AppContext) {
  const bridge = requireBridge(ctx);
  const user = requireUser(ctx);
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.header(HARDWARE_SIGNATURE_HEADER)) return bridge(req, res, next);
    if (!ctx.config.isDev) throw new ReclaimedError('HARDWARE_AUTH_FAILED');
    return user(req, res, next);
  };
}

/** HMAC authentication for a registered test terminal (secret hash in test_terminals). */
export function requireTerminal(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!ctx.config.TEST_TERMINAL_ENABLED) throw new ReclaimedError('FEATURE_DISABLED', 'The test terminal is disabled.');
    const code = req.header(TERMINAL_ID_HEADER) ?? '';
    const sig = req.header(HARDWARE_SIGNATURE_HEADER) ?? '';
    const { rows } = await ctx.db.query<{ id: string; terminal_code: string; secret_hash: string; reader_id: string | null; is_active: boolean }>(
      'select id, terminal_code, secret_hash, reader_id, is_active from test_terminals where terminal_code = $1',
      [code],
    );
    const t = rows[0];
    const secret = t ? ctx.terminalSecrets.get(t.terminal_code) : undefined;
    if (!t || !t.is_active || !secret || !safeEq(hashSecret(secret), t.secret_hash) || !verifyRequestSignature(secret, signedParts(req), sig)) {
      throw new ReclaimedError('TERMINAL_AUTH_FAILED');
    }
    req.terminal = { id: t.id, code: t.terminal_code, readerId: t.reader_id };
    next();
  };
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
