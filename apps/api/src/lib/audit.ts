import type { Queryable } from '@reclaimed/database';

export interface AuditEntry {
  actorType: 'user' | 'system' | 'bridge' | 'terminal' | 'webhook';
  actorId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export async function audit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    `insert into audit_logs (actor_type, actor_id, user_id, action, entity_type, entity_id, metadata, request_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [e.actorType, e.actorId ?? null, e.userId ?? null, e.action, e.entityType ?? null, e.entityId ?? null, JSON.stringify(e.metadata ?? {}), e.requestId ?? null],
  );
}
