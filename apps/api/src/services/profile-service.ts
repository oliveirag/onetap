import { ReclaimedError, type ProfileDto, type UpdateProfileInput } from '@reclaimed/shared';
import type { Database } from '@reclaimed/database';
import type { AuthAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import type { PlaidService } from './plaid-service.js';
import type { Logger } from '../logger.js';

export class ProfileService {
  constructor(
    private readonly db: Database,
    private readonly deps: { authAdmin: AuthAdmin | null; plaid: PlaidService; logger: Logger },
  ) {}

  async get(userId: string): Promise<ProfileDto> {
    const { rows } = await this.db.query<{ id: string; email: string | null; full_name: string | null; status: ProfileDto['status']; theme_preference: ProfileDto['themePreference'] | null; created_at: Date }>(
      `select p.id, p.email, p.full_name, p.status, s.theme_preference, p.created_at
         from profiles p left join user_settings s on s.user_id = p.id where p.id = $1`,
      [userId],
    );
    const p = rows[0];
    if (!p) throw new ReclaimedError('NOT_FOUND', 'Profile not found.');
    return { id: p.id, email: p.email, fullName: p.full_name, status: p.status, themePreference: p.theme_preference ?? 'system', createdAt: p.created_at.toISOString() };
  }

  async update(userId: string, input: UpdateProfileInput): Promise<ProfileDto> {
    await this.db.transaction(async (tx) => {
      if (input.fullName !== undefined) await tx.query('update profiles set full_name = $2 where id = $1', [userId, input.fullName]);
      if (input.themePreference !== undefined) {
        await tx.query(
          `insert into user_settings (user_id, theme_preference) values ($1, $2)
           on conflict (user_id) do update set theme_preference = excluded.theme_preference`,
          [userId, input.themePreference],
        );
      }
    });
    return this.get(userId);
  }

  /**
   * Secure deletion: revoke Plaid items upstream, revoke Reclaimed cards, then delete the
   * Supabase auth user (cascades to all user-owned rows). Simulated ledger journals are
   * retained without personal links for integrity; audit logs keep the action.
   */
  async delete(userId: string, requestId?: string): Promise<void> {
    if (!this.deps.authAdmin) throw new ReclaimedError('FEATURE_DISABLED', 'Account deletion requires SUPABASE_SERVICE_ROLE_KEY.');
    if (this.deps.plaid.configured) await this.deps.plaid.removeAllForUser(userId);
    await this.db.query(`update reclaimed_cards set status = 'REVOKED', revoked_at = now() where user_id = $1 and status <> 'REVOKED'`, [userId]);
    await audit(this.db, { actorType: 'user', actorId: userId, userId: null, action: 'account.deleted', entityType: 'profile', entityId: userId, requestId });
    await this.deps.authAdmin.deleteUser(userId);
    // Supabase cascades auth.users → profiles; delete explicitly too in case of a separate database.
    await this.db.query('delete from profiles where id = $1', [userId]);
  }
}
