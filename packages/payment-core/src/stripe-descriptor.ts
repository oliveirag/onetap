// Card statement descriptor: Stripe joins the account's shortened descriptor (prefix)
// and our per-payment suffix as "PREFIX* SUFFIX", at most 22 characters in total.

export const DESCRIPTOR_PREFIX = 'ONETAP';
export const MAX_SUFFIX_LENGTH = 22 - DESCRIPTOR_PREFIX.length - 2; // 14

/** Merchant name as a valid suffix: uppercase ASCII, no < > \ ' " *, at least one letter. */
export function descriptorSuffix(merchantName: string): string {
  const cleaned = merchantName
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[<>\\'"*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SUFFIX_LENGTH)
    .trim();
  return /[A-Z]/.test(cleaned) ? cleaned : 'PURCHASE';
}

/** What the cardholder's statement shows, e.g. "ONETAP* KNIGHT BITES". */
export function fullDescriptor(merchantName: string): string {
  return `${DESCRIPTOR_PREFIX}* ${descriptorSuffix(merchantName)}`;
}
