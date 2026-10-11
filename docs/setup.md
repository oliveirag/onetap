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
npm install
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env
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

The command prints the local URLs and keys. Put `PUBLISHABLE_KEY` into `SUPABASE_PUBLISHABLE_KEY` (and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `apps/mobile/.env`). Put `SECRET_KEY` into `SUPABASE_SERVICE_ROLE_KEY`, which is backend only.

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
- `.env.local-stack` and `apps/mobile/.env.local-stack` hold the previous local-Docker values. Copy them over `.env` to switch back.

## 3. Backend, terminal, bridge

```bash
npm run dev               # API http://localhost:4000 · terminal http://localhost:5173 · hardware bridge
```

Or run them separately: `npm run dev:api`, `npm run dev:terminal`, `npm run dev:hardware`.

Health check: `curl localhost:4000/health` should return `{"liveMoney":false,...}`.

## 4. Mobile app (iOS / Android)

Plaid Link uses a native SDK, so **Expo Go cannot run the Connect Bank flow**. Use a development build:

```bash
cd apps/mobile
npx expo run:ios          # or: npx expo run:android   (builds and installs the dev client)
npm run start             # later runs: start Metro and open the dev client
```

iOS 27 refuses to launch apps that don't adopt the UIScene life cycle (crash in `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`). Expo SDK 57's app template doesn't yet, so the local config plugin `plugins/with-ios-scene-lifecycle.js` registers Expo's `ExpoAppSceneDelegate` in `Info.plist` and removes the window creation from `AppDelegate.swift`. It runs on every `expo prebuild` / `expo run:ios`, because `ios/` is generated and gitignored. Drop the plugin once the Expo template adopts scenes.

On a **physical phone**, set `EXPO_PUBLIC_API_URL=http://<your-mac-LAN-IP>:4000` and `EXPO_PUBLIC_SUPABASE_URL=http://<LAN-IP>:54321` in `apps/mobile/.env`. The phone and Mac must be on the same Wi-Fi network.

## 5. Plaid Sandbox (optional for Demos A/D; required for B/C)

See [plaid.md](plaid.md). Set `PLAID_CLIENT_ID` and `PLAID_SECRET` (Sandbox), and register `com.reclaimed.app` as an allowed Android package in the Plaid dashboard.

## 6. Hardware

```bash
npm run hardware:diagnose -- 30      # tap a card within 30 s
npm run hardware:test                # guided physical acceptance test
```

See [hardware.md](hardware.md).

## Demo A walkthrough (physical NFC purchase)

1. Plug in the ACR1252U, then run `npm run dev`. The bridge should log `reader READER_CONNECTED`.
2. In the app: register → verify the email (Mailpit code) → **Cards → Reclaimed Card → Enroll a card** → tap the NFC card.
3. On the same screen tap **Create demo accounts** to create Mock Citi ($2,000, primary), Mock Chase ($5,000, secondary) and Mock Checking.
4. Terminal (http://localhost:5173): choose **Walmart**, enter **$100.00**, then **Start checkout**. The screen shows *Tap Reclaimed Card*.
5. Tap the card. The terminal shows *Approved, funded by Mock Citi*, and the app's Activity shows the Walmart transaction.
6. On the terminal: **Capture → Settle → Refund**. In the app, open the transaction to see the double-entry ledger.
7. Freeze the card in the app, start a new checkout and tap: it is *Card frozen*.
8. **Settings → Mock funding accounts → Stage balance** on Mock Citi (e.g. $1,990), check out $100 and tap. The fallback approves on Mock Chase.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `HARDWARE_AUTH_FAILED` from the bridge | Same `HARDWARE_BRIDGE_SECRET` for API and bridge; Mac clock in sync (5-min skew limit) |
| `TERMINAL_AUTH_FAILED` | Run `npm run db:seed` after setting `TEST_TERMINAL_SECRET`; restart API and terminal |
| Reader not listed | `npm run hardware:diagnose`; try another port or cable; macOS sometimes needs ~5 s after plug-in |
| Phone can't reach API | Use the LAN IP, not `localhost`; check the macOS firewall |
| `PLAID_NOT_CONFIGURED` | Set Plaid Sandbox keys and `PLAID_TOKEN_ENCRYPTION_KEY` |
