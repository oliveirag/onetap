# Lithic Sandbox

Docs: https://docs.lithic.com/ · SDK: `lithic` (Node) 0.147.

Lithic Sandbox keys are self-serve and free. ASA enrollment in Sandbox is self-serve; a Production ASA key requires Lithic to enable ASA for a card program, which is out of scope.

## What is implemented

| Capability | Implementation |
|---|---|
| Sandbox client | `LithicSdkGateway` (`environment: 'sandbox'` hard-coded) |
| Test virtual cards | `POST /api/v1/reclaimed-cards/:id/lithic-card` creates a `VIRTUAL` card and stores **only the card token** |
| Authorization simulation | `LithicSandboxProcessor.authorize` → `transactions.simulateAuthorization` (PAN fetched transiently via `cards.retrieve`, never stored or logged) → `transactions.retrieve` to read `result`/`status` |
| Clearing / void / refund | `simulateClearing`, `simulateVoid`, `simulateReturn` |
| ASA responder | `POST /api/v1/webhooks/lithic/asa`: verifies `webhook-id`/`webhook-timestamp`/`webhook-signature` via the SDK's `webhooks.verifySignature` with `LITHIC_ASA_SECRET`, then replies `{ token, result }` |
| Transaction events | `POST /api/v1/webhooks/lithic/events`: verified with `LITHIC_WEBHOOK_SECRET`; stored in `webhook_events` and linked into `processor_events` by transaction token |

## NFC → Lithic flow (`PAYMENT_MODE=lithic_sandbox`)

1. A physical tap reaches the API, and Reclaimed's authorization engine checks the card and mock funds, then places a hold.
2. The processor calls `simulateAuthorization` for the mapped Lithic Sandbox card.
3. Lithic calls our ASA responder (if enrolled). It sees the `AUTHORIZATION_PENDING` Reclaimed transaction with a placed hold for that card and amount, and answers `APPROVED`. A frozen card gets `CARD_PAUSED`. For simulations started outside Reclaimed it runs the same deterministic card and funds checks.
4. Lithic's decision is read back. A decline releases the hold (`INSUFFICIENT_FUNDS` is fallback-eligible).
5. Capture, reverse and refund map to clearing, void and return simulations.

The generic NFC card stores **no** Lithic credential, and the ACR1252U is not a certified acceptance device. This is a physical NFC event attached to a sandbox simulation.

## Setup

```bash
LITHIC_API_KEY=<sandbox key>
LITHIC_ENVIRONMENT=sandbox
PAYMENT_MODE=lithic_sandbox
LITHIC_ASA_SECRET=<from GET /v1/auth_stream/secret after enrolling>
LITHIC_WEBHOOK_SECRET=<event subscription secret>
```

Enroll the ASA responder at a public HTTPS URL that forwards to `/api/v1/webhooks/lithic/asa`, using Lithic's *enroll responder endpoint* API or dashboard.

## Status in this delivery

- Adapter, processor, ASA responder and event webhook are implemented. Tests use a fake network layer but the **real SDK signature verification** (Standard Webhooks HMAC). They cover approval, decline mapping, clearing/return calls, ASA approve/frozen/forged-signature cases, and the not-configured path.
- **Live Lithic Sandbox calls: BLOCKED.** No Lithic API key or ASA secret was available. The mock processor remains the default and works without Lithic.
