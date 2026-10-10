# NFC hardware — ACS ACR1252U

> **Combined doc.** The first part is from `proj-w/oGuiFE` (`apps/hardware-bridge`). The second
> part, [Reader program (`reader/`)](#reader-program-reader), is from the `Hardware` branch.
> Statements that disagree are marked **⚠ CONTRADICTION** and listed in
> [Contradictions to resolve](#contradictions-to-resolve). Nothing has been resolved yet.

Driver page: https://www.acs.com.hk/en/driver/342/acr1252u-usb-nfc-reader-iii-nfc-forum-certified-reader/

## Compatibility (verified on the target Mac, 2026-10-10)

| Item | Finding |
|---|---|
| macOS driver | Apple's bundled CCID driver (`/usr/libexec/SmartCardServices/drivers/ifd-ccid.bundle`) lists **ACS ACR1252 Dual Reader** (072F:223B) and **ACS ACR1252 Reader** (072F:223E). The ACS vendor driver is optional |
| Node binding | **`pcsc-mini` 0.1.3**: N-API with prebuilt `macos-aarch64` binaries, no node-gyp. It loads on Node 22.20 / arm64 and connects to the macOS PC/SC service. **⚠ CONTRADICTION C1, C2** |
| Alternative evaluated | `nfc-pcsc` 0.8.1 / `@pokusew/pcsclite` 0.6.0 also compiled and loaded, but they are unmaintained since 2022 and need node-gyp. Not used. **⚠ CONTRADICTION C1** |
| Reader slots | The ACR1252U exposes a **PICC** (contactless) slot and a **SAM** slot. The bridge filters `ACR1252.*PICC` (`NFC_READER_FILTER`) |
| UID read | PC/SC Part 3 pseudo-APDU `FF CA 00 00 00` (GET DATA) |
| Card type | Parsed from the PC/SC Part 3 ATR (`3B 8F 80 01 80 4F 0C A0 00 00 03 06 SS NN NN …`): MIFARE Classic 1K/4K, Ultralight/NTAG, Mini, Plus, FeliCa; ISO 14443-4 otherwise |

Physical card-level behaviour has **not** been verified yet; see [hardware-test-results.md](hardware-test-results.md). **⚠ CONTRADICTION C3**

## Bridge behaviour (`apps/hardware-bridge`)

- **Discovery and recovery.** `pcsc-mini` emits a `reader` event on connect and reconnect. `disconnect` is reported to the API. PC/SC service errors restart monitoring after 2 s.
- **Presentation tracking.** A card is "presented" on the `PRESENT` flag's rising edge and removed when it falls. Each presentation gets one UUID `tapId` and sends exactly **one** tap event. The card must be removed before it can tap again.
- **Unsupported cards.** If GET DATA fails, the bridge reports `READER_ERROR` with `NFC_CARD_UNSUPPORTED` and sends no tap.
- **Backend calls.** Requests are HMAC-SHA256 signed (`timestamp.method.path.body`, 5-minute skew window) with retries and exponential backoff. Retries reuse the same `tapId`, and the API deduplicates on it. A heartbeat every 10 s drives "bridge online". **⚠ CONTRADICTION C5**
- **No payment from detection alone.** The API only completes an existing pending checkout. Otherwise it returns `NO_PENDING_CHECKOUT` or `UNKNOWN_CARD`.
- **Privacy.** The bridge logs only masked UIDs. The API stores `HMAC(pepper, UID)` plus the last 4 hex characters and never the raw UID. **⚠ CONTRADICTION C6**

## Commands

**⚠ CONTRADICTION C4:** `reader/` defines the same three root command names.

| Command | Description |
|---|---|
| `npm run dev:hardware` | Run the bridge (needs `HARDWARE_BRIDGE_SECRET`, `BRIDGE_API_URL`) |
| `npm run hardware:diagnose [-- <seconds>]` | Reader model, USB/PCSC status, driver status, card presence, type, ATR, UID, scan time, removal, errors. Writes JSON to `.hardware-test-results/` |
| `npm run hardware:test` | Guided physical tests 1–10. Writes `docs/hardware-test-results.md` **⚠ CONTRADICTION C7** |

## Enrollment

The app calls `POST /reclaimed-cards/test-enroll` (development or `HARDWARE_TEST_MODE` only), which opens a 60-second session. The next tap on that reader creates a `reclaimed_cards` row (`ACTIVE`, display ID `RC-XXXX-XXXX`). A UID can belong to only one live card.

Card states: `UNREGISTERED`, `ACTIVE`, `FROZEN`, `DISABLED`, `REVOKED`. Every state except `ACTIVE` fails authorization.

## Security caveats

Generic NFC UIDs are static and can be cloned. They are **development identities only** and must never authorize real money. Reclaimed does not read, clone or emulate EMV credentials.

---

## Reader program (`reader/`)

*From the `Hardware` branch.*

NFC reader setup for the store laptop. The reader program lives in `reader/` and only reads card
UIDs. It never writes to cards.

### Setup

| Item | Value |
|---|---|
| Reader | ACS ACR1252U USB NFC Reader III (USB-A, through a USB-C hub) |
| USB IDs | Vendor `0x072f`, product `0x223b` |
| Machine | Apple Silicon (arm64), macOS 26.6.2 (25G83) **⚠ CONTRADICTION C8** |
| Node | 24.14.0 (pinned in `.nvmrc`) **⚠ CONTRADICTION C2** |
| Library | `nfc-pcsc` 0.8.1; native `@pokusew/pcsclite` built cleanly on Node 24 **⚠ CONTRADICTION C1** |
| PC/SC driver | macOS built-in `fr.apdu.ccid.smartcardccid:1.5.1` |

### First read results

Tested 2026-10-10 with `npm run first-read` in `reader/`, on the real reader.

**Driver fix:** none needed. macOS listed the reader in both USB and Smart Cards, so the
`defaults write` change to the older CCID driver was not applied.

**Reader names** (exact, as PC/SC reports them):

| Name | Used |
|---|---|
| `ACS ACR1252 Dual Reader PICC` | Yes. Contactless; matched by the `PICC` filter |
| `ACS ACR1252 Dual Reader SAM` | No. SAM slot; ignored |

Do not call `close()` on the ignored SAM reader: PC/SC then re-announces it every second.
Leave it open with a no-op `error` listener.

**Cards:** **⚠ CONTRADICTION C6** (full UIDs below)

| Card | UID | Reads | ATR |
|---|---|---|---|
| A | `049315A93F0289` | 3 taps, identical all 3 times | `3B8F8001804F0CA0000003060300030000000068` |
| B | `04A397A23F0289` | 1 tap | same as A |

Both UIDs are 7 bytes, already in `TapEvent.cardId` format (uppercase hex, no separators).
Each tap was followed by a removal event.

**ATR decoded** (PC/SC Part 3 contactless ATR, same for both cards):

| Bytes | Meaning |
|---|---|
| `3B 8F 80 01 80 4F 0C` | Header; 12 historical bytes follow |
| `A0 00 00 03 06` | RID: PC/SC Workgroup |
| `03` | Standard: ISO 14443 A, part 3 |
| `00 03` | Card name: MIFARE Ultralight family |
| `00 00 00 00` | Reserved |
| `68` | Checksum |

Card type: NXP NTAG21x or MIFARE Ultralight. The reader reports both as `0003`, and the UID
prefix `04` is NXP's manufacturer code. The exact model (NTAG213/215/216) would need a
GET_VERSION command, which we don't need. ISO 14443-3, so `nfc-pcsc` reads the UID directly
and the dummy AID is never used.

**Unplug and replug:**

| Step | Result |
|---|---|
| Unplug | Logged `reader disconnected: ACS ACR1252 Dual Reader PICC`; process kept running |
| Replug (12 s later) | Both readers re-announced; PICC listening again, SAM ignored again |
| Tap after replug | Card A read as `049315A93F0289` (same UID as before), then removal logged |

---

## Contradictions to resolve

| # | Topic | `apps/hardware-bridge` (proj-w/oGuiFE) | `reader/` (Hardware) |
|---|---|---|---|
| C1 | PC/SC library | `pcsc-mini` 0.1.3; says `nfc-pcsc` is "Not used" | Uses `nfc-pcsc` 0.8.1 |
| C2 | Node version | Node 22.20; root `engines` is `>=22.12.0` | Node 24.14.0 pinned in `.nvmrc`; `reader/package.json` requires `>=24`. `.nvmrc` was not copied to this branch |
| C3 | Physical verification | "has **not** been verified yet" | Tests 1–6 PASS on the real reader (see [hardware-test-results.md](hardware-test-results.md)) |
| C4 | Root commands | `dev:hardware`, `hardware:diagnose`, `hardware:test` run `apps/hardware-bridge` | Same three names run `reader/` |
| C5 | Backend call | HMAC-signed POST to `http://localhost:4000/api/v1/hardware/tap-events` | Unsigned POST to `BACKEND_URL` + `TAP_PATH` (default `/hardware/taps`); tests 7–10 used `http://localhost:3000` |
| C6 | UID privacy | Bridge logs only masked UIDs; API never stores the raw UID | Logs and this doc show full UIDs |
| C7 | Test results file | `hardware:test` rewrites `docs/hardware-test-results.md` | `reader/`'s `hardware-test` also rewrites `docs/hardware-test-results.md`. Either runner overwrites this combined file |
| C8 | macOS version | "macOS 25.6" (in hardware-test-results.md) | macOS 26.6.2 (25G83). Build 25G83 is Darwin 25, so these may be the same machine |
