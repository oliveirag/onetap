import { brand } from './brand';
import type { Scheme } from './resolve';

// The one hue charts may use: blues built around the card's route bar (brand.route), so data
// color reads as part of the One Tap identity while the rest of the UI stays achromatic.
// Ordered by rank, deepest first; the ramp only lightens, so rank reads as lightness too.
// Dark: the route blue itself is 2.9:1 on the page, so the ramp starts one step lighter. Every
// step clears 3:1 against #171717 (3.5 to 14.7). Light: every step clears 3:1 against white.
const RAMP: Record<Scheme, string[]> = {
  dark: ['#3D5BFF', '#5F7AFF', '#8199FF', '#A3B5FF', '#C4D0FF', '#E2E8FF'],
  light: [brand.route, '#1A33C4', '#0F2190', '#5C78FF', '#0A1660', '#4A64F0'],
};

// The color for the item at `rank` (0 = largest). More items than steps reuse the last step.
export function chartColor(scheme: Scheme, rank: number): string {
  const ramp = RAMP[scheme];
  return ramp[Math.min(rank, ramp.length - 1)];
}

// Items other than the selected one recede to this opacity, so selection never rests on hue.
export const CHART_DIM = 0.35;
