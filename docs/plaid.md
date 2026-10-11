# Plaid integration

Docs: https://plaid.com/docs/ · React Native: https://plaid.com/docs/link/react-native/

## Credentials (free)

1. Create a Plaid developer account and copy the **Sandbox** `client_id` and `secret` into `.env` (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`).
2. Set `PLAID_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`).
   `PLAID_PRODUCTS` (default `transactions`; must include it) and `PLAID_COUNTRY_CODES` (default `US`) are comma-separated and validated against the Plaid SDK enums at startup. Liabilities stays an *optional* product controlled by `ENABLE_PLAID_LIABILITIES`.
3. Dashboard → *Allowed Android package names*: add `com.reclaimed.app`. For iOS OAuth institutions you would also register `PLAID_REDIRECT_URI`; non-OAuth Sandbox institutions work without it.
4. Optional webhooks: expose `http://localhost:4000/api/v1/webhooks/plaid` via an HTTPS tunnel and set `PLAID_WEBHOOK_URL`.

`PLAID_ENV=production` is refused at startup in Phase 1.

## Flow

| Step | Where |
|---|---|
| Link token (`/link/token/create`, products `transactions`, `optional_products: liabilities`) | `POST /api/v1/plaid/link-token` |
| Open Link in the app | `mobile/src/lib/plaid.ts`: `createPlaidLinkSession({ token, onSuccess, onExit, onEvent })` then `session.open()` (SDK v13). Setup step 1 calls `/plaid/link-token` → Link → `/plaid/exchange-token` → `/onetap/connect-cards` |
| Public token → access token (`/item/public_token/exchange`); AES-256-GCM encrypted at rest | `POST /api/v1/plaid/exchange-token` |
| Accounts and balances (`/accounts/get`), institution name | `PlaidService.refreshAccounts` |
| Transactions (`/transactions/sync`) with cursor persistence, pagination, and a restart on `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` | `PlaidService.syncTransactions` |
| Liabilities (`/liabilities/get`), only when enabled and supported; missing fields stored as `null` | `PlaidService.refreshLiabilities` |
| Manual sync | `POST /api/v1/plaid/items/:id/sync` |
| Disconnect (`/item/remove`, then local deletion even if Plaid already invalidated the item) | `DELETE /api/v1/plaid/items/:id` |
| Repair (update-mode link token with the item's access token) | `POST /plaid/link-token {itemId}` |

Client roles (`anon`, `authenticated`) have no access to `plaid_items`/`plaid_sync_state`, and only `SELECT` (own rows via RLS) on `financial_accounts`, `account_liabilities`, `transactions`, `user_cards` (migration `20261010181716_plaid_data_grants`).

Access tokens and Plaid secrets never leave the backend. Responses never include them, and pino redacts them from logs.

## Transaction sync details

- All pages are fetched first, then applied in **one DB transaction** together with the new cursor. A failure leaves the old cursor, so retrying is safe.
- Upserts key on `plaid_transaction_id`, so re-delivered transactions don't duplicate. `removed` rows are deleted.
- Pending→posted: Plaid sends the posted transaction (with `pending_transaction_id`) in `added` and the pending one in `removed`. Both are applied.
- A row-level `sync_in_progress` flag (with a 5-minute staleness override) prevents concurrent syncs of the same item.

## Webhooks

`POST /api/v1/webhooks/plaid` verifies the `Plaid-Verification` JWT:
- ES256 only
- key fetched by `kid` from `/webhook_verification_key/get`, then cached
- `iat` within 5 minutes
- `request_body_sha256` must equal the SHA-256 of the raw body

Every webhook is stored in `webhook_events`; deduplication uses the body hash. Handled codes:

- `TRANSACTIONS.SYNC_UPDATES_AVAILABLE` / `INITIAL_UPDATE` / `HISTORICAL_UPDATE` → sync
- `LIABILITIES.DEFAULT_UPDATE` → refresh liabilities
- `ITEM.ERROR` (`ITEM_LOGIN_REQUIRED`), `PENDING_EXPIRATION`, `PENDING_DISCONNECT` → `LOGIN_REQUIRED`
- `USER_PERMISSION_REVOKED` → `REMOVED`
- `LOGIN_REPAIRED` → `ACTIVE`

## Card product matching

On import, credit accounts are scored against the 10 seeded products using issuer aliases and product keywords, with whole-word matching (so "Citizens" ≠ "Citi").

- Only a single, unambiguous issuer+product match is auto-linked, and it is flagged *suggested*. It is not marked confirmed.
- Ambiguous or issuer-only matches require the user to choose (`PUT /accounts/:id/card-product`).
- No match leaves the product unconfirmed. Nothing is invented.

## Sandbox testing

In Link, choose any institution and log in with `user_good` / `pass_good`. Sandbox credit accounts (e.g. "Plaid Credit Card") don't match seeded products, so pick one manually in Demo D.

## Status in this delivery

- Implemented and covered by automated tests with an in-memory `PlaidGateway`: link token, exchange, multiple institutions, sync, duplicates, mutation restart, liabilities, login-required, webhook verification with a real ES256 signature, disconnection.
- **Live Plaid Sandbox: passing** (`apps/api/test/plaid-sandbox.live.test.ts`, opt-in). It drives the real HTTP API with the real SDK gateway on an in-memory database: auth enforcement, `/link/token/create`, invalid public token, `/item/public_token/exchange` (First Platypus Bank, 14 accounts incl. 2 credit cards), `/transactions/sync` polling and idempotent re-sync, cross-user isolation, `/sandbox/item/reset_login` → `LOGIN_REQUIRED` → update-mode token, and `/item/remove` (token confirmed revoked). Run it with:

  ```sh
  set -a; . ./.env; set +a; PLAID_LIVE=1 npx vitest run apps/api/test/plaid-sandbox.live.test.ts
  ```
- Not exercised live: the Link UI itself (needs a device/simulator dev build), OAuth institutions, and Plaid-delivered webhooks (need a public HTTPS URL; covered by signed-JWT tests).

## Platform-specific Link tokens

The app sends `platform: 'ios' | 'android'` to `POST /plaid/link-token`. Android tokens include `android_package_name` (Plaid rejects it unless registered under *Allowed Android package names*) and never `redirect_uri`; other platforms get `redirect_uri` only when `PLAID_REDIRECT_URI` is set.
