// nfc-pcsc ships no types. Only the parts the bridge uses are declared here.
declare module "nfc-pcsc" {
  import { EventEmitter } from "node:events";

  export interface Card {
    atr?: Buffer;
    standard?: "TAG_ISO_14443_3" | "TAG_ISO_14443_4";
    type?: string;
    uid?: string;
  }

  export class Reader extends EventEmitter {
    readonly name: string;
    aid: string | Buffer | ((card: Card) => Buffer) | null;
    autoProcessing: boolean;
    connection: object | null; // non-null while connected to a card, until the async disconnect completes
    transmit(data: Buffer, responseMaxLength: number): Promise<Buffer>;
    close(): void;
    on(event: "card" | "card.off", listener: (card: Card) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "end", listener: () => void): this;
  }

  export class NFC extends EventEmitter {
    constructor(logger?: unknown);
    close(): void;
    on(event: "reader", listener: (reader: Reader) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
  }
}
