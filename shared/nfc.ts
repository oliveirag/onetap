// NFC card ID helpers shared by the reader bridge and the store page. No Node or browser APIs.

const UID_BYTE_LENGTHS = [4, 7, 10]; // ISO 14443-3 single, double and triple size UIDs

// Normalizes an NFC UID to TapEvent.cardId format: uppercase hex, no separators ("04A1B2C3D4E5F6").
// Accepts raw bytes or hex with any separators ("04:a1:b2", "04 A1 B2"). Throws if it isn't a valid UID.
export function normalizeUid(raw: string | Uint8Array): string {
  const hex =
    typeof raw === "string"
      ? raw.replace(/[\s:\-]/g, "").toUpperCase()
      : Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

  if (!/^[0-9A-F]*$/.test(hex) || !UID_BYTE_LENGTHS.includes(hex.length / 2)) {
    throw new Error(`Invalid NFC UID: expected 4, 7 or 10 bytes of hex, got "${typeof raw === "string" ? raw : hex}"`);
  }
  return hex;
}
