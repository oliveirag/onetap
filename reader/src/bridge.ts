import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { CardType } from "./atr.ts";
import type { Config } from "./config.ts";
import { TapGate } from "./gate.ts";
import { PICC_READER_NAME, type CardHandlers } from "./pcsc.ts";
import type { BridgeTapEvent, TapSink, TapSource } from "./tap.ts";

export interface BridgeDeps {
  config: Pick<Config, "bridgeId" | "debounceMs" | "demoCardUid">;
  sinks: TapSink[];
  log: Logger;
  now?: () => number;
}

// Turns card detections (real or fake) into tap events and hands them to every sink.
// It only reports taps; it never decides that a tap is a payment.
export function createBridge({ config, sinks, log, now = Date.now }: BridgeDeps) {
  const gate = new TapGate(config.debounceMs);
  const pending = new Set<Promise<void>>();

  // Single path for every tap, real or fake.
  function handleTap(cardId: string, cardType: CardType, readerName: string, source: TapSource) {
    const at = now();
    const result = gate.detected(cardId, at, source === "nfc");
    if (!result.tap) {
      log.info({ cardId, source, reason: result.reason, sinceMs: result.sinceMs }, "duplicate_ignored");
      return;
    }

    const tap: BridgeTapEvent = {
      tapId: randomUUID(),
      uid: cardId,
      cardType,
      bridgeId: config.bridgeId,
      readerName,
      presentedAt: new Date(at).toISOString(),
      source,
    };
    log.info({ tap }, "tap");

    for (const sink of sinks) {
      const p = sink
        .send(tap)
        .catch((err) => log.error({ tapId: tap.tapId, output: sink.name, reason: (err as Error).message }, "tap_failed"))
        .finally(() => pending.delete(p));
      pending.add(p);
    }
  }

  // Wire these into startPcsc.
  const cardHandlers: CardHandlers = {
    onCard: (uid, cardType, readerName) => handleTap(uid, cardType, readerName, "nfc"),
    onRemoved: (uid) => gate.removed(uid, now()),
    onReaderGone: () => gate.clearPresent(now()),
  };

  function fakeTap() {
    if (!config.demoCardUid) {
      log.warn("fake_tap_unavailable_set_DEMO_CARD_UID");
      return;
    }
    // Same reader name as a real tap, so the backend routes it to the same reader (and its checkouts).
    handleTap(config.demoCardUid, "fake", PICC_READER_NAME, "fake_tap");
  }

  // Waits for in-flight sends (and their retries). Resolves false if they don't finish in time.
  async function flush(timeoutMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const flushed = await Promise.race([
      Promise.allSettled([...pending]).then(() => true),
      new Promise<boolean>((r) => (timer = setTimeout(() => r(false), timeoutMs))),
    ]);
    clearTimeout(timer);
    if (!flushed) log.warn({ abandoned: pending.size }, "flush_timeout");
    return flushed;
  }

  return { cardHandlers, fakeTap, flush, pendingCount: () => pending.size };
}
