/** Formats integer minor units (cents) for display. */
export function formatCents(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** Parses a user-entered dollar string ("100", "100.5", "$1,000.25") into integer cents. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Converts a decimal amount from Plaid (e.g. 12.34) to integer cents without float drift. */
export function decimalToCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(value * 100);
}
