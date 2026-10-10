import type { Request, Response } from 'express';
import { ReclaimedError, type ApiSuccessBody } from '@reclaimed/shared';
import type { ZodType } from 'zod';

export function ok<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccessBody<T> = { success: true, data, requestId: res.locals.requestId as string };
  res.status(status).json(body);
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ReclaimedError('VALIDATION_FAILED', r.error.issues[0]?.message ?? 'Invalid request.', {
      details: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

export function param(req: Request, name: string): string {
  const v = req.params[name];
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !/^[0-9a-f-]{36}$/i.test(s)) throw new ReclaimedError('NOT_FOUND');
  return s;
}

/** Keyset pagination cursor over (created_at, id). */
export function encodeCursor(createdAt: Date | string, id: string): string {
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) throw new ReclaimedError('VALIDATION_FAILED', 'Invalid cursor.');
  return { createdAt, id };
}
