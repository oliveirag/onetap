import { beforeEach, describe, expect, it, vi } from "vitest";
import { instances, PICC, settle } from "./helpers/fake-pcsc.ts";
import { captureLog } from "./helpers/log.ts";
import { createBridge } from "../src/bridge.ts";
import { startPcsc } from "../src/pcsc.ts";
import type { BridgeTapEvent, TapSink } from "../src/tap.ts";
import { tapEventSchema } from "@shared/schemas.ts";

vi.mock("nfc-pcsc", () => import("./helpers/fake-pcsc.ts"));

const CARD_A = "049315A93F0289";
const CARD_B = "04A397A23F0289";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Full path: fake reader -> real pcsc.ts -> real bridge -> recording sink. Only nfc-pcsc is faked.
function setup(demoCardUid: string | null = CARD_A) {
  instances.length = 0;
  let clock = 1_000_000;
  const sent: BridgeTapEvent[] = [];
  const sink: TapSink = { name: "test", send: async (t) => void sent.push(t), close: async () => {} };
  const logs = captureLog();
  const bridge = createBridge({
    config: { bridgeId: "store-laptop-1", debounceMs: 1500, demoCardUid },
    sinks: [sink],
    log: logs.log,
    now: () => clock,
  });
  startPcsc(logs.log, bridge.cardHandlers);
  const reader = instances[0].plug(PICC);
  const advance = (ms: number) => (clock += ms);
  return { bridge, reader, sent, logs, advance };
}

describe("held card", () => {
  it("produces exactly one tap however long it stays on the reader", async () => {
    const { reader, sent, advance } = setup();
    reader.place(CARD_A);
    await settle();
    advance(30_000);
    expect(sent).toHaveLength(1);
  });

  it("stays one tap when the field flickers while the card is held", async () => {
    const { reader, sent, logs, advance } = setup();
    reader.place(CARD_A);
    await settle();
    for (let i = 0; i < 5; i++) {
      advance(700); // card held; the field drops out briefly every 700 ms
      reader.lift();
      advance(50);
      reader.place(CARD_A);
      await settle();
    }
    expect(sent).toHaveLength(1);
    expect(logs.events().filter((e) => e === "duplicate_ignored")).toHaveLength(5);
  });
});

describe("debounce through the full path", () => {
  it("ignores a re-tap inside the window and accepts one after it", async () => {
    const { reader, sent, advance } = setup();
    reader.place(CARD_A);
    await settle();
    reader.lift();
    advance(1000);
    reader.place(CARD_A);
    await settle();
    expect(sent).toHaveLength(1);

    reader.lift();
    advance(1500);
    reader.place(CARD_A);
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent[0].tapId).not.toBe(sent[1].tapId);
  });

  it("never ignores a different card, even immediately", async () => {
    const { reader, sent } = setup();
    reader.place(CARD_A);
    await settle();
    reader.lift();
    reader.place(CARD_B);
    await settle();
    expect(sent.map((t) => t.uid)).toEqual([CARD_A, CARD_B]);
  });

  it("after unplug and replug, the same card taps again once the window passes", async () => {
    const { reader, sent, advance } = setup();
    reader.place(CARD_A);
    await settle();
    reader.unplug(); // card never got a card.off
    const replugged = instances[0].plug(PICC);
    advance(1500);
    replugged.place(CARD_A);
    await settle();
    expect(sent).toHaveLength(2);
  });
});

describe("tap event", () => {
  it("a real tap has every field in the expected format", async () => {
    const { reader, sent } = setup();
    reader.place("049315a93f0289"); // reader returns raw bytes; bridge must normalize
    await settle();
    expect(sent[0]).toEqual({
      tapId: expect.stringMatching(UUID),
      uid: CARD_A,
      cardType: "ntag_or_ultralight",
      bridgeId: "store-laptop-1",
      readerName: PICC,
      presentedAt: expect.stringMatching(ISO_UTC),
      source: "nfc",
    });
    // The backend validates taps with this schema; a rename on either side fails here first.
    expect(tapEventSchema.safeParse(sent[0]).success).toBe(true);
  });

  it("a fake tap has the same shape as a real tap, with source fake_tap", async () => {
    const { reader, sent, bridge, advance } = setup();
    reader.place(CARD_A);
    await settle();
    reader.lift();
    advance(1500);
    bridge.fakeTap();
    const [real, fake] = sent;

    expect(Object.keys(fake)).toEqual(Object.keys(real));
    for (const key of Object.keys(real) as (keyof BridgeTapEvent)[]) {
      expect(typeof fake[key], key).toBe(typeof real[key]);
    }
    expect(fake.tapId).toMatch(UUID);
    expect(fake.presentedAt).toMatch(ISO_UTC);
    expect(fake.uid).toBe(real.uid);
    expect(fake.bridgeId).toBe(real.bridgeId);
    expect(fake.readerName).toBe(real.readerName); // backend keys readers on (bridgeId, readerName)
    expect(fake.source).toBe("fake_tap");
    expect(real.source).toBe("nfc");
  });

  it("a fake tap goes through the same debounce as a real tap", async () => {
    const { reader, sent, bridge } = setup();
    reader.place(CARD_A);
    await settle();
    reader.lift();
    bridge.fakeTap(); // same card, inside the window
    expect(sent).toHaveLength(1);
  });

  it("without DEMO_CARD_UID a fake tap sends nothing", () => {
    const { sent, bridge, logs } = setup(null);
    bridge.fakeTap();
    expect(sent).toHaveLength(0);
    expect(logs.events()).toContain("fake_tap_unavailable_set_DEMO_CARD_UID");
  });
});

describe("flush", () => {
  it("waits for in-flight sends and reports a timeout if they hang", async () => {
    instances.length = 0;
    let release!: () => void;
    const slow: TapSink = { name: "slow", send: () => new Promise<void>((r) => (release = r)), close: async () => {} };
    const { log } = captureLog();
    const bridge = createBridge({ config: { bridgeId: "t", debounceMs: 1500, demoCardUid: CARD_A }, sinks: [slow], log });
    bridge.fakeTap();
    expect(bridge.pendingCount()).toBe(1);
    expect(await bridge.flush(20)).toBe(false);
    release();
    expect(await bridge.flush(1000)).toBe(true);
    expect(bridge.pendingCount()).toBe(0);
  });
});
