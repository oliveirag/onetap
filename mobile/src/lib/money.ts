// Money is integer cents end to end. Formatting uses integer math only, never floats.
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('cents must be an integer');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatReward(cents: number): string {
  return `+${formatCents(cents)}`;
}

export function formatMultiplier(m: number): string {
  return `${Number(m.toFixed(2))}x`;
}
