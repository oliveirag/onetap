# Reclaimed — Physical Hardware Test Results

> **Combined doc.** The first part is from `proj-w/oGuiFE` (`apps/hardware-bridge`; no reader was
> connected). The second part, [Physical test run with `reader/`](#physical-test-run-with-reader-2026-10-10),
> is from the `Hardware` branch and was run on the real reader. Conflicts are marked **⚠ CONTRADICTION**;
> the C numbers match the table in [hardware.md](hardware.md#contradictions-to-resolve).
>
> **⚠ CONTRADICTION C7:** both `npm run hardware:test` runners rewrite this whole file. Running either one replaces this combined version.

**Status: physical tests BLOCKED.** No ACS ACR1252U was connected to the development Mac when this document was written (2026-10-10). **⚠ CONTRADICTION C3:** the `reader/` run below has tests 1–6 PASS on a connected ACR1252U.

This file is **regenerated automatically** by `npm run hardware:test`. That runner records only real PC/SC events from the reader and live API responses. It never uses mocks. Run it with the reader and cards in hand to replace the BLOCKED rows below with real results.

## What *was* verified on this Mac (real, no mocks)

`npm run hardware:diagnose` was run on the target machine (Apple Silicon MacBook, macOS 25.6, Node 22.20, arm64) **⚠ CONTRADICTION C2, C8**. The evidence file is `.hardware-test-results/diagnose-1791616598103.json`.

| Check | Result |
|---|---|
| PC/SC binding (`pcsc-mini` 0.1.3, prebuilt `macos-aarch64`) loads on Node 22 / arm64 | ✅ loaded, monitoring thread started |
| macOS PC/SC service (CryptoTokenKit) reachable | ✅ `connected` |
| Apple's bundled CCID driver (`/usr/libexec/SmartCardServices/drivers/ifd-ccid.bundle`) lists the ACR1252 | ✅ "ACS ACR1252 Dual Reader" (VID 0x072F / PID 0x223B) and "ACS ACR1252 Reader" (0x072F / 0x223E). No vendor driver required |
| ACS USB device enumerated | ⛔ not present (reader not plugged in) |
| PC/SC readers | ⛔ none |
| Hardware errors | none |

## Required physical tests

**⚠ CONTRADICTION C3:** rows 1–6 below are PASS in the `reader/` run further down; rows 7–10 are BLOCKED in both.

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

---

## Physical test run with `reader/` (2026-10-10)

*From the `Hardware` branch. Original title: "Hardware test results".*

**⚠ CONTRADICTION C5:** tests 7–10 targeted `http://localhost:3000`; the `proj-w/oGuiFE` API listens on `:4000` under `/api/v1`.

Generated by `npm run hardware:test`. Each status was chosen by the person running the test after
seeing the evidence; the runner never marks a test PASS on its own. Evidence lines are real events
from the reader (UTC time of day, event, fields).

| | |
|---|---|
| Date | 2026-10-10T19:07:36.888Z |
| macOS | 26.6.2 (25G83) |
| Node | v24.14.0 |
| Reader | ACS ACR1252 Dual Reader PICC |
| Debounce window | 1500 ms |

### Summary

| # | Test | Status |
|---|---|---|
| 1 | Reader detection | PASS |
| 2 | NFC scan | PASS |
| 3 | Card removal | PASS |
| 4 | Repeated taps | PASS |
| 5 | Multiple cards | PASS |
| 6 | Disconnection | PASS |
| 7 | Backend communication | BLOCKED |
| 8 | Payment simulation | BLOCKED |
| 9 | Frozen card | BLOCKED |
| 10 | Refund | BLOCKED |

### 1. Reader detection

**Status:** PASS

**Expected:** PC/SC lists "ACS ACR1252 Dual Reader PICC" (used) and the SAM slot (ignored); reader_connected logged once for the PICC

**Actual:** Readers: ACS ACR1252 Dual Reader SAM (ignored), ACS ACR1252 Dual Reader PICC (used)

**Evidence:**

```
19:07:35.380  reader_ignored     ACS ACR1252 Dual Reader SAM
19:07:35.380  reader_connected   ACS ACR1252 Dual Reader PICC
```

**Remaining issues:** None

### 2. NFC scan

**Status:** PASS

**Expected:** One card_detected with a 14-character uppercase hex UID, card type and ATR; exactly one tap

**Actual:** 1 detection(s), 1 tap(s): 049315A93F0289 (ntag_or_ultralight)

**Evidence:**

```
19:08:52.138  card_detected      cardId=049315A93F0289 cardType=ntag_or_ultralight atr=3B8F8001804F0CA0000003060300030000000068 readMs=1.8
19:08:52.139  tap                cardId=049315A93F0289 tapId=29f39550 source=nfc
19:08:53.364  card_removed       cardId=049315A93F0289
```

**Remaining issues:** None

### 3. Card removal

**Status:** PASS

**Expected:** card_removed for the same UID, after its card_detected

**Actual:** Detected 049315A93F0289 at 19:09:36.655, removed 049315A93F0289 at 19:09:39.444 (2.8 s held)

**Evidence:**

```
19:09:36.655  card_detected      cardId=049315A93F0289 cardType=ntag_or_ultralight atr=3B8F8001804F0CA0000003060300030000000068 readMs=1.7
19:09:36.655  tap                cardId=049315A93F0289 tapId=af03829f source=nfc
19:09:39.444  card_removed       cardId=049315A93F0289
```

**Remaining issues:** None

### 4. Repeated taps

**Status:** PASS

**Expected:** Holding for 5 s gives one tap; lift and re-tap (more than 1.5 s apart) gives two taps

**Actual:** Part A (hold 5 s): 1 tap(s), 0 duplicate(s) ignored. Part B (lift and re-tap): 2 tap(s)

**Evidence:**

```
19:10:12.194  card_detected      cardId=049315A93F0289 cardType=ntag_or_ultralight atr=3B8F8001804F0CA0000003060300030000000068 readMs=1.6
19:10:12.194  tap                cardId=049315A93F0289 tapId=013f8046 source=nfc
19:10:19.140  card_removed       cardId=049315A93F0289
19:10:25.256  card_detected      cardId=049315A93F0289 cardType=ntag_or_ultralight atr=3B8F8001804F0CA0000003060300030000000068 readMs=1.5
19:10:25.256  tap                cardId=049315A93F0289 tapId=a8ddedcb source=nfc
19:10:28.564  card_removed       cardId=049315A93F0289
19:10:32.075  card_detected      cardId=049315A93F0289 cardType=ntag_or_ultralight atr=3B8F8001804F0CA0000003060300030000000068 readMs=1.6
19:10:32.075  tap                cardId=049315A93F0289 tapId=d88e0e8d source=nfc
19:10:33.564  card_removed       cardId=049315A93F0289
```

**Remaining issues:** None

### 5. Multiple cards

**Status:** PASS

**Expected:** Two taps with two distinct UIDs

**Actual:** 2 tap(s), 2 distinct UID(s): 049315A93F0289, 04A397A23F0289

**Evidence:**

```
19:10:50.075  card_detected      cardId=049315A93F0289 cardType=ntag_or_ultralight atr=3B8F8001804F0CA0000003060300030000000068 readMs=1.6
19:10:50.075  tap                cardId=049315A93F0289 tapId=9a44e4c9 source=nfc
19:10:51.301  card_removed       cardId=049315A93F0289
19:10:54.296  card_detected      cardId=04A397A23F0289 cardType=ntag_or_ultralight atr=3B8F8001804F0CA0000003060300030000000068 readMs=1.5
19:10:54.296  tap                cardId=04A397A23F0289 tapId=a4658049 source=nfc
19:10:55.525  card_removed       cardId=04A397A23F0289
```

**Remaining issues:** None

### 6. Disconnection

**Status:** PASS

**Expected:** reader_disconnected on unplug, reader_connected on replug, then a tap is read without restarting

**Actual:** Disconnected: 19:11:11.121. Reconnected: 19:11:20.153. Taps after replug: 049315A93F0289

**Evidence:**

```
19:11:11.121  reader_disconnected ACS ACR1252 Dual Reader PICC
19:11:20.153  reader_connected   ACS ACR1252 Dual Reader PICC
19:11:20.153  reader_ignored     ACS ACR1252 Dual Reader SAM
19:11:24.442  card_detected      cardId=049315A93F0289 cardType=ntag_or_ultralight atr=3B8F8001804F0CA0000003060300030000000068 readMs=0.8
19:11:24.442  tap                cardId=049315A93F0289 tapId=9c9dac42 source=nfc
19:11:25.674  card_removed       cardId=049315A93F0289
```

**Remaining issues:** None

### 7. Backend communication

**Status:** BLOCKED

**Expected:** A real tap reaches the backend as a signed request and is accepted

**Actual:** Not run: http://localhost:3000 did not respond (ECONNREFUSED)

**Evidence:**

```
(none)
```

**Remaining issues:** Backend not connected

### 8. Payment simulation

**Status:** BLOCKED

**Expected:** A tap at the store page produces an approved Lithic sandbox authorization and a transaction row

**Actual:** Not run: http://localhost:3000 did not respond (ECONNREFUSED)

**Evidence:**

```
(none)
```

**Remaining issues:** Backend not connected

### 9. Frozen card

**Status:** BLOCKED

**Expected:** A tap with the Reclaimed card paused is declined

**Actual:** Not run: http://localhost:3000 did not respond (ECONNREFUSED)

**Evidence:**

```
(none)
```

**Remaining issues:** Backend not connected

### 10. Refund

**Status:** BLOCKED

**Expected:** A refund of the tapped transaction is recorded against the same transaction

**Actual:** Not run: http://localhost:3000 did not respond (ECONNREFUSED)

**Evidence:**

```
(none)
```

**Remaining issues:** Backend not connected
