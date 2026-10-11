# OneTap app on the backend

The app in `mobile/` keeps its own row types (`shared/contracts.ts`) and design. The backend stores the same data in its own tables, so `mobile/src/lib/backend.ts` maps rows at the boundary. Screens didn't change; only the live branches of `queries.ts`, `api.ts` and `TransactionListener.tsx` did. With `EXPO_PUBLIC_USE_MOCKS=1`, everything still runs on the typed fixtures, as before.

## Table mapping

| App contract (`shared/contracts.ts`) | Backend table | Notes |
|---|---|---|
| `UserCardRow` | `mock_funding_accounts` (`kind = 'CREDIT'`) + `card_products` | The cards the router charges. `account_name` = `display_name`, `mask` = `last4`, `card_product_id` = catalog id (`cp-<product_slug>`). `points_balance` is 0 (not tracked) |
| `CardProduct` | `card_products` | Catalog display names from `mobile/src/lib/catalog.ts`; `cp-other` = `other-card` (generic, 1x) |
| `CardProductRate` | `card_product_rates` | Demo estimates, the same numbers as `catalog.ts` (seeded in `seed.sql`) |
| `ProfileRow` | `profiles` | `display_name` = `full_name`. `routing_mode`, `manual_card_id`, `default_card_id` added by `20261010200100_app_preferences.sql`. Setup progress stays in auth metadata |
| `OneTapCardRow` | `reclaimed_cards` (`ACTIVE`/`FROZEN`) | `last4` = last four characters of `display_id`; `FROZEN` = `paused` |
| `TransactionRow` | `payment_transactions` with `decision_reason` set | Routing columns from `20261010200000_payment_routing.sql`. `routed_card_id` = `funding_account_id`. Declines before routing (frozen card, limits) are not shown |

The app talks to Supabase directly with the user's JWT. RLS lets it read only its own rows, and column grants let it write only `profiles.{full_name, routing_mode, manual_card_id, default_card_id}` and `mock_funding_accounts.{priority, card_product_id, match_source}` on its own rows. A trigger rejects pointing a profile at another user's card.

## Backend endpoints the app calls

All are under `/api/v1`, need the user's Supabase token, and return the `{ success, data }` envelope.

| App call | Endpoint | Behavior |
|---|---|---|
| `api.connectCards()` (setup step 1) | `POST /plaid/link-token` → Plaid Link → `POST /plaid/exchange-token` → `POST /onetap/connect-cards` | The user signs in to their bank in **Plaid Link**. The backend imports the accounts, then creates one routable card per **credit** account. The name, last four, balance and limit all come from Plaid, and each card is linked to its Plaid account (`mock_funding_accounts.financial_account_id`), so reconnecting refreshes it instead of duplicating it. No connected credit card: `NO_CREDIT_CARDS_CONNECTED`. Nothing is invented when Plaid isn't configured |
| `api.createOneTapCard()` (setup step 4) | `POST /onetap/card` | Returns the user's card, or opens an enrollment session and **waits up to `ONETAP_ENROLL_WAIT_MS` (45 s) for the NFC card to be tapped** on the reader. The screen shows "Hold your OneTap card on the reader." Development or `HARDWARE_TEST_MODE=true` only |
| `api.chat()` (Assistant) | `POST /chat` | **Not implemented on the backend yet.** The Assistant tab shows its error state in live mode |

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
