# Security

Phase 1 moves no real money, but it handles real financial data from Plaid, so it is built to production-grade data-handling standards where that is practical.

## Controls implemented

| Area | Control |
|---|---|
| Authentication | Supabase Auth (email/password, email verification required, recovery, PKCE deep links). The API verifies every access token: asymmetric JWTs locally against the project JWKS (ES256, verified live against local Supabase), legacy HS256 via `auth.getUser`. The user ID comes only from the verified token |
| Authorization | Every query is scoped by `user_id` from the token; cross-user access returns 404 (tested). RLS is enabled on **all** tables with read-own policies; secret/operational tables have no client policies and `REVOKE ALL` from `anon`/`authenticated` (tested in PGlite) |
| Session storage (mobile) | Supabase session in the iOS Keychain / Android Keystore (`expo-secure-store`, chunked). The TanStack cache is cleared on logout. Tokens refresh only in the foreground |
| Secrets | Plaid secret, Lithic key, service-role key, bridge and terminal secrets are backend-only env vars. `EXPO_PUBLIC_*` holds only public values. `.env` is gitignored |
| Plaid tokens | AES-256-GCM (`v1:iv:tag:ciphertext`) with `PLAID_TOKEN_ENCRYPTION_KEY`; never returned to clients |
| Webhooks | Plaid: ES256 JWT, body SHA-256 and 5-minute `iat` checks. Lithic: Standard Webhooks HMAC via the official SDK. Unverified webhooks are rejected and logged |
| Hardware and terminal | HMAC-SHA256 request signatures over `timestamp.method.path.rawBody` with a 5-minute skew limit and constant-time compare. The terminal secret's SHA-256 is stored in the DB. The terminal secret stays in the gateway, never in the browser |
| NFC data | Raw UIDs are never persisted (keyed HMAC fingerprint plus a masked suffix). Enrollment is dev-only. A UID binds to at most one live card |
| Payments integrity | Row locks, DB transactions, unique constraints (one auth per checkout, one open checkout per terminal, no duplicate funding attempts), `Idempotency-Key` storage, a DB-level state-machine trigger, and an append-only ledger with commit-time balance checks |
| Limits | Per-card per-transaction ($1,000) and daily ($2,500) simulated limits. Rate limiting per route group (`express-rate-limit`) |
| Input | Zod validation on every body/query. 256 KB body cap. Typed error envelope with no stack traces or 5xx internals leaked |
| Transport and headers | Helmet, a strict CORS allow-list, and `x-powered-by` disabled |
| Logging and audit | pino structured logs with request IDs and redaction (authorization headers, tokens, secrets, PAN, UID). `audit_logs` records enrollment, card status changes, Plaid link/unlink and account deletion |
| Live-money guardrails | `PLAID_ENV=production` refused. Lithic is pinned to `sandbox`. Processors are mock or sandbox only. Bill pay is mock only. The API reports `liveMoney:false` |

## Secure deletion

`DELETE /api/v1/me`:
1. Calls Plaid `/item/remove` for every item.
2. Revokes Reclaimed cards.
3. Writes an audit record.
4. Deletes the Supabase auth user. The FK cascade removes profile, settings, Plaid items/accounts/transactions/liabilities, mock accounts, cards, enrollments and bill payments.

Simulated ledger journals and payment rows are retained **without personal links** (`user_id` set to null) for ledger integrity. This was verified end to end against local Supabase.

## Explicit non-goals (Phase 1)

- No storage of real PANs, CVVs or cryptographic keys.
- No card cloning or EMV emulation.
- No NFC UID used as a real-money credential.
- No live processing, and no PCI DSS, network or regulatory certification is claimed.

## Before any production use

- PCI DSS scoping, a SOC 2 programme, a pen test and a threat model of the bridge/terminal channel (mTLS or device attestation instead of a shared HMAC secret).
- A KMS-managed key for token encryption, with rotation.
- Moving background jobs and rate-limit state to shared infrastructure.
