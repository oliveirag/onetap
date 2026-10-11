/**
 * Card identification from the ATR synthesized by PC/SC Part 3 compliant contactless
 * readers (the ACR1252U follows this format for storage cards):
 *   3B 8F 80 01 80 4F 0C A0 00 00 03 06 SS C0 C1 00 00 00 00 TCK
 * SS = standard (03 = ISO 14443A part 3, 11 = FeliCa), C0C1 = card name.
 * ISO 14443-4 (smart) cards return their own historical bytes instead.
 */
const CARD_NAMES: Record<string, string> = {
  '0001': 'MIFARE Classic 1K',
  '0002': 'MIFARE Classic 4K',
  '0003': 'MIFARE Ultralight / NTAG21x',
  '0026': 'MIFARE Mini',
  '003A': 'MIFARE Ultralight C',
  '0036': 'MIFARE Plus SL1 2K',
  '0037': 'MIFARE Plus SL1 4K',
  '0038': 'MIFARE Plus SL2 2K',
  '0039': 'MIFARE Plus SL2 4K',
  F011: 'FeliCa 212K',
  F012: 'FeliCa 424K',
};

export interface AtrInfo {
  cardType: string;
  standard: 'ISO14443A-3' | 'ISO14443-4' | 'FeliCa' | 'UNKNOWN';
  /** Whether Phase 1 can read a usable development identifier from this card. */
  supported: boolean;
}

export function parseAtr(atrHex: string): AtrInfo {
  const atr = atrHex.toUpperCase().replace(/\s+/g, '');
  const rid = 'A000000306';
  const i = atr.indexOf(rid);
  if (atr.startsWith('3B8F8001804F0C') && i >= 0) {
    const ss = atr.slice(i + 10, i + 12);
    const name = atr.slice(i + 12, i + 16);
    const cardType = CARD_NAMES[name] ?? `ISO 14443 storage card (0x${name})`;
    return { cardType, standard: ss === '11' ? 'FeliCa' : 'ISO14443A-3', supported: true };
  }
  if (atr.startsWith('3B8') && atr.length >= 8) {
    // ISO 14443-4 card (e.g. DESFire, JCOP, bank cards). UID via GET DATA still works but
    // may be random per tap on privacy-enabled cards.
    return { cardType: 'ISO 14443-4 smart card', standard: 'ISO14443-4', supported: true };
  }
  return { cardType: 'Unknown card', standard: 'UNKNOWN', supported: false };
}
