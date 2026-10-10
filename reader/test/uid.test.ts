import { describe, expect, it } from "vitest";
import { normalizeUid } from "@shared/nfc.ts";

describe("normalizeUid", () => {
  it("uppercases lowercase hex", () => {
    expect(normalizeUid("049315a93f0289")).toBe("049315A93F0289");
  });

  it("strips colons", () => {
    expect(normalizeUid("04:93:15:a9:3f:02:89")).toBe("049315A93F0289");
  });

  it("strips spaces and dashes", () => {
    expect(normalizeUid("04 a3 97 a2 3f 02 89")).toBe("04A397A23F0289");
    expect(normalizeUid(" 04-A3-97-A2-3F-02-89 ")).toBe("04A397A23F0289");
  });

  it("converts raw bytes, keeping leading zeros", () => {
    expect(normalizeUid(Uint8Array.from([0x04, 0x0a, 0x00, 0xff]))).toBe("040A00FF");
  });

  it("accepts 4, 7 and 10 byte UIDs only", () => {
    expect(normalizeUid("DEADBEEF")).toHaveLength(8);
    expect(normalizeUid("00112233445566778899")).toHaveLength(20);
    expect(() => normalizeUid("0493")).toThrow(/Invalid NFC UID/);
    expect(() => normalizeUid("049315A93F02")).toThrow(/Invalid NFC UID/); // 6 bytes
  });

  it("rejects empty input", () => {
    expect(() => normalizeUid("")).toThrow(/Invalid NFC UID/);
    expect(() => normalizeUid("  ::  ")).toThrow(/Invalid NFC UID/);
    expect(() => normalizeUid(new Uint8Array())).toThrow(/Invalid NFC UID/);
  });

  it("rejects non-hex characters", () => {
    expect(() => normalizeUid("04931GA93F0289")).toThrow(/Invalid NFC UID/);
  });
});
