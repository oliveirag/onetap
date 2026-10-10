# Reclaimed — Physical Hardware Test Results

**Status: physical tests BLOCKED.** No ACS ACR1252U was connected to the development Mac when this document was written (2026-10-10).

This file is **regenerated automatically** by `npm run hardware:test`. That runner records only real PC/SC events from the reader and live API responses. It never uses mocks. Run it with the reader and cards in hand to replace the BLOCKED rows below with real results.

## What *was* verified on this Mac (real, no mocks)

`npm run hardware:diagnose` was run on the target machine (Apple Silicon MacBook, macOS 25.6, Node 22.20, arm64). The evidence file is `.hardware-test-results/diagnose-1791616598103.json`.

| Check | Result |
|---|---|
| PC/SC binding (`pcsc-mini` 0.1.3, prebuilt `macos-aarch64`) loads on Node 22 / arm64 | ✅ loaded, monitoring thread started |
| macOS PC/SC service (CryptoTokenKit) reachable | ✅ `connected` |
| Apple's bundled CCID driver (`/usr/libexec/SmartCardServices/drivers/ifd-ccid.bundle`) lists the ACR1252 | ✅ "ACS ACR1252 Dual Reader" (VID 0x072F / PID 0x223B) and "ACS ACR1252 Reader" (0x072F / 0x223E). No vendor driver required |
| ACS USB device enumerated | ⛔ not present (reader not plugged in) |
| PC/SC readers | ⛔ none |
| Hardware errors | none |

## Required physical tests

| # | Test | Expected | Actual | Status |
|---|------|----------|--------|--------|
| 1 | Reader detection | ACR1252U discovered over USB and PC/SC (PICC slot) | Reader not connected to the dev machine | **BLOCKED** |
| 2 | NFC scan | Card detected, type identified from the ATR, UID read via GET DATA | No reader | **BLOCKED** |
| 3 | Card removal | Removal event for the same presentation | No reader | **BLOCKED** |
| 4 | Repeated taps | One event per continuous presentation | No reader | **BLOCKED** |
| 5 | Multiple cards | Distinct identifiers for two cards | No reader | **BLOCKED** |
| 6 | Disconnection | Bridge survives unplug and recovers on replug | No reader | **BLOCKED** |
| 7 | Backend communication | Signed tap accepted by backend | No physical tap possible | **BLOCKED** |
| 8 | Payment simulation | Tap during pending checkout produces a simulated authorization | No physical tap possible | **BLOCKED** |
| 9 | Frozen card | CARD_FROZEN decline | No physical tap possible | **BLOCKED** |
| 10 | Refund | Capture and refund the approved transaction | Depends on test 8 | **BLOCKED** |

## Related evidence that is NOT physical hardware evidence

These items show that the software path behind the reader works. They do **not** count as hardware testing:

- **Mock-driver unit tests:** 11 tests in `apps/hardware-bridge/test` cover detection, removal, repeated presentations, two cards, unsupported cards, disconnect/reconnect, backend outages, HMAC signing and retries.
- **API integration tests:** 42+ tests in `apps/api/test` send HMAC-signed tap events through the real routing, enrollment, authorization, capture, settlement and refund code paths.
- **`npm run smoke` against a live local Supabase stack:** passed 18/18. It used software-simulated signed taps from a reader explicitly named "SIMULATED smoke-test reader (not hardware)". It verified enrollment, the $100 Walmart approval on Mock Citi (36 ms), capture, settlement, partial refund, balanced ledger, realtime push, frozen-card decline and fallback to Mock Chase.

## How to complete physical verification

1. Plug the ACR1252U into the Mac (USB-A, or USB-A→C adapter).
2. Run `npm run hardware:diagnose -- 30` and tap a card when prompted.
3. In separate terminals, run `npm run db:start` (if not running), `npm run dev:api`, the mobile app, and enroll a card. Then run Demo funding setup on the Reclaimed Card screen.
4. Run `npm run hardware:test` and follow the prompts. This file is rewritten with PASS/FAIL/BLOCKED and evidence.

## Known hardware considerations to watch during the physical run

- **NTAG / Ultralight vs MIFARE Classic:** both report a UID via `FF CA 00 00 00`. Some ISO 14443-4 cards with random UIDs (privacy mode) give a different UID on each tap, so they cannot be enrolled reliably.
- **Hold time / RF flicker:** the bridge emits one event per presence transition. The API also ignores re-detections of the same UID on the same reader within `TAP_DEBOUNCE_MS` (1.5 s).
- **Sleep/wake:** if the PC/SC service drops, the driver restarts monitoring with a 2 s backoff.
