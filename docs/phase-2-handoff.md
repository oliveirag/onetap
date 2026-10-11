# Phase 2 handoff — rewards optimizer

Phase 1 contains **no rewards logic**: no reward rates, rankings, point valuations, categories or caps. Funding is chosen by deterministic, user-configured ordering. This document describes where Phase 2 plugs in.

## The integration point

`packages/payment-core/src/funding-selector.ts`:

```ts
export interface FundingSelector {
  readonly name: string;
  selectCandidates(db: Queryable, ctx: FundingSelectionContext): Promise<string[]>; // ordered funding account ids
}
```

`AuthorizationService` calls `selector.selectCandidates()` exactly once per authorization, after card/user/limit checks and before any funds are evaluated. It then tries candidates in order with holds, processor calls and fallback. Phase 1 wires `ConfiguredFundingSelector` in `apps/api/src/build-context.ts`.

Phase 2 adds `RewardsOptimizedFundingSelector implements FundingSelector` and swaps it in there. The authorization pipeline, ledger, state machine, idempotency and latency instrumentation stay the same.

`FundingSelectionContext` already carries the inputs an optimizer needs:

| Field | Source |
|---|---|
| `userId`, `reclaimedCardId` | resolved server-side from the tap |
| `merchantId`, `merchantName`, `mcc` | checkout (terminal); production would use network authorization data |
| `amountCents` | checkout |
| `primaryFundingAccountId`, `secondaryFundingAccountId`, `fallbackEnabled` | user preferences (keep them as overrides and tie-breakers) |

## Data the optimizer will use

`loadLinkedCardsForRewards(db, userId)` (`packages/payment-core/src/linked-cards.ts`) is the read-only bridge from Plaid data to the optimizer. Per linked credit card it returns the product (`cardProductId`/slug), match confidence (`CONFIRMED` / `SUGGESTED` / `UNMATCHED`), connection health, reported available credit, and the active mock funding accounts mapped to that product. `eligibleForRecommendations` is true only for a user-confirmed product on an `ACTIVE` connection. It carries no reward data and never calls Plaid.

| Need | Phase 1 asset |
|---|---|
| Which real cards the user holds | `financial_accounts` (Plaid, `type='credit'`) |
| Which product each card is | `user_cards.card_product_id` → `card_products` (stable UUIDs and slugs, idempotent seed; the IDs survive re-seeding) |
| Mapping product → funding source | `mock_funding_accounts.card_product_id` (simulation), later the real funding instrument |
| Reward rules | **Not present.** Add a table keyed by `card_products.id` (e.g. `card_product_reward_rules`: category/MCC set, rate, cap, period, valid_from/to, source, verified_at), loaded from an **authorized** rewards-data provider |
| Merchant info | `payment_transactions.merchant_id/merchant_name/mcc` |
| User preferences | `user_settings` (add e.g. points-vs-cash preference, excluded cards) |
| Balances and utilisation | `financial_accounts` balances/limits (reported, may lag), mock available funds |

Keep the selector **deterministic and fast**. Authorization latency is recorded per attempt (`authorization_attempts.*_ms`), so budget for it (target under 50 ms; precompute rule lookups). Do not call an LLM in the authorization path.

## Production capabilities still required (not solvable by Phase 1 software)

1. **Certified card issuance.** An issuing bank and BIN sponsor, a network-certified EMV card (physical and tokenized), and a processor such as Lithic Production. Generic NFC tags cannot be payment cards.
2. **Network authorization.** Real-time authorization from the network, via ASA or an equivalent issuer-processor decisioning hook, within network timeouts.
3. **Approved cross-issuer funding.** Charging the customer's *other* issuers' cards as funding sources. This needs card-on-file or push/pull agreements, issuer permission, and often money-transmission licensing. It is **unsolved** and the central business and regulatory risk.
4. **Original merchant information preservation.** Making the underlying issuer's statement show "Walmart" (and categorise the MCC correctly) instead of Reclaimed. With a pass-through funding model, the underlying issuer typically sees Reclaimed as the merchant. This requires network-level arrangements and is **unsolved**.
5. **Rewards eligibility.** Underlying issuers may treat funding transactions as purchases at Reclaimed, cash-like or ineligible. Rewards preservation depends on items 3–4 and issuer terms.
6. **Real settlement infrastructure.** Settlement accounts, reconciliation against network clearing files, chargebacks and disputes, returns and fraud.
7. **Regulatory and network approvals.** Program approval from the network and sponsor bank, state money-transmitter licences (if applicable), KYC/AML, Reg E/Reg Z, PCI DSS Level 1, consumer disclosures.

## Suggested Phase 2 sequence

1. Choose and contract an authorized rewards-data source. Model `card_product_reward_rules` with provenance and effective dates.
2. Implement `RewardsOptimizedFundingSelector`, with deterministic tests per MCC, cap and period.
3. Add an "explain this choice" record per authorization (store the rule IDs used in `authorization_events.detail`).
4. Extend the app with transparency: the chosen card, why, and the user override.
5. In parallel, start issuing-partner and network conversations about items 1–7.
