import type { Queryable } from '@reclaimed/database';
import type { PlaidItemStatus } from '@reclaimed/shared';

/**
 * A user's Plaid-linked credit card, as a rewards engine should see it.
 *
 * This is a READ-ONLY bridge between Plaid-reported account data and the
 * (Phase 2) rewards logic. It carries no reward rates — Plaid does not report
 * them — and it never calls Plaid or influences authorization by itself. A
 * future RewardsOptimizedFundingSelector can call loadLinkedCardsForRewards()
 * and combine it with verified reward rules keyed by cardProductId.
 */
export interface LinkedCardForRewards {
  financialAccountId: string;
  institutionName: string | null;
  displayName: string;
  mask: string | null;
  connectionStatus: PlaidItemStatus;
  cardProductId: string | null;
  cardProductSlug: string | null;
  /** CONFIRMED: chosen by the user. SUGGESTED: auto-matched, needs confirmation. UNMATCHED: unknown product. */
  productMatch: 'CONFIRMED' | 'SUGGESTED' | 'UNMATCHED';
  /** Reported by Plaid; may lag. Null when the institution does not report it. */
  availableCreditCents: number | null;
  creditLimitCents: number | null;
  balanceUpdatedAt: string | null;
  /** Active simulated funding accounts mapped to the same product (what a selector can actually return). */
  mockFundingAccountIds: string[];
  /** Confirmed product on a healthy connection — safe to base a recommendation on. */
  eligibleForRecommendations: boolean;
}

export async function loadLinkedCardsForRewards(db: Queryable, userId: string): Promise<LinkedCardForRewards[]> {
  const { rows } = await db.query<{
    id: string;
    institution_name: string | null;
    name: string;
    official_name: string | null;
    mask: string | null;
    item_status: PlaidItemStatus;
    card_product_id: string | null;
    product_slug: string | null;
    confirmed_by_user: boolean | null;
    available_balance_cents: number | null;
    credit_limit_cents: number | null;
    balance_updated_at: Date | null;
    funding_ids: string[] | null;
  }>(
    `select a.id, i.institution_name, a.name, a.official_name, a.mask, i.status as item_status,
            uc.card_product_id, cp.product_slug, uc.confirmed_by_user,
            a.available_balance_cents, a.credit_limit_cents, a.balance_updated_at,
            (select array_agg(m.id order by m.priority, m.created_at) from mock_funding_accounts m
              where m.user_id = a.user_id and m.status = 'ACTIVE' and m.card_product_id = uc.card_product_id) as funding_ids
       from financial_accounts a
       join plaid_items i on i.id = a.plaid_item_id
       left join user_cards uc on uc.financial_account_id = a.id
       left join card_products cp on cp.id = uc.card_product_id
      where a.user_id = $1 and a.type = 'credit' and a.is_active and i.status <> 'REMOVED'
      order by i.institution_name nulls last, a.name`,
    [userId],
  );
  return rows.map((r) => {
    const productMatch = !r.card_product_id ? 'UNMATCHED' : r.confirmed_by_user ? 'CONFIRMED' : 'SUGGESTED';
    return {
      financialAccountId: r.id,
      institutionName: r.institution_name,
      displayName: r.official_name ?? r.name,
      mask: r.mask,
      connectionStatus: r.item_status,
      cardProductId: r.card_product_id,
      cardProductSlug: r.product_slug,
      productMatch,
      availableCreditCents: r.available_balance_cents,
      creditLimitCents: r.credit_limit_cents,
      balanceUpdatedAt: r.balance_updated_at?.toISOString() ?? null,
      mockFundingAccountIds: r.funding_ids ?? [],
      eligibleForRecommendations: productMatch === 'CONFIRMED' && r.item_status === 'ACTIVE',
    };
  });
}
