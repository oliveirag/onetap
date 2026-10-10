// In-memory stand-in for nfc-pcsc. No reader, no native module.
// Usage: vi.mock("nfc-pcsc", () => import("./helpers/fake-pcsc.ts"));
import { EventEmitter } from "node:events";

export const ATR_NTAG = Buffer.from("3B8F8001804F0CA0000003060300030000000068", "hex");
const OK = Buffer.from([0x90, 0x00]);

export class Reader extends EventEmitter {
  autoProcessing = true;
  aid: unknown = null;
  connection: object | null = null;
  closed = false;
  transmitted: Buffer[] = [];
  private response: Buffer = Buffer.from([0x6a, 0x81]);

  constructor(readonly name: string) {
    super();
  }

  async transmit(data: Buffer, _max: number): Promise<Buffer> {
    this.transmitted.push(Buffer.from(data));
    return this.response;
  }

  close() {
    this.closed = true;
    this.emit("end");
  }

  // Test helpers ---------------------------------------------------------------

  // A card enters the field. The card answers GET DATA with this UID.
  place(uidHex: string, atr: Buffer = ATR_NTAG) {
    this.response = Buffer.concat([Buffer.from(uidHex, "hex"), OK]);
    this.emit("card", { atr });
  }

  // A card enters the field but the UID read fails (e.g. lifted mid-read).
  placeUnreadable(atr: Buffer = ATR_NTAG) {
    this.response = Buffer.from([0x63, 0x00]);
    this.emit("card", { atr });
  }

  lift() {
    this.emit("card.off", {});
  }

  unplug() {
    this.emit("end");
  }
}

export const instances: NFC[] = [];

export class NFC extends EventEmitter {
  closed = false;
  constructor() {
    super();
    instances.push(this);
  }
  close() {
    this.closed = true;
  }
  // Test helper: PC/SC announces a reader.
  plug(name: string): Reader {
    const reader = new Reader(name);
    this.emit("reader", reader);
    return reader;
  }
}

export const PICC = "ACS ACR1252 Dual Reader PICC";
export const SAM = "ACS ACR1252 Dual Reader SAM";

// Lets the async "card" handler (transmit, then callback) finish.
export const settle = () => new Promise((r) => setImmediate(r));
