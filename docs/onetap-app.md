# OneTap app on the backend

The app in `mobile/` keeps its own row types (`shared/contracts.ts`) and design. The backend stores the same data in its own tables, so `mobile/src/lib/backend.ts` maps rows at the boundary. Screens didn't change; only the live branches of `queries.ts`, `api.ts` and `TransactionListener.tsx` did. With `EXPO_PUBLIC_USE_MOCKS=1`, everything still runs on the typed fixtures, as before.

## Table mapping

| App contract (`shared/contracts.ts`) | Backend table | Notes |
|---|---|---|
| `UserCardRow` | `mock_funding_accounts` (`kind = 'CREDIT'`) + `card_products` | The cards the router charges. `account_name` = `display_name`, `mask` = `last4`, `card_product_id` = catalog id (`cp-<product_slug>`). `points_balance` is 0 (not tracked). `financial_account_id` joins `card_spending` rows to the card used, for "left on the table" |
| `CardProduct` | `card_products` | Catalog display names from `mobile/src/lib/catalog.ts`; `cp-other` = `other-card` (generic, 1x) |
| `CardProductRate` | `card_product_rates` | Demo estimates, the same numbers as `catalog.ts` (seeded in `seed.sql`) |
| `ProfileRow` | `profiles` | `display_name` = `full_name`. `routing_mode`, `manual_card_id`, `default_card_id` added by `20261010200100_app_preferences.sql`. Setup progress stays in auth metadata |
| `OneTapCardRow` | `reclaimed_cards` (`ACTIVE`/`FROZEN`) | The OneTap card, digital and physical. `last4` = last four characters of `display_id`; `FROZEN` = `paused`; `physical_linked` = an NFC card is attached (`uid_masked` set) |
| `CardSpendingRow` (Dashboard) | `card_spending` view | Purchases on Plaid-connected credit cards in OneTap categories (`plaid_category_map`: Plaid detailed category first, then primary, else `general`). Payments, refunds and transfers excluded. `security_invoker`, so RLS applies |
| `TransactionRow` | `payment_transactions` with `decision_reason` set | Routing columns from `20261010200000_payment_routing.sql`. `routed_card_id` = `funding_account_id`. Declines before routing (frozen card, limits) are not shown. Optional `charge_status` / `charged_card_id` = the Stripe test-mode charge (`charge_status`, `charged_funding_account_id`; see [setup.md](setup.md#5b-stripe-test-mode-optional)). They arrive as a second UPDATE of the same row, which refreshes the receipt without reopening it |

The app talks to Supabase directly with the user's JWT. RLS lets it read only its own rows, and column grants let it write only `profiles.{full_name, routing_mode, manual_card_id, default_card_id}` and `mock_funding_accounts.{priority, card_product_id, match_source}` on its own rows. A trigger rejects pointing a profile at another user's card.

## Backend endpoints the app calls

All are under `/api/v1`, need the user's Supabase token, and return the `{ success, data }` envelope.

| App call | Endpoint | Behavior |
|---|---|---|
| `api.connectCards()` (setup step 1) | `POST /plaid/link-token` → Plaid Link → `POST /plaid/exchange-token` → `POST /onetap/connect-cards` | The user signs in to their bank in **Plaid Link**. The backend imports the accounts, then creates one routable card per **credit** account. The name, last four, balance and limit all come from Plaid, and each card is linked to its Plaid account (`mock_funding_accounts.financial_account_id`), so reconnecting refreshes it instead of duplicating it. No connected credit card: `NO_CREDIT_CARDS_CONNECTED`. Nothing is invented when Plaid isn't configured |
| `api.createOneTapCard()` (setup step 4, Cards tab) | `POST /onetap/card` | Returns the user's OneTap card, creating it **digital** on the spot (no tap). Idempotent, at most one live digital card per user |
| `api.setCardFrozen()` (Cards tab) | `PATCH /reclaimed-cards/:id/status` (`FROZEN` / `ACTIVE`) | Freezes the OneTap card: the authorization engine declines every tap (`CARD_FROZEN`), shown on the terminal. The app lists routed rows only, so the decline isn't in the feed |
| `api.linkPhysicalCard()` (Cards tab) | `POST /onetap/card/physical` | Attaches the physical NFC card to that same card: opens an enrollment session and **waits up to `ONETAP_ENROLL_WAIT_MS` (45 s) for the tap**. Development or `HARDWARE_TEST_MODE=true` only. For demos, an operator can do the same with `npm run onetap:link-card -- <email>` |

## Tabs

Home (the card, mode, **reclaimed this month** with a yearly projection labeled as an estimate, and activity), **Dashboard** (this month's spending across every Plaid-connected card, by category and by card, recent purchases, the rewards OneTap earned, a template insight sentence, and **left on the table**: what the best connected card would have earned beyond the card actually used, by the router's math) and Cards (the OneTap card with its digital/physical status and **Link physical card**, connected cards, routing rules, card order, **Connect cards**). The Assistant tab was removed.

## Routing

`CategoryRoutingSelector` (`packages/payment-core/src/category-routing.ts`) runs inside the authorization engine on every tap. It is a deterministic lookup with no AI:

1. MCC → category via `mcc_map`; an unlisted MCC is `general`.
2. **Auto:** the user's active credit cards, ordered by reward value per dollar (multiplier × cents per point). A tie goes to the user's card order (`priority`), and the decision is recorded as `tie_priority`.
3. **Manual:** the chosen card first.
4. Later cards are fallbacks, tried only if an earlier one can't fund the purchase (`fallback_default`).

The result is written in the **same update** that sets the final state, so the app gets one complete row over Realtime (`UPDATE` on `payment_transactions`, filtered by `user_id`). Its fields: category, mode, reason, multiplier, points, value, the baseline (the default card's value), best (Auto's value), alternatives and last four. Users with no credit cards fall back to the card's configured primary/secondary accounts and get no routing fields.

## Demo flow (local)

1. `npm run db:start`, then `npm run db:migrate` and `npm run db:seed` with `DATABASE_URL` pointing at the **local** database.
2. `npm run dev` (API, terminal simulator at http://localhost:5173, hardware bridge).
3. `cd mobile && npx expo run:ios`, with `mobile/.env` as in [setup.md](setup.md).
4. In the app: sign up → **Connect cards** (Plaid Link; your Plaid dashboard test user for several cards) → match → mode → **Create my card**, then tap the NFC card on the reader.
5. Terminal: pick a merchant (Starbucks is dining, Shell is gas, Whole Foods is groceries) → **Start checkout** → tap. The receipt opens on the phone.

Without a reader, `npm run smoke:onetap` runs the same flow with simulated taps. In place of Plaid Link it asks Plaid's Sandbox API for a public token: for `PLAID_SANDBOX_USERNAME` (and `PLAID_SANDBOX_PASSWORD`) if set, otherwise for test cards defined in the script. Every routing check is computed from the cards and rates the app reads.
