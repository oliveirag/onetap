# Payment flow (simulated)

## Checkout → tap → authorization

1. **Terminal** (`POST /test-terminal/transactions`, HMAC-signed by the gateway) creates a `payment_transactions` row in `CREATED` with merchant, MCC, amount and an `expires_at` deadline (`CHECKOUT_TTL_MS`, default 90 s). A partial unique index allows **one open checkout per terminal**. `Idempotency-Key` makes creation replay-safe.
2. **Bridge** detects a *new presentation* of a card and reads the UID (`FF CA 00 00 00`). It posts `POST /hardware/tap-events` with a fresh `tapId`. One continuous presentation yields exactly one event.
3. **HardwareService** records the tap (idempotent on `tapId`), fingerprints the UID with HMAC-SHA256 (the raw UID is never stored), and routes it:

   | Situation | Outcome |
   |---|---|
   | Same UID re-detected on the same reader within `TAP_DEBOUNCE_MS` | `DUPLICATE_TAP` |
   | Open checkout on this reader (enrolled **or** unknown card) | `AUTHORIZATION_STARTED` |
   | Pending enrollment (card not yet enrolled) | `ENROLLED` |
   | Pending enrollment, card already enrolled | `ENROLLMENT_REJECTED` |
   | Enrolled card, nothing pending | `NO_PENDING_CHECKOUT` (no payment created) |
   | Unknown card, nothing pending | `UNKNOWN_CARD` |

4. **AuthorizationService** (`packages/payment-core/src/authorization.ts`) runs these steps:
   1. Lock the checkout. Validate terminal ownership, `CREATED` state, matching amount/currency/merchant/MCC, and the deadline.
   2. Insert `authorization_attempts`. Its **unique `payment_transaction_id`** guarantees a checkout is authorized at most once. Concurrent duplicates wait for, then replay, the first result.
   3. Card checks: missing → `INVALID_CARD`; `FROZEN` → `CARD_FROZEN`; `DISABLED/REVOKED/UNREGISTERED` → `INVALID_CARD`. Suspended user → `DECLINED`. Per-transaction or daily limit → `LIMIT_EXCEEDED`.
   4. `FundingSelector.selectCandidates()` returns an ordered list: the primary (or the default lowest-priority active account), then the secondary if fallback is on.
   5. For each candidate: lock the account and evaluate available funds (CREDIT = limit − balance − holds; DEPOSIT = balance − holds). On success, place a **hold** and post the ledger journal `AUTHORIZATION_HOLD`. Then call the **processor** with a hard timeout (`AUTHORIZATION_TIMEOUT_MS`).
      - Approved → `AUTHORIZED`.
      - Insufficient funds, inactive account, or processor NSF → release the hold and **fall back** to the next candidate. A unique constraint prevents trying the same account twice.
      - Timeout → release, `AUTHORIZATION_TIMEOUT`, state `FAILED`. Other processor errors → `INTERNAL_ERROR`.
   6. Persist the result plus latency breakdown (`total`, `db lookup`, `funding evaluation`, `processor`), funding attempts and events. Publish realtime updates to the terminal and the cardholder.

## Lifecycle state machine

```
CREATED ─▶ AUTHORIZATION_PENDING ─▶ AUTHORIZED ─▶ CAPTURED ─▶ SETTLEMENT_PENDING ─▶ SETTLED
   │                 │                   │            │  ▲                              │
   ▼                 ├─▶ DECLINED        ▼            │  └──── PARTIALLY_REFUNDED ◀──────┤
 FAILED              └─▶ FAILED       REVERSED        └──▶ PARTIALLY_REFUNDED / REFUNDED ◀┘
```

It is enforced in TypeScript (`state-machine.ts`) **and** by the Postgres trigger `enforce_payment_transition`.

| Action | Endpoint | Effect |
|---|---|---|
| Capture | `POST /test-terminal/transactions/:id/capture` | Release the auth hold, post the captured amount (partial capture allowed) |
| Settle | `…/settle` (`{immediate:true}` optional) | `SETTLEMENT_PENDING`, a settlement record, then `SETTLED` after `SETTLEMENT_DELAY_MS` |
| Reverse | `…/reverse` | `AUTHORIZED → REVERSED`, release the hold |
| Refund | `…/refund` (`amountCents?`, `Idempotency-Key`) | Full or partial; credited back to the funding account |
| Cancel | `…/cancel` | Untapped checkout `CREATED → FAILED` |

## Double-entry ledger

| Journal | Debit | Credit |
|---|---|---|
| AUTHORIZATION_HOLD | `FUNDING_HOLDS:<acct>` | `SYS:PENDING_MERCHANT_PAYABLE` |
| AUTHORIZATION_REVERSAL | `SYS:PENDING_MERCHANT_PAYABLE` | `FUNDING_HOLDS:<acct>` |
| CAPTURE | `SYS:PENDING_MERCHANT_PAYABLE` (auth amt) · `FUNDING_SPEND:<acct>` (captured) | `FUNDING_HOLDS:<acct>` · `SYS:MERCHANT_PAYABLE` |
| SETTLEMENT | `SYS:MERCHANT_PAYABLE` | `SYS:SETTLEMENT_CASH` |
| REFUND (pre/post settlement) | `SYS:MERCHANT_PAYABLE` / `SYS:SETTLEMENT_CASH` | `FUNDING_SPEND:<acct>` |
| BILL_PAYMENT_HOLD / RELEASE / COMPLETION / RETURN | see `bill-pay.ts` | |

Journals are idempotent on `idempotency_key`. Every journal must balance at COMMIT (deferred constraint trigger), and entries cannot be updated or deleted.

## Bill payments (TEST MODE)

`POST /bill-pay/payments` validates that the target is the user's Plaid **credit** account, the amount is at least $1, and the mock source has funds. It places a hold, then the job advances `SUBMITTED → PROCESSING → COMPLETED` (or `FAILED`, or `COMPLETED → RETURNED`) every `BILL_PAY_STEP_MS`. Cancel is allowed while `DRAFT`/`SUBMITTED`. Duplicate submissions with the same `Idempotency-Key` return the original. **No ACH or issuer call exists, and Plaid balances are untouched.**

## Error responses

All errors use `{ success:false, error:{ code, message, retryable, details? }, requestId }` with the codes in `packages/shared/src/errors.ts`, for example `NFC_CARD_FROZEN`, `INSUFFICIENT_FUNDS`, `INVALID_PAYMENT_STATE`, `PLAID_ITEM_LOGIN_REQUIRED`.
