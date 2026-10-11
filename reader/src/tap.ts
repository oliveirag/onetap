import type { TapEvent } from "@shared/schemas.ts";
import type { CardType } from "./atr.ts";

export type TapSource = "nfc" | "fake_tap";

// What the bridge sends: the backend's TapEvent (packages/shared) plus `source`, which the backend
// ignores. The bridge only reports taps; deciding whether a tap becomes a payment is the backend's job.
export interface BridgeTapEvent extends TapEvent {
  cardType: CardType;
  source: TapSource; // for logs only; never used in logic
}

// Anything that delivers taps: the WebSocket server, the HTTP sender.
export interface TapSink {
  readonly name: string;
  send(tap: BridgeTapEvent): Promise<void>;
  close(): Promise<void>;
}
