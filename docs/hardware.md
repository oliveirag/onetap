# NFC hardware — ACS ACR1252U

Driver page: https://www.acs.com.hk/en/driver/342/acr1252u-usb-nfc-reader-iii-nfc-forum-certified-reader/

## Compatibility (verified on the target Mac, 2026-10-10)

| Item | Finding |
|---|---|
| macOS driver | Apple's bundled CCID driver (`/usr/libexec/SmartCardServices/drivers/ifd-ccid.bundle`) lists **ACS ACR1252 Dual Reader** (072F:223B) and **ACS ACR1252 Reader** (072F:223E). The ACS vendor driver is optional |
| Node binding | **`pcsc-mini` 0.1.3**: N-API with prebuilt `macos-aarch64` binaries, no node-gyp. It loads on Node 22.20 / arm64 and connects to the macOS PC/SC service |
| Alternative evaluated | `nfc-pcsc` 0.8.1 / `@pokusew/pcsclite` 0.6.0 also compiled and loaded, but they are unmaintained since 2022 and need node-gyp. Not used |
| Reader slots | The ACR1252U exposes a **PICC** (contactless) slot and a **SAM** slot. The bridge filters `ACR1252.*PICC` (`NFC_READER_FILTER`) |
| UID read | PC/SC Part 3 pseudo-APDU `FF CA 00 00 00` (GET DATA) |
| Card type | Parsed from the PC/SC Part 3 ATR (`3B 8F 80 01 80 4F 0C A0 00 00 03 06 SS NN NN …`): MIFARE Classic 1K/4K, Ultralight/NTAG, Mini, Plus, FeliCa; ISO 14443-4 otherwise |

Physical card-level behaviour has **not** been verified yet; see [hardware-test-results.md](hardware-test-results.md).

## Bridge behaviour (`apps/hardware-bridge`)

- **Discovery and recovery.** `pcsc-mini` emits a `reader` event on connect and reconnect. `disconnect` is reported to the API. PC/SC service errors restart monitoring after 2 s.
- **Presentation tracking.** A card is "presented" on the `PRESENT` flag's rising edge and removed when it falls. Each presentation gets one UUID `tapId` and sends exactly **one** tap event. The card must be removed before it can tap again.
- **Unsupported cards.** If GET DATA fails, the bridge reports `READER_ERROR` with `NFC_CARD_UNSUPPORTED` and sends no tap.
- **Backend calls.** Requests are HMAC-SHA256 signed (`timestamp.method.path.body`, 5-minute skew window) with retries and exponential backoff. Retries reuse the same `tapId`, and the API deduplicates on it. A heartbeat every 10 s drives "bridge online".
- **No payment from detection alone.** The API only completes an existing pending checkout. Otherwise it returns `NO_PENDING_CHECKOUT` or `UNKNOWN_CARD`.
- **Privacy.** The bridge logs only masked UIDs. The API stores `HMAC(pepper, UID)` plus the last 4 hex characters and never the raw UID.

## Commands

| Command | Description |
|---|---|
| `npm run dev:hardware` | Run the bridge (needs `HARDWARE_BRIDGE_SECRET`, `BRIDGE_API_URL`) |
| `npm run hardware:diagnose [-- <seconds>]` | Reader model, USB/PCSC status, driver status, card presence, type, ATR, UID, scan time, removal, errors. Writes JSON to `.hardware-test-results/` |
| `npm run hardware:test` | Guided physical tests 1–10. Writes `docs/hardware-test-results.md` |

## Enrollment

The app calls `POST /reclaimed-cards/test-enroll` (development or `HARDWARE_TEST_MODE` only), which opens a 60-second session. The next tap on that reader creates a `reclaimed_cards` row (`ACTIVE`, display ID `RC-XXXX-XXXX`). A UID can belong to only one live card.

Card states: `UNREGISTERED`, `ACTIVE`, `FROZEN`, `DISABLED`, `REVOKED`. Every state except `ACTIVE` fails authorization.

## Security caveats

Generic NFC UIDs are static and can be cloned. They are **development identities only** and must never authorize real money. Reclaimed does not read, clone or emulate EMV credentials.
