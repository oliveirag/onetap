import { CATEGORIES } from './categories';
import type { CardProductRate, CategoryId, UserCardRow } from './types';

export type Rule = { category: CategoryId; card: UserCardRow; multiplier: number; tie: boolean };

// What Auto mode does for each category, in the same order the router uses (PRD F4):
// highest reward value per dollar (multiplier x cents per point) wins; a tie goes to the card
// higher in the user's order. A missing rate counts as 1x, like the router.
export function routingRules(cards: UserCardRow[], rates: CardProductRate[]): Rule[] {
  const usable = cards.filter((c) => c.is_active);
  if (!usable.length) return [];
  const rate = new Map(rates.map((r) => [`${r.card_product_id}:${r.category_id}`, r.multiplier]));
  const multiplier = (c: UserCardRow, cat: CategoryId) => rate.get(`${c.card_product_id}:${cat}`) ?? 1;
  const value = (c: UserCardRow, cat: CategoryId) => multiplier(c, cat) * (c.card_product?.cents_per_point ?? 1);

  return (Object.keys(CATEGORIES) as CategoryId[]).map((category) => {
    const ranked = [...usable].sort((a, b) => value(b, category) - value(a, category) || a.priority - b.priority);
    const [best, next] = ranked;
    return { category, card: best, multiplier: multiplier(best, category), tie: !!next && value(next, category) === value(best, category) };
  });
}
