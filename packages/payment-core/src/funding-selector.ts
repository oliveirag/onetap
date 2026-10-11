import type { Queryable } from '@reclaimed/database';

export interface FundingSelectionContext {
  userId: string;
  reclaimedCardId: string;
  primaryFundingAccountId: string | null;
  secondaryFundingAccountId: string | null;
  fallbackEnabled: boolean;
  merchantId: string;
  merchantName: string;
  mcc: string;
  amountCents: number;
}

/**
 * Chooses the ORDERED list of funding sources the authorization engine will try.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PHASE 2 INTEGRATION POINT. A future RewardsOptimizedFundingSelector will  │
 * │ implement this interface using merchant/MCC/amount + verified reward     │
 * │ rules. Phase 1 deliberately ships ONLY deterministic, user-configured    │
 * │ ordering — no rewards logic of any kind.                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface FundingSelector {
  readonly name: string;
  selectCandidates(db: Queryable, ctx: FundingSelectionContext): Promise<string[]>;
}

/**
 * Phase 1 selector:
 *  1. The card's configured primary mock account; if none is configured, the
 *     user's active mock account with the lowest priority number (the default).
 *  2. The configured secondary account, only when fallback is enabled.
 */
export class ConfiguredFundingSelector implements FundingSelector {
  readonly name = 'configured-priority';

  async selectCandidates(db: Queryable, ctx: FundingSelectionContext): Promise<string[]> {
    let primary = ctx.primaryFundingAccountId;
    if (!primary) {
      const { rows } = await db.query<{ id: string }>(
        `select id from mock_funding_accounts
          where user_id = $1 and status = 'ACTIVE'
          order by priority asc, created_at asc limit 1`,
        [ctx.userId],
      );
      primary = rows[0]?.id ?? null;
    }
    const out: string[] = [];
    if (primary) out.push(primary);
    if (ctx.fallbackEnabled && ctx.secondaryFundingAccountId && ctx.secondaryFundingAccountId !== primary) {
      out.push(ctx.secondaryFundingAccountId);
    }
    return out;
  }
}
