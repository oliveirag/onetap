# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, and others) working in this repo.

## What this is

OneTap: one card that routes every purchase to the best of the credit cards the user already
owns. A judge taps an NFC card at a store laptop, our backend authorizes the tap, picks the
underlying card by category, charges it through Stripe (test mode), and the phone shows the result
within 2 seconds.

Built for Knight Hacks IX (UCF, Oct 9 to 11, 2026). `onetapPRD.md` is the full PRD: features and
acceptance criteria (section 3), architecture (5), data model (6), UI principles (7), security (8),
real vs simulated (9), build plan and gates (10). Read the relevant section before changing a feature.

## Ownership

| Area | Tech | Owner |
|---|---|---|
| Mobile app | Expo (React Native), TypeScript, EAS dev build | Gui |
| Backend | Node, TypeScript, Express or Fastify, Railway | Ehsan |
| Database, auth, realtime | Supabase | Ehsan |
| Payments | Stripe test mode | Ehsan |
| Bank data | Plaid sandbox | Amer |
| Store page | Next.js | Amer |
| NFC reader program | Node, nfc-pcsc, ACR122U | Amer |
| Assistant | Claude via Anthropic API | Sultan |
| Catalog and seed data, pitch | | Sultan |

Stay inside the area you were asked to work on. Changes to a shared contract need the other owner.

## Shared contracts

Agree these before building against them; every workstream uses fake data that matches them.
1. **Tap event:** card ID, terminal ID, timestamp. Fake tap and real reader send it identically.
2. **Checkout:** merchant ID and card ID in; approved or declined, last four and timings out.
3. **Transaction row:** exactly the `transactions` fields in onetapPRD.md section 6. The app builds the
   result screen from this row alone.
4. **Chat:** mode (`relay` or `points`) and message in; reply text out.

## Non-negotiables

- **Secrets stay on the server.** Stripe, Plaid, Anthropic and Supabase service keys live only in
  backend env vars. Never in the app, the store page, or git. Commit `.env.example`, never `.env`.
- **Row-level security** on every user table. The app talks to Supabase directly with the anon key;
  anything needing a secret goes through the backend.
- **Money is integer cents** everywhere. Display always shows two decimals.
- **Claude is never in the routing path.** Routing is a deterministic lookup. In the Assistant, our
  code computes every number and Claude only explains it.
- **Answer the tap first, then write.** The authorization response must never wait on a DB write
  or the Stripe charge. Target p95 under 500 ms.
- **Idempotent Stripe calls.** Every Stripe request carries an idempotency key, so a retry never
  charges twice.
- **Verify Stripe webhook signatures** (`Stripe-Signature`); reject and log unsigned requests.
- **Stripe test mode only.** `STRIPE_SECRET_KEY` must be `sk_test_...`; card numbers never pass
  through our API (saved test payment methods only).
- **Only last four digits** of any card reach the app or store page.
- **Label demo data** (seeded history, point values, award prices) in one consistent quiet style.

## Mobile app notes

- Dev build, not Expo Go: Sign in with Apple and Plaid Link need native code. Adding a native
  module means a new EAS build, so batch native dependency changes.
- `ios/` and `android/` are generated (Continuous Native Generation) and gitignored. Configure
  native behavior through `app.json` / `app.config.ts` and config plugins, not by editing them.
- Tabs: Home, Dashboard, Cards (the Assistant was removed). The routing result must appear on any tab when a new
  transaction arrives via Supabase Realtime, with a haptic, and refetch on reconnect.
- Visual system comes from Gui's design system (achromatic, dark-first), set in Geist. The store
  page uses the same tokens so both screens read as one product.
- Every screen has loading, empty and error states. One meaningful animation: the result arriving.

## Working here

- Layout: `mobile/` (the app, own install), `apps/api`, `apps/hardware-bridge`, `apps/terminal-simulator`,
  `packages/*` (npm workspaces), `reader/` (Amer's reader bridge, own install), `shared/contracts.ts`.
  How the app maps onto the backend: `docs/onetap-app.md`. Backend setup: `docs/setup.md`.
- Commands (root): `npm install`, `npm run dev` (API, terminal, bridge), `npm run dev:mobile`,
  `npm run db:start|db:migrate|db:seed`, `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run smoke:onetap` (end to end against a running local stack).
- Don't commit or push unless asked.
- Git workflow for this project only: for each authorized change set, create a new feature branch,
  commit on that branch, push it, and open a pull request against the repository's default branch
  for approval. Never commit or push directly to the default branch, and do not merge a pull request
  without explicit approval.
- Before pushing, fetch the latest base branch and resolve any merge conflicts. After opening the
  pull request, verify that GitHub reports it as mergeable.
