# Hardware

NFC reader setup for the store laptop. The reader program lives in `reader/` and only reads card
UIDs. It never writes to cards.

## Setup

| Item | Value |
|---|---|
| Reader | ACS ACR1252U USB NFC Reader III (USB-A, through a USB-C hub) |
| USB IDs | Vendor `0x072f`, product `0x223b` |
| Machine | Apple Silicon (arm64), macOS 26.6.2 (25G83) |
| Node | 24.14.0 (pinned in `.nvmrc`) |
| Library | `nfc-pcsc` 0.8.1; native `@pokusew/pcsclite` built cleanly on Node 24 |
| PC/SC driver | macOS built-in `fr.apdu.ccid.smartcardccid:1.5.1` |

## First read results

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

**Cards:**

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
