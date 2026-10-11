import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATR_NTAG, instances, PICC, SAM, settle } from "./helpers/fake-pcsc.ts";
import { captureLog } from "./helpers/log.ts";
import { startPcsc, type CardHandlers } from "../src/pcsc.ts";

vi.mock("nfc-pcsc", () => import("./helpers/fake-pcsc.ts"));

const GET_UID = "ffca000000";
const DETAILS = { atr: ATR_NTAG.toString("hex").toUpperCase(), readMs: expect.any(Number) };

function setup() {
  const handlers = { onCard: vi.fn(), onRemoved: vi.fn(), onReaderGone: vi.fn(), onReaderSeen: vi.fn() } satisfies CardHandlers;
  const logs = captureLog();
  const pcsc = startPcsc(logs.log, handlers);
  return { handlers, logs, pcsc, nfc: instances.at(-1)! };
}

beforeEach(() => {
  instances.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("reader selection", () => {
  it("listens on the PICC reader and ignores the SAM slot completely", async () => {
    const { handlers, logs, nfc } = setup();
    const sam = nfc.plug(SAM);
    const picc = nfc.plug(PICC);

    sam.place("049315A93F0289");
    await settle();
    expect(sam.transmitted).toHaveLength(0);
    expect(handlers.onCard).not.toHaveBeenCalled();
    expect(sam.closed).toBe(false); // closing it makes PC/SC re-announce it every second

    picc.place("049315A93F0289");
    await settle();
    expect(handlers.onCard).toHaveBeenCalledExactlyOnceWith("049315A93F0289", "ntag_or_ultralight", PICC, DETAILS);
    expect(logs.events().filter((e) => e === "reader_connected")).toHaveLength(1);
    expect(handlers.onReaderSeen.mock.calls).toEqual([
      [SAM, false],
      [PICC, true],
    ]);
  });

  it("does not crash when the ignored SAM reader emits an error", () => {
    const { nfc } = setup();
    const sam = nfc.plug(SAM);
    expect(() => sam.emit("error", new Error("boom"))).not.toThrow();
  });

  it("only sends the read-only GET DATA command, never a write or AID select", async () => {
    const { nfc } = setup();
    const picc = nfc.plug(PICC);
    picc.place("049315A93F0289");
    picc.lift();
    picc.place("04A397A23F0289", Buffer.from("3B8180018080", "hex")); // ISO 14443-4 card
    await settle();
    expect(picc.autoProcessing).toBe(false);
    expect(picc.transmitted.map((b) => b.toString("hex"))).toEqual([GET_UID, GET_UID]);
  });
});

describe("card events", () => {
  it("reports removal with the UID that was read", async () => {
    const { handlers, nfc } = setup();
    const picc = nfc.plug(PICC);
    picc.place("04a397a23f0289");
    await settle();
    picc.lift();
    expect(handlers.onRemoved).toHaveBeenCalledExactlyOnceWith("04A397A23F0289", PICC);
  });

  it("an unreadable card produces no tap and a card_read_failed log", async () => {
    const { handlers, logs, nfc } = setup();
    const picc = nfc.plug(PICC);
    picc.placeUnreadable();
    await settle();
    picc.lift();
    expect(handlers.onCard).not.toHaveBeenCalled();
    expect(handlers.onRemoved).not.toHaveBeenCalled();
    expect(logs.events()).toContain("card_read_failed");
  });
});

describe("unplug and replug", () => {
  it("recovers without restarting: a replugged reader gets fresh handlers", async () => {
    const { handlers, logs, nfc } = setup();
    const first = nfc.plug(PICC);
    first.place("049315A93F0289");
    await settle();

    first.unplug();
    expect(handlers.onReaderGone).toHaveBeenCalledExactlyOnceWith(PICC);
    expect(logs.events()).toContain("reader_disconnected");

    // PC/SC announces the device again as a new reader object.
    const second = nfc.plug(PICC);
    second.place("049315A93F0289");
    await settle();
    expect(handlers.onCard).toHaveBeenCalledTimes(2);
    expect(handlers.onCard).toHaveBeenLastCalledWith("049315A93F0289", "ntag_or_ultralight", PICC, DETAILS);
    expect(instances).toHaveLength(1); // same PC/SC context; no restart was needed
  });

  it("a stale removal from the unplugged reader does not leak into the new one", async () => {
    const { handlers, nfc } = setup();
    const first = nfc.plug(PICC);
    first.place("049315A93F0289");
    await settle();
    first.unplug();
    const second = nfc.plug(PICC);
    second.lift(); // nothing was read on this reader
    expect(handlers.onRemoved).not.toHaveBeenCalled();
  });

  it("recreates the PC/SC context after a PC/SC error", async () => {
    vi.useFakeTimers();
    const { handlers, logs, nfc } = setup();
    nfc.plug(PICC);

    nfc.emit("error", new Error("SCardEstablishContext failed"));
    nfc.emit("error", new Error("second error while restarting")); // must not schedule twice
    expect(nfc.closed).toBe(true);
    expect(logs.events()).toContain("pcsc_restarting");

    await vi.advanceTimersByTimeAsync(2000);
    expect(instances).toHaveLength(2);

    const reader = instances[1].plug(PICC);
    reader.place("049315A93F0289");
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.onCard).toHaveBeenCalledOnce();
  });
});

describe("stop", () => {
  it("closes the reader and context, and the close is not reported as an unplug", async () => {
    const { handlers, logs, nfc, pcsc } = setup();
    const picc = nfc.plug(PICC);
    await pcsc.stop();
    expect(picc.closed).toBe(true);
    expect(nfc.closed).toBe(true);
    expect(handlers.onReaderGone).not.toHaveBeenCalled();
    expect(logs.events()).not.toContain("reader_disconnected");
  });

  it("waits for an in-flight card disconnect before closing the reader", async () => {
    vi.useFakeTimers();
    const { nfc, pcsc } = setup();
    const picc = nfc.plug(PICC);
    picc.connection = {}; // card just lifted; nfc-pcsc's async disconnect hasn't finished
    const stopping = pcsc.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(picc.closed).toBe(false);
    picc.connection = null; // disconnect completes
    await vi.advanceTimersByTimeAsync(20);
    await stopping;
    expect(picc.closed).toBe(true);
    expect(nfc.closed).toBe(true);
  });

  it("closes anyway, with a warning, if the disconnect never completes", async () => {
    vi.useFakeTimers();
    const { nfc, pcsc, logs } = setup();
    const picc = nfc.plug(PICC);
    picc.connection = {};
    const stopping = pcsc.stop();
    await vi.advanceTimersByTimeAsync(1100);
    await stopping;
    expect(picc.closed).toBe(true);
    expect(logs.events()).toContain("closing_while_connected");
  });

  it("cancels a pending PC/SC restart", async () => {
    vi.useFakeTimers();
    const { nfc, pcsc } = setup();
    nfc.emit("error", new Error("boom"));
    await pcsc.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(instances).toHaveLength(1);
  });
});
