# Architecture

## Components

```
┌────────────┐  PC/SC   ┌──────────────────┐  HMAC-signed HTTPS   ┌──────────────────────────────────────────┐
│ ACR1252U + │────────▶│ hardware-bridge   │────────────────────▶│ API (Express 5, /api/v1)                 │
│ NFC cards  │         │ pcsc-mini driver  │  tap / reader events │  ├─ HardwareService (tap routing)        │
└────────────┘         │ presentation FSM  │                      │  ├─ AuthorizationService  ◀─ payment-core │
                       └──────────────────┘                      │  ├─ PaymentLifecycleService (capture,     │
┌──────────────┐ HMAC  ┌──────────────────┐                      │  │   settle, reverse, refund)             │
│ Terminal UI  │──────▶│ terminal gateway │─────────────────────▶│  ├─ BillPaymentService (test mode)        │
│ (React/Vite) │◀─ws───│ (holds secret)   │◀──── realtime ws ────│  ├─ PlaidService ─▶ PlaidGateway (SDK)    │
└──────────────┘       └──────────────────┘                      │  ├─ Lithic adapter (Sandbox) + ASA        │
                                                                  │  ├─ CardMatchingService (10 seeded cards) │
┌──────────────┐  Supabase JWT (REST + ws)                        │  └─ RealtimeHub (WebSocket)               │
│ Mobile app   │─────────────────────────────────────────────────▶│                                          │
│ Expo/RN      │◀────────────────────── Supabase Auth ───────┐    └──────────────┬───────────────────────────┘
└──────────────┘                                             │                   │ pg (transactions, row locks)
                                                             ▼                   ▼
                                                    ┌─────────────────────────────────────┐
                                                    │ Supabase: Auth + Postgres 17 (RLS)  │
                                                    └─────────────────────────────────────┘
```

## Design decisions

- **Modular monolith.** One API process with service classes; no microservices. External SDKs sit behind interfaces: `PlaidGateway`, `LithicGateway`, `PaymentProcessor`, `FundingProvider`, `BillPaymentProvider` and `ReaderDriver`. Business logic never imports an SDK directly.
- **Direct Postgres for money paths.** The API uses `pg` with explicit transactions and `SELECT … FOR UPDATE` row locks for checkouts, cards and funding accounts. PostgREST (supabase-js) cannot do multi-statement transactions. Supabase is still the system of record and the auth provider.
- **Defense in depth.** The TypeScript state machine is mirrored by a Postgres trigger. Ledger balance is checked in code *and* by a deferred constraint trigger. Ledger entries are append-only (trigger). RLS is enabled on every table.
- **Workspace packages ship TypeScript source.** Metro (mobile), tsx (dev), Vitest and tsup (builds) all consume `@reclaimed/*` directly; tsup bundles them into `dist/`.
- **Deterministic authorization.** No AI or randomness in the payment path. The funding order comes from the `FundingSelector` interface, the Phase 2 seam.
- **Realtime.** An authenticated WebSocket (`/api/v1/realtime`) pushes `payment.updated`, `enrollment.updated`, `hardware.*`, `bill_payment.updated` and `plaid.synced`. The app turns these into TanStack Query invalidations, and polling is the fallback.
- **Background jobs.** In-process (1 s tick): checkout expiry, settlement completion, bill-pay progression and enrollment expiry. They are safe to run in a single API instance. Use a queue or cron if you scale out.

## Data model (summary)

| Domain | Tables |
|---|---|
| Identity | `profiles`, `user_settings`, `audit_logs`, `idempotency_records`, `webhook_events` |
| Plaid (reported data) | `plaid_items` (encrypted token), `plaid_sync_state` (cursor), `financial_accounts`, `account_liabilities`, `transactions` |
| Card catalog | `card_products` (10 seeded, stable slugs and UUIDs), `user_cards` (account → product) |
| Hardware | `hardware_readers`, `hardware_tap_events`, `nfc_enrollments`, `reclaimed_cards`, `test_terminals` |
| Simulation | `mock_funding_accounts`, `payment_transactions`, `authorization_attempts`, `authorization_events`, `funding_attempts`, `ledger_accounts/journals/entries`, `settlement_records`, `refund_records`, `processor_events` |
| Bill pay | `bill_payment_intents`, `bill_payment_attempts`, `bill_payment_events` |

All simulated money is `bigint` cents. Plaid-reported balances (`financial_accounts`) are **never** written by simulated activity; tests assert this.

## Repository layout

See the [PRD](../onetapPRD.md). Migrations live in `packages/database/supabase/migrations`. The seed lives in `packages/database/supabase/seed.sql`.
