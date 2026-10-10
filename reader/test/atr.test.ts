import { describe, expect, it } from "vitest";
import { decodeCardType } from "../src/atr.ts";

const atr = (hex: string) => Buffer.from(hex.replace(/\s/g, ""), "hex");

describe("decodeCardType", () => {
  it("decodes cards A and B as recorded on the ACR1252U", () => {
    // docs/hardware.md, First read results
    expect(decodeCardType(atr("3B8F8001804F0CA0000003060300030000000068"))).toBe("ntag_or_ultralight");
  });

  it("decodes other PC/SC storage card names", () => {
    expect(decodeCardType(atr("3B8F8001804F0C A000000306 03 0001 00000000 6A"))).toBe("mifare_classic_1k");
    expect(decodeCardType(atr("3B8F8001804F0C A000000306 03 0002 00000000 69"))).toBe("mifare_classic_4k");
    expect(decodeCardType(atr("3B8F8001804F0C A000000306 03 003A 00000000 51"))).toBe("mifare_ultralight_c");
  });

  it("returns unknown for an unlisted card name", () => {
    expect(decodeCardType(atr("3B8F8001804F0C A000000306 03 7777 00000000 00"))).toBe("unknown");
  });

  it("does not trust the card name without the PC/SC RID", () => {
    expect(decodeCardType(atr("3B8F8001804F0C A000000999 03 0003 00000000 00"))).toBe("unknown");
  });

  it("recognises ISO 14443-4 ATRs", () => {
    expect(decodeCardType(atr("3B 81 80 01 80 80"))).toBe("iso14443_4");
    expect(decodeCardType(atr("3B 88 80 01 00 00 00 00 77 81 81 00 7E"))).toBe("iso14443_4");
  });

  it("returns unknown for missing or malformed ATRs", () => {
    expect(decodeCardType(undefined)).toBe("unknown");
    expect(decodeCardType(Buffer.alloc(0))).toBe("unknown");
    expect(decodeCardType(atr("3F 8F 80 01"))).toBe("unknown");
  });
});
