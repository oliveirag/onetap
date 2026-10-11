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

/** Routing result written onto payment_transactions with the final state (payment_routing migration). */
export interface RoutingColumns {
  category_id: string;
  funding_account_last4: string | null;
  routing_mode: 'auto' | 'manual';
  decision_reason: 'best_rate' | 'tie_priority' | 'manual' | 'fallback_default';
  multiplier: number;
  points_earned: number;
  reward_value_cents: number;
  baseline_value_cents: number;
  best_value_cents: number;
  /** Losing options only. */
  alternatives: { funding_account_id: string; name: string; last4: string | null; multiplier: number; value_cents: number }[];
}

/** Describes the decision once the engine knows which candidate actually funded the purchase. */
export interface RoutingPlan {
  describe(fundedAccountId: string): RoutingColumns | null;
}

export interface RoutedSelection {
  candidates: string[];
  plan: RoutingPlan | null;
}

/**
 * Chooses the ORDERED list of funding sources the authorization engine will try.
 * Selectors that implement selectRoute also explain their choice; the engine stores it with the result.
 * Implementations: ConfiguredFundingSelector (user-configured order) and CategoryRoutingSelector
 * (category-based rewards routing, category-routing.ts).
 */
export interface FundingSelector {
  readonly name: string;
  selectCandidates(db: Queryable, ctx: FundingSelectionContext): Promise<string[]>;
  selectRoute?(db: Queryable, ctx: FundingSelectionContext): Promise<RoutedSelection>;
}

/**
 * Configured-order selector:
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
