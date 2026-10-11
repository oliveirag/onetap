import type { Queryable } from '@reclaimed/database';
import {
  ConfiguredFundingSelector,
  type FundingSelectionContext,
  type FundingSelector,
  type RoutedSelection,
  type RoutingColumns,
} from './funding-selector.js';

export type RoutingMode = 'auto' | 'manual';

interface RoutableCard {
  id: string;
  display_name: string;
  last4: string | null;
  priority: number;
  multiplier: number;
  cents_per_point: number;
}

/** Reward value in integer cents: points earned times the product's cents per point. */
export function rewardValueCents(amountCents: number, multiplier: number, centsPerPoint: number): number {
  return Math.round((amountCents * multiplier * centsPerPoint) / 100);
}

export function pointsEarned(amountCents: number, multiplier: number): number {
  return Math.round((amountCents * multiplier) / 100);
}

/**
 * OneTap category routing (PRD F4). A deterministic lookup, never AI:
 *  1. MCC -> category via mcc_map (unlisted MCCs are 'general').
 *  2. Auto: the user's active credit cards ordered by reward value per dollar
 *     (multiplier x cents per point), ties broken by the user's card order (priority).
 *     Manual: the chosen card first, then the Auto order.
 *  3. Later candidates are fallbacks, tried only if an earlier card can't fund the purchase.
 *
 * Users with no credit cards fall back to the card's configured primary/secondary accounts.
 */
export class CategoryRoutingSelector implements FundingSelector {
  readonly name = 'category-routing';

  constructor(private readonly fallback: FundingSelector = new ConfiguredFundingSelector()) {}

  async selectCandidates(db: Queryable, ctx: FundingSelectionContext): Promise<string[]> {
    return (await this.selectRoute(db, ctx)).candidates;
  }

  async selectRoute(db: Queryable, ctx: FundingSelectionContext): Promise<RoutedSelection> {
    const [prefs, category] = await Promise.all([
      db.query<{ routing_mode: RoutingMode | null; manual_card_id: string | null; default_card_id: string | null }>(
        'select routing_mode, manual_card_id, default_card_id from profiles where id = $1',
        [ctx.userId],
      ),
      db.query<{ category_id: string }>('select category_id from mcc_map where mcc = $1', [ctx.mcc]),
    ]);
    const categoryId = category.rows[0]?.category_id ?? 'general';
    const { rows: cards } = await db.query<RoutableCard>(
      `select m.id, m.display_name, m.last4, m.priority,
              coalesce(r.multiplier, 1)::float8 as multiplier,
              coalesce(cp.cents_per_point, 1)::float8 as cents_per_point
         from mock_funding_accounts m
         left join card_products cp on cp.id = m.card_product_id
         left join card_product_rates r on r.card_product_id = m.card_product_id and r.category_id = $2
        where m.user_id = $1 and m.status = 'ACTIVE' and m.kind = 'CREDIT'
        order by m.priority asc, m.created_at asc, m.id asc`,
      [ctx.userId, categoryId],
    );
    if (cards.length === 0) {
      return { candidates: await this.fallback.selectCandidates(db, ctx), plan: null };
    }

    const value = (c: RoutableCard) => rewardValueCents(ctx.amountCents, c.multiplier, c.cents_per_point);
    const perDollar = (c: RoutableCard) => c.multiplier * c.cents_per_point;
    // Array.prototype.sort is stable, so equal values keep the priority order from the query.
    const auto = [...cards].sort((a, b) => perDollar(b) - perDollar(a));

    const p = prefs.rows[0];
    const manual = p?.routing_mode === 'manual' ? cards.find((c) => c.id === p.manual_card_id) : undefined;
    const mode: RoutingMode = p?.routing_mode === 'manual' ? 'manual' : 'auto';
    const ordered = manual ? [manual, ...auto.filter((c) => c.id !== manual.id)] : auto;
    const candidates = (ctx.fallbackEnabled ? ordered : ordered.slice(0, 1)).map((c) => c.id);

    const baseline = cards.find((c) => c.id === p?.default_card_id) ?? cards[0]!;
    const best = auto[0]!;
    const tie = auto.length > 1 && perDollar(auto[1]!) === perDollar(best);

    return {
      candidates,
      plan: {
        describe(fundedAccountId: string): RoutingColumns | null {
          const funded = cards.find((c) => c.id === fundedAccountId);
          if (!funded) return null;
          const decision =
            fundedAccountId !== candidates[0] ? 'fallback_default' : manual ? 'manual' : tie ? 'tie_priority' : 'best_rate';
          return {
            category_id: categoryId,
            funding_account_last4: funded.last4,
            routing_mode: mode,
            decision_reason: decision,
            multiplier: funded.multiplier,
            points_earned: pointsEarned(ctx.amountCents, funded.multiplier),
            reward_value_cents: value(funded),
            baseline_value_cents: value(baseline),
            best_value_cents: value(best),
            alternatives: auto
              .filter((c) => c.id !== funded.id)
              .map((c) => ({
                funding_account_id: c.id,
                name: c.display_name,
                last4: c.last4,
                multiplier: c.multiplier,
                value_cents: value(c),
              })),
          };
        },
      },
    };
  }
}
