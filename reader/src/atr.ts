// Decodes the card type from a contactless ATR as built by PC/SC readers (PC/SC Part 3, section 3.1.3.2.3).
// Example, NTAG21x on the ACR1252U: 3B 8F 80 01 80 4F 0C A0 00 00 03 06 03 00 03 00 00 00 00 68

export type CardType =
  | "ntag_or_ultralight"
  | "mifare_ultralight_c"
  | "mifare_classic_1k"
  | "mifare_classic_4k"
  | "mifare_mini"
  | "mifare_plus"
  | "felica"
  | "iso14443_4"
  | "fake"
  | "unknown";

const PCSC_RID = "A000000306";

// Card name bytes (NN) from the PC/SC Part 3 supplement.
const CARD_NAMES: Record<string, CardType> = {
  "0001": "mifare_classic_1k",
  "0002": "mifare_classic_4k",
  "0003": "ntag_or_ultralight", // NTAG21x reports as Ultralight
  "0026": "mifare_mini",
  "003A": "mifare_ultralight_c",
  "0036": "mifare_plus", // Plus SL1 2K
  "0037": "mifare_plus", // Plus SL1 4K
  "0038": "mifare_plus", // Plus SL2 2K
  "0039": "mifare_plus", // Plus SL2 4K
  "003B": "felica",
  "F004": "felica",
};

export function decodeCardType(atr: Buffer | undefined): CardType {
  if (!atr || atr.length < 5 || atr[0] !== 0x3b) return "unknown";
  const hex = atr.toString("hex").toUpperCase();

  // Storage cards (ISO 14443-3 and FeliCa): 3B 8F 80 01 80 4F 0C <RID> <SS> <NN NN> ...
  if (hex.startsWith("3B8F8001804F0C")) {
    return hex.slice(14, 24) === PCSC_RID ? (CARD_NAMES[hex.slice(26, 30)] ?? "unknown") : "unknown";
  }

  // ISO 14443-4 cards: 3B 8n 80 01 <historical bytes or ATS> <TCK>
  if ((atr[1] & 0xf0) === 0x80 && atr[2] === 0x80 && atr[3] === 0x01) return "iso14443_4";

  return "unknown";
}
