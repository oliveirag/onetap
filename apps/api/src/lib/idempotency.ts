import { createHash } from 'node:crypto';
import { ReclaimedError, IDEMPOTENCY_HEADER } from '@reclaimed/shared';
import type { Request } from 'express';
import type { Database } from '@reclaimed/database';

export function idempotencyKey(req: Request, required: boolean): string | null {
  const key = req.header(IDEMPOTENCY_HEADER);
  if (!key) {
    if (required) throw new ReclaimedError('VALIDATION_FAILED', `The ${IDEMPOTENCY_HEADER} header is required.`);
    return null;
  }
  if (!/^[\w:.-]{8,200}$/.test(key)) throw new ReclaimedError('VALIDATION_FAILED', `Invalid ${IDEMPOTENCY_HEADER}.`);
  return key;
}

/**
 * Executes fn at most once per (scope, owner, key). Replays return the stored
 * response; reusing a key with a different body is rejected.
 */
export async function withIdempotency<T>(
  db: Database,
  args: { scope: string; ownerId: string; key: string | null; body: unknown },
  fn: () => Promise<{ status: number; data: T }>,
): Promise<{ status: number; data: T; replayed: boolean }> {
  if (!args.key) return { ...(await fn()), replayed: false };
  const hash = createHash('sha256').update(JSON.stringify(args.body ?? null)).digest('hex');
  const inserted = await db.query<{ id: string }>(
    `insert into idempotency_records (scope, owner_id, idempotency_key, request_hash)
     values ($1, $2, $3, $4) on conflict (scope, owner_id, idempotency_key) do nothing returning id`,
    [args.scope, args.ownerId, args.key, hash],
  );
  if (!inserted.rows[0]) {
    const { rows } = await db.query<{ request_hash: string; status: string; response_status: number; response_body: T }>(
      'select request_hash, status, response_status, response_body from idempotency_records where scope = $1 and owner_id = $2 and idempotency_key = $3',
      [args.scope, args.ownerId, args.key],
    );
    const prior = rows[0]!;
    if (prior.request_hash !== hash) throw new ReclaimedError('IDEMPOTENCY_CONFLICT');
    if (prior.status !== 'COMPLETED') throw new ReclaimedError('CONFLICT', 'The original request is still in progress.', { retryable: true });
    return { status: prior.response_status, data: prior.response_body, replayed: true };
  }
  try {
    const result = await fn();
    await db.query(
      `update idempotency_records set status = 'COMPLETED', response_status = $2, response_body = $3 where id = $1`,
      [inserted.rows[0].id, result.status, JSON.stringify(result.data)],
    );
    return { ...result, replayed: false };
  } catch (err) {
    // Let the client retry with the same key after a failure.
    await db.query('delete from idempotency_records where id = $1', [inserted.rows[0].id]);
    throw err;
  }
}
