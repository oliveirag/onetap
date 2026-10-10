import type { TapEvent } from "@shared/contracts.ts";
import type { CardType } from "./atr.ts";

// What the bridge sends. A superset of the shared TapEvent, so consumers of TapEvent keep working.
// The bridge only reports taps; deciding whether a tap becomes a payment is the backend's job.
export interface BridgeTapEvent extends TapEvent {
  tapId: string;       // new UUID per tap; reused on HTTP retries so the backend can dedupe
  cardType: CardType;
  readerName: string;
}

// Anything that delivers taps: the WebSocket server, the HTTP sender.
export interface TapSink {
  readonly name: string;
  send(tap: BridgeTapEvent): Promise<void>;
  close(): Promise<void>;
}
