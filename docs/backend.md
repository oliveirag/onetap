# Reclaimed — Phase 1 prototype

Reclaimed is building a universal physical payment card. You connect your existing credit cards, tap one Reclaimed card, and the purchase is routed to the best underlying card.

**Phase 1** is the technical foundation. A physical NFC tap on an **ACS ACR1252U** reader drives a fully simulated payment through our backend and shows up in our iOS/Android app:

```
Generic NFC card ─▶ ACR1252U ─(PC/SC)─▶ hardware-bridge ─(HMAC)─▶ API ─▶ authorization engine
                                                                    │        ├─ mock funding (primary → fallback)
Terminal simulator ─(HMAC)─▶ pending checkout ─────────────────────┘        ├─ mock / Lithic Sandbox processor
                                                                             └─ double-entry ledger ─▶ Supabase
Mobile app ◀── REST + authenticated WebSocket ──────────────────────────────────────────────┘
```

> ⚠️ **No real money moves.** All payments and bill payments are simulated or sandbox-only. Generic NFC UIDs are development identities, not payment credentials. Reclaimed holds no payment-network certification.

## What's in the box

| Path | What it is |
|---|---|
| `apps/mobile` | Expo SDK 57 / React Native app (Expo Router, TanStack Query, Supabase Auth, Plaid Link v13) |
| `apps/api` | Express 5 + TypeScript REST API (`/api/v1`), realtime WebSocket, Plaid, Lithic, webhooks |
| `apps/hardware-bridge` | PC/SC bridge for the ACR1252U (`pcsc-mini`), diagnostics and the physical test runner |
| `apps/terminal-simulator` | Local store-terminal web app (React/Vite) plus a signing gateway |
| `packages/shared` | Enums, Zod schemas, DTOs, error codes, HMAC helpers |
| `packages/database` | Supabase project, SQL migrations, RLS, seed (10 card products), PGlite test harness |
| `packages/payment-core` | Authorization engine, funding selector, state machine, ledger, settlement/refunds, bill pay |
| `docs/` | Architecture, setup, Plaid, Lithic, hardware, payment flow, security, Phase 2 handoff |

## Quick start (Apple Silicon Mac)

```bash
npm install
cp .env.example .env                 # then fill secrets (see docs/setup.md)
npm run db:start                     # local Supabase in Docker: migrations + seed
npm run db:seed                      # idempotent: 10 card products + dev terminal
npm run dev                          # API :4000, terminal :5173, hardware bridge
npm run dev:mobile                   # Expo dev server (needs a development build for Plaid)
```

Full instructions, including the mobile development build and a physical phone, are in **[docs/setup.md](docs/setup.md)**.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `dev:api` / `dev:mobile` / `dev:terminal` / `dev:hardware` | Run components |
| `npm run hardware:diagnose` | Reader, USB, driver, PC/SC, card type, UID, removal and errors (real hardware) |
| `npm run hardware:test` | Guided **physical** acceptance test; writes `docs/hardware-test-results.md` |
| `npm run db:start` / `db:stop` / `db:reset` / `db:migrate` / `db:seed` | Database |
| `npm run smoke` | End-to-end API smoke test against the running local stack (software-simulated taps) |
| `npm run test` / `typecheck` / `lint` / `build` | Quality gates (CI uses mocks; no NFC reader needed) |

## Status

See the implementation report in the PR/hand-off notes and **[docs/hardware-test-results.md](docs/hardware-test-results.md)**. Physical reader tests are **BLOCKED** until they are run with the ACR1252U attached. Plaid and Lithic live-sandbox calls need your free developer credentials.
