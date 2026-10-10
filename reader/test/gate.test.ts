import { describe, expect, it } from "vitest";
import { TapGate } from "../src/gate.ts";

describe("TapGate debounce", () => {
  it("ignores the same UID within the window after it was lifted", () => {
    const g = new TapGate(1500);
    expect(g.detected("A", 0).tap).toBe(true);
    g.removed("A", 200);
    expect(g.detected("A", 1699)).toEqual({ tap: false, reason: "debounced", sinceMs: 1499 });
  });

  it("accepts the same UID once the window has passed", () => {
    const g = new TapGate(1500);
    expect(g.detected("A", 0).tap).toBe(true);
    g.removed("A", 200);
    expect(g.detected("A", 1700).tap).toBe(true); // exactly 1500 ms after lift
  });

  it("never ignores a different UID", () => {
    const g = new TapGate(1500);
    expect(g.detected("A", 0).tap).toBe(true);
    expect(g.detected("B", 1).tap).toBe(true); // A still present
    g.removed("B", 2);
    g.removed("A", 3);
    expect(g.detected("C", 4).tap).toBe(true); // A and B both inside their windows
    expect(g.detected("A", 5).tap).toBe(false);
  });

  it("respects a custom window", () => {
    const g = new TapGate(100);
    g.detected("A", 0);
    g.removed("A", 0);
    expect(g.detected("A", 99).tap).toBe(false);
    g.removed("A", 99); // quick re-tap lifted again; the window restarts from here
    expect(g.detected("A", 198).tap).toBe(false);
    g.removed("A", 198);
    expect(g.detected("A", 298).tap).toBe(true);
  });

  it("a held card stays one tap no matter how long, until it is lifted", () => {
    const g = new TapGate(1500);
    expect(g.detected("A", 0).tap).toBe(true);
    expect(g.detected("A", 60_000)).toMatchObject({ tap: false, reason: "still_present" });
  });

  it("without the reader removal, presence never clears (same card detected twice = still on the reader)", () => {
    const g = new TapGate(1500);
    g.detected("A", 0);
    g.clearPresent(100);
    g.detected("A", 1000); // put back inside the window: ignored, and now on the reader again
    expect(g.detected("A", 5000)).toMatchObject({ tap: false, reason: "still_present" });
  });

  it("unplug clears presence so the card can tap again after the window", () => {
    const g = new TapGate(1500);
    g.detected("A", 0);
    g.clearPresent(100); // reader gone; no card.off will ever arrive
    expect(g.detected("A", 1599).tap).toBe(false);
    g.removed("A", 1599);
    expect(g.detected("A", 3099).tap).toBe(true);
  });

  it("fake taps (no removal event) debounce from the last counted tap", () => {
    const g = new TapGate(1500);
    expect(g.detected("A", 0, false).tap).toBe(true);
    expect(g.detected("A", 1000, false).tap).toBe(false);
    expect(g.detected("A", 1499, false).tap).toBe(false); // holding "f" doesn't extend the window
    expect(g.detected("A", 1500, false).tap).toBe(true);
  });
});
