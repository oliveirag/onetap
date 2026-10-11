import { createHash } from 'node:crypto';
import type { Queryable } from './client.js';

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Idempotently upserts the development test terminal used by apps/terminal-simulator. */
export async function upsertDevTerminal(
  db: Queryable,
  opts: { terminalCode: string; secret: string; displayName?: string },
): Promise<{ id: string; terminal_code: string }> {
  const { rows } = await db.query<{ id: string; terminal_code: string }>(
    `insert into public.test_terminals (terminal_code, display_name, secret_hash)
     values ($1, $2, $3)
     on conflict (terminal_code) do update set secret_hash = excluded.secret_hash, display_name = excluded.display_name
     returning id, terminal_code`,
    [opts.terminalCode, opts.displayName ?? 'Reclaimed Dev Terminal', hashSecret(opts.secret)],
  );
  return rows[0]!;
}
