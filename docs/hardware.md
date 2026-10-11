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

`reader/` uses its own root commands: `npm run dev:reader`, `npm run reader:diagnose`, `npm run reader:test`,
and `npm run demo:hardware` (see [Demo day](#demo-day)).

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

## Demo day

### 1. Plug in

1. Plug the ACR1252U into the Mac (directly or through the USB-C hub). Its LED lights up.
2. Start the backend in its own terminal and leave it running: `npm run dev:api`.
3. Optional: start the terminal page with `npm run dev:terminal`, then open http://localhost:5173.

### 2. Run the bridge

From the repo root, in its own terminal window:

```sh
npm run demo:hardware
```

This command:

- checks that macOS sees the reader's PICC slot, and stops with a clear error if not
- checks the backend's `/health`, and stops with a clear error if it is down
- runs `caffeinate -dimsu` so the Mac, display and disk don't sleep
- starts the bridge with `TAP_OUTPUT=both`, so taps go to the store page (WebSocket) and the backend
- restarts the bridge 2 s after a crash and logs `bridge exited (…) — restarting in 2s`
- stops the bridge and caffeinate on **Ctrl+C**

Settings come from `reader/.env`. `TAP_OUTPUT` is always forced to `both`, and the terminal ID comes from
`TEST_TERMINAL_ID` in the root `.env`.

### 3. Check the banner

A healthy start looks like this:

```
────────────────────────────────────────────────────────
  Reclaimed hardware demo
────────────────────────────────────────────────────────
  Reader       ACS ACR1252 Dual Reader PICC
  Terminal ID  TERM-DEV-001
  Backend      http://localhost:4000  (healthy)
  Output       both  (store page ws://127.0.0.1:8787 + backend)
  Demo card    049315A93F0289
  Bridge ID    bridge-macbook

  Press f for fake tap · Ctrl+C to stop
────────────────────────────────────────────────────────

[demo 21:36:43] caffeinate -dimsu running (pid 76234)
[demo 21:36:43] bridge started (pid 76235)
```

Then wait for the `bridge_ready` and `reader_connected` log lines. A tap logs `tap_sent` with the
backend's outcome.

If it stops with an error instead:

| Message | Fix |
|---|---|
| `NFC reader not detected` | Replug the reader, wait 3 s, run again |
| `Backend at … is not reachable` | Start the API: `npm run dev:api` |
| `The reader is already in use by …` | Another bridge or `reader:diagnose` is running. Ctrl+C it first |
| `reader/.env is invalid` | Fix the named variable (see `reader/.env.example`) |

### 4. If the reader dies mid-demo

**Press `f`** in the bridge window. This sends a fake tap of `DEMO_CARD_UID` (card A) through the same path
as a real tap, so the checkout completes as normal. Keep going and fix the hardware afterwards.

- Unplugging and replugging the reader is picked up automatically, with no restart needed.
- If the bridge process itself crashes, it restarts within 2 s.
- `f` needs `DEMO_CARD_UID` set to the **enrolled** card's UID, or the fake tap is declined as not enrolled.

### 5. If card A is lost or broken

Use the spare, card B. Run the [Swap demo card](#swap-demo-card) command, then set
`DEMO_CARD_UID=04A397A23F0289` in `reader/.env` and restart `npm run demo:hardware` so the fake tap matches.

## Swap demo card

Moves the demo account's enrolled Reclaimed card from card A (`049315A93F0289`) to the spare,
card B (`04A397A23F0289`). The card keeps its ID, owner, status and funding accounts; only the UID
fingerprint changes. **Not run yet.** Run it from the repo root. The card ID is the demo card enrolled 2026-10-10 (`RC-H6ZY-E6PB`, owner `iamtheking3000@gmail.com`); re-check it if the card is ever re-enrolled:

```sh
(set -a; . ./.env; psql "${DATABASE_URL/&uselibpqcompat=true/}" -v ON_ERROR_STOP=1 -v pepper="$NFC_UID_PEPPER" -v card_id="2143ea9b-eaf0-4a3c-9cc3-943615f37464") <<'SQL'
update public.reclaimed_cards
   set uid_fingerprint = encode(extensions.hmac('04A397A23F0289', :'pepper', 'sha256'), 'hex'),
       uid_masked      = '••••0289'
 where id = :'card_id' and status <> 'REVOKED';
SQL
```

- The fingerprint must match the API's `uidFingerprint` (`apps/api/src/lib/crypto.ts`): hex HMAC-SHA256 of
  the uppercase UID, keyed with `NFC_UID_PEPPER`. If the API runs with a different pepper (for example a
  deployed backend), use that one, or the card will show as `UNKNOWN_CARD`.
- Both cards end in `0289`, so the masked UID (`••••0289`) is the same before and after the swap.
- Afterwards set `DEMO_CARD_UID=04A397A23F0289` in `reader/.env` so the fake tap matches.
- `${DATABASE_URL/&uselibpqcompat=true/}` drops a node-postgres-only URL parameter that `psql` rejects
  (`invalid URI query parameter`).
- Uses Supabase's `pgcrypto` in the `extensions` schema. Expect `UPDATE 1`; `UPDATE 0` means the ID is wrong
  or the card is revoked.

---

## Contradictions to resolve

| # | Topic | `apps/hardware-bridge` (proj-w/oGuiFE) | `reader/` (Hardware) |
|---|---|---|---|
| C1 | PC/SC library | `pcsc-mini` 0.1.3; says `nfc-pcsc` is "Not used" | Uses `nfc-pcsc` 0.8.1 |
| C2 | Node version | Node 22.20; root `engines` is `>=22.12.0` | Node 24.14.0 pinned in `.nvmrc`; `reader/package.json` requires `>=24`. `.nvmrc` was not copied to this branch |
| C3 | Physical verification | "has **not** been verified yet" | Tests 1–6 PASS on the real reader (see [hardware-test-results.md](hardware-test-results.md)) |
| C4 | Root commands | `dev:hardware`, `hardware:diagnose`, `hardware:test` run `apps/hardware-bridge` | **Resolved:** `reader/` now runs as `dev:reader`, `reader:diagnose`, `reader:test` |
| C5 | Backend call | HMAC-signed POST to `http://localhost:4000/api/v1/hardware/tap-events` | **Resolved:** `reader/` now signs with the shared `signRequest` and POSTs to `BRIDGE_API_URL` + `/api/v1/hardware/tap-events` |
| C6 | UID privacy | Bridge logs only masked UIDs; API never stores the raw UID | Logs and this doc show full UIDs |
| C7 | Test results file | `hardware:test` rewrites `docs/hardware-test-results.md` | `reader/`'s `hardware-test` also rewrites `docs/hardware-test-results.md`. Either runner overwrites this combined file |
| C8 | macOS version | "macOS 25.6" (in hardware-test-results.md) | macOS 26.6.2 (25G83). Build 25G83 is Darwin 25, so these may be the same machine |
