// Decides whether a detected card counts as a new tap.
// A card counts once while it stays on the reader, and again only after it has been gone for debounceMs.
// "Seen" includes the moment it was lifted, so a card that flickers off and on while held stays one tap.

export type GateResult = { tap: true } | { tap: false; reason: "still_present" | "debounced"; sinceMs: number };

export class TapGate {
  private present = new Set<string>();
  private lastSeen = new Map<string, number>();

  constructor(private debounceMs: number) {}

  // Call when a card is detected. `stays` is false for fake taps, which have no removal event.
  detected(uid: string, now: number, stays = true): GateResult {
    const last = this.lastSeen.get(uid);
    let result: GateResult = { tap: true };
    if (this.present.has(uid)) result = { tap: false, reason: "still_present", sinceMs: now - (last ?? now) };
    else if (last !== undefined && now - last < this.debounceMs) result = { tap: false, reason: "debounced", sinceMs: now - last };

    if (stays) this.present.add(uid);
    // Fake taps only restart the window when they count, so holding "f" gives one tap per window.
    if (result.tap || stays) this.lastSeen.set(uid, now);
    return result;
  }

  removed(uid: string, now: number): void {
    if (this.present.delete(uid)) this.lastSeen.set(uid, now);
  }

  // Reader unplugged: nothing is on it any more.
  clearPresent(now: number): void {
    for (const uid of this.present) this.lastSeen.set(uid, now);
    this.present.clear();
  }
}
