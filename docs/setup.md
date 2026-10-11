# Setup — Apple Silicon MacBook (macOS)

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.12+ (tested 22.20) | `nvm install 22` |
| npm | 10+ | workspaces |
| Docker Desktop | 4.x | runs local Supabase |
| Xcode **26+** (Swift 6.2) / Android Studio + SDK | latest | only for the mobile **development build**. Expo SDK 57's native modules (`expo-modules-jsi`) require Swift tools 6.2; Xcode 16.4 fails with “package 'apple' is using Swift tools version 6.2.0”. Verified with Xcode 27.0 on the iPhone 18 Pro (iOS 27) simulator |
| ACS ACR1252U | — | Apple's bundled CCID driver supports it (VID 072F, PID 223B/223E). No ACS driver needed |

No paid services are required. Plaid Sandbox and Lithic Sandbox need **free** developer accounts.

## 1. Install and configure

```bash
git clone <repo> reclaimed && cd reclaimed
npm install                  # backend workspace (apps/*, packages/*)
npm ci --prefix mobile       # the OneTap app has its own install
cp .env.example .env
cp mobile/.env.example mobile/.env
```

Generate secrets in `.env`:

```bash
openssl rand -base64 32   # PLAID_TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # HARDWARE_BRIDGE_SECRET
openssl rand -hex 24      # TEST_TERMINAL_SECRET
```

## 2. Database (local Supabase)

```bash
npm run db:start          # first run pulls Docker images; applies all migrations + seed.sql
```

The command prints the local URLs and keys. Put `PUBLISHABLE_KEY` into `SUPABASE_PUBLISHABLE_KEY` (and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `mobile/.env`). Put `SECRET_KEY` into `SUPABASE_SERVICE_ROLE_KEY`, which is backend only.

```bash
set -a; . ./.env; set +a
npm run db:seed           # idempotent: 10 card products + TERM-DEV-001 terminal (hash of TEST_TERMINAL_SECRET)
```

- Studio: http://127.0.0.1:54323 · Mailpit (verification emails): http://127.0.0.1:54324
- Email confirmation is enabled. Emails contain a 6-digit code (entered in the app) and a `reclaimed://auth/callback` link.
- Reset: `npm run db:reset`. Hosted Supabase: `supabase link` and `supabase db push --workdir packages/database`, or `npm run db:migrate` with `DATABASE_URL`.

### Hosted project (`usdkaniukgrnneweshfl`)

Migrations `20261010000100`–`20261010000700` and `seed.sql` (plus the `TERM-DEV-001` terminal) are applied to the hosted project. `supabase_migrations.schema_migrations` records them under the same versions as the files, so `db push` / `db:migrate` treat them as done.

- The direct host `db.<ref>.supabase.co` is IPv6-only. Use the Session pooler: `postgresql://postgres.usdkaniukgrnneweshfl:<db-password>@aws-1-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true`.
- Schema changes: add a new file `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` and apply it with `npm run db:migrate`. Never edit an applied file. If you apply one through the Supabase MCP `apply_migration` tool instead, it records its own timestamp: update that row's `version` to the file's version, and apply migrations one at a time, because versions are per-second.
- `.env.local-stack` holds the local-Docker values. Copy them over `.env` to switch back.
- **Check `DATABASE_URL` before `npm run db:migrate` / `db:seed`:** they write to whatever it points at, including the hosted project.

## 3. Backend, terminal, bridge

```bash
npm run dev               # API http://localhost:4000 · terminal http://localhost:5173 · hardware bridge
```

Or run them separately: `npm run dev:api`, `npm run dev:terminal`, `npm run dev:hardware`.

Health check: `curl localhost:4000/health` should return `{"liveMoney":false,...}`.

## 4. Mobile app: OneTap (`mobile/`)

`mobile/` is the OneTap app (Expo SDK 57, Gui's design system). Plaid Link and Sign in with Apple need native code, so use a development build, not Expo Go:

```bash
cd mobile
npx expo run:ios          # builds and installs the dev client (Xcode 26+)
npm run start             # later runs (or `npm run dev:mobile` from the root)
```

`mobile/.env` (public values only):

| Variable | Local stack |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `http://localhost:54321` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the `PUBLISHABLE_KEY` printed by `npm run db:start` |
| `EXPO_PUBLIC_API_URL` | `http://localhost:4000` |
| `EXPO_PUBLIC_USE_MOCKS` | `0` for the real backend, `1` for typed fake data with no backend |

On a **physical phone**, use your Mac's LAN IP instead of `localhost` for both URLs. The phone and Mac must be on the same Wi-Fi network. How the app maps onto the backend: [onetap-app.md](onetap-app.md).

`npm run smoke:onetap` (with `npm run dev` running against local Supabase) runs the app's whole flow end to end with simulated taps: sign in, connect cards, link the card, check out, routed receipt over Realtime, Manual mode.

## 5. Plaid Sandbox (optional for Demos A/D; required for B/C)

See [plaid.md](plaid.md). Set `PLAID_CLIENT_ID` and `PLAID_SECRET` (Sandbox), and register `com.reclaimed.app` as an allowed Android package in the Plaid dashboard.

## 5b. Stripe test mode (optional)

With `STRIPE_SECRET_KEY` (an `sk_test_` key) set, each approved tap is also charged through Stripe
test mode, after the tap has been answered:
- On the first charge for a user, the API creates one Stripe customer and saves one Stripe test
  card per credit funding account, matched to its network (`pm_card_visa`, `pm_card_amex`, …).
  No card numbers pass through our code.
- The routed card is charged for the full amount. The payment's statement descriptor reads
  `ONETAP* <MERCHANT>`, and its metadata carries the transaction id, MCC and the routed card.
- If the routed card is declined, the default card is charged once. If Stripe is unreachable, the
  charge stays `pending` and a background job retries it.
- The result lands on `payment_transactions.charge_status` (`pending`, `succeeded` or `failed`), and
  the receipt in the app shows it.

**Webhook.** It confirms charges that weren't final when they were created. A signing secret
belongs to one endpoint, so a secret copied from another app's endpoint won't verify ours.
- Locally: `stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe`, then put the printed
  `whsec_…` in `STRIPE_WEBHOOK_SECRET`.
- Hosted: `npm run setup:stripe -- https://<public-api-host>`.

Test cards succeed straight away, so the demo works before the webhook is set up.

**Where to look.** In the Stripe Dashboard (test mode), open Payments. The account's shortened
statement descriptor (Settings → Public details) should be `ONETAP`.

## 6. Hardware

```bash
npm run hardware:diagnose -- 30      # tap a card within 30 s
npm run hardware:test                # guided physical acceptance test
```

See [hardware.md](hardware.md).

## Demo walkthrough (physical NFC purchase)

1. Plug in the ACR1252U, then run `npm run dev`. The bridge should log `reader READER_CONNECTED`.
2. In the OneTap app: sign up and verify your email → **Connect cards** → sign in to a Plaid Sandbox bank in Plaid Link. Use your custom test user from the Plaid dashboard to get several credit cards; `user_good` / `pass_good` gives one.
3. Check the card matches → pick Auto or Manual → **Create my card**, then tap the NFC card on the reader.
4. Terminal (http://localhost:5173): choose a merchant (Starbucks is dining, Shell is gas), enter an amount, then **Start checkout**.
5. Tap the card. The terminal shows the approval and the card it was routed to; the receipt opens on the phone.
6. On the terminal: **Capture → Settle → Refund**.
7. Freeze the card, start a new checkout and tap: it is *Card frozen*.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `HARDWARE_AUTH_FAILED` from the bridge | Same `HARDWARE_BRIDGE_SECRET` for API and bridge; Mac clock in sync (5-min skew limit) |
| `TERMINAL_AUTH_FAILED` | Run `npm run db:seed` after setting `TEST_TERMINAL_SECRET`; restart API and terminal |
| Reader not listed | `npm run hardware:diagnose`; try another port or cable; macOS sometimes needs ~5 s after plug-in |
| Phone can't reach API | Use the LAN IP, not `localhost`; check the macOS firewall |
| `PLAID_NOT_CONFIGURED` | Set Plaid Sandbox keys and `PLAID_TOKEN_ENCRYPTION_KEY` |
