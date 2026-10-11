import { NFC, type Reader } from "nfc-pcsc";
import type { Logger } from "pino";
import { normalizeUid } from "@shared/nfc.ts";
import { decodeCardType, type CardType } from "./atr.ts";

// The contactless interface of the ACS ACR1252U, as recorded in docs/hardware.md.
// The same device also exposes "ACS ACR1252 Dual Reader SAM", which is ignored.
export const PICC_READER_NAME = "ACS ACR1252 Dual Reader PICC";

// PC/SC GET DATA: returns the UID of the card in the field. Read-only; works for ISO 14443-3 and -4.
const GET_UID = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);
const RESTART_DELAY_MS = 2000;
const DISCONNECT_WAIT_MS = 1000;

// PC/SC can append a suffix like " 01" when two identical readers are connected.
export const isPiccReader = (name: string) => name === PICC_READER_NAME || name.startsWith(`${PICC_READER_NAME} `);

export interface CardDetails {
  atr: string | null; // uppercase hex
  readMs: number;     // card connected -> UID read (GET DATA round trip)
}

export interface CardHandlers {
  onCard(uid: string, cardType: CardType, readerName: string, details: CardDetails): void;
  onRemoved(uid: string, readerName: string): void;
  onReaderGone(readerName: string): void;
  onReaderSeen?(readerName: string, used: boolean): void;
}

// Watches PC/SC for the PICC reader. Replugging is picked up automatically: PC/SC announces the reader
// again and it gets fresh handlers. If the PC/SC context itself fails, it is recreated after a delay.
export function startPcsc(log: Logger, handlers: CardHandlers) {
  let nfc: NFC | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  const active = new Set<Reader>();

  function attach(reader: Reader) {
    handlers.onReaderSeen?.(reader.name, isPiccReader(reader.name));
    if (!isPiccReader(reader.name)) {
      log.debug({ readerName: reader.name }, "reader_ignored");
      // Left open but unused: closing it makes PC/SC re-announce it every second.
      // The listener stops an "error" event from crashing the process.
      reader.on("error", () => {});
      return;
    }

    active.add(reader);
    reader.autoProcessing = false; // we read the UID ourselves, so no AID select ever runs
    let currentUid: string | null = null;
    log.info({ readerName: reader.name }, "reader_connected");

    reader.on("card", async (card) => {
      const startedAt = performance.now();
      const cardType = decodeCardType(card.atr);
      let uid: string;
      try {
        const response = await reader.transmit(GET_UID, 12);
        const status = response.length >= 2 ? response.readUInt16BE(response.length - 2) : 0;
        if (status !== 0x9000) throw new Error(`GET DATA status 0x${status.toString(16)}`);
        uid = normalizeUid(response.subarray(0, -2));
      } catch (err) {
        log.warn({ readerName: reader.name, cardType, err: (err as Error).message }, "card_read_failed");
        return;
      }
      currentUid = uid;
      const details: CardDetails = {
        atr: card.atr?.toString("hex").toUpperCase() ?? null,
        readMs: Math.round((performance.now() - startedAt) * 10) / 10,
      };
      log.info({ readerName: reader.name, cardId: uid, cardType, ...details }, "card_detected");
      handlers.onCard(uid, cardType, reader.name, details);
    });

    reader.on("card.off", () => {
      if (!currentUid) return;
      log.info({ readerName: reader.name, cardId: currentUid }, "card_removed");
      handlers.onRemoved(currentUid, reader.name);
      currentUid = null;
    });

    reader.on("error", (err) => log.warn({ readerName: reader.name, err: err.message }, "reader_error"));

    reader.on("end", () => {
      active.delete(reader);
      if (stopped) return; // we closed it during shutdown; not an unplug
      log.warn({ readerName: reader.name }, "reader_disconnected");
      handlers.onReaderGone(reader.name);
    });
  }

  function start() {
    restartTimer = null;
    if (stopped) return;
    nfc = new NFC();
    nfc.on("reader", attach);
    nfc.on("error", (err) => {
      log.error({ err: err.message }, "pcsc_error");
      scheduleRestart();
    });
  }

  function scheduleRestart() {
    if (stopped || restartTimer) return;
    try {
      nfc?.close();
    } catch {}
    nfc = null;
    active.clear();
    log.warn({ inMs: RESTART_DELAY_MS }, "pcsc_restarting");
    restartTimer = setTimeout(start, RESTART_DELAY_MS);
  }

  start();

  return {
    // Closing a reader while nfc-pcsc's async card disconnect is still running aborts the process
    // (SIGABRT in @pokusew/pcsclite). That happens when stop() follows a card removal within a few ms,
    // so wait for in-flight disconnects first.
    async stop() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      const deadline = Date.now() + DISCONNECT_WAIT_MS;
      while ([...active].some((r) => r.connection) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      for (const reader of active) {
        if (reader.connection) log.warn({ readerName: reader.name }, "closing_while_connected");
        try {
          reader.close();
        } catch {}
      }
      active.clear();
      try {
        nfc?.close();
      } catch {}
    },
  };
}
