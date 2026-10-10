import type { CardProduct, CardProductRate, CategoryId } from './types';

// The 10 card products in Supabase `card_products`, plus "Other card". The hosted table has no
// reward rates yet, so these multipliers are demo estimates (label them where they show).
// Swap for card_product_rates rows once the backend lands.
type Entry = CardProduct & { slug: string; keywords: string[]; rates: Record<CategoryId, number> };

const flat = (n: number): Record<CategoryId, number> => ({ dining: n, groceries: n, gas: n, streaming: n, travel: n, general: n });

const product = (
  slug: string,
  issuer: string,
  name: string,
  network: CardProduct['network'],
  reward_type: CardProduct['reward_type'],
  reward_currency: string,
  card_art: string,
  keywords: string[],
  rates: Partial<Record<CategoryId, number>>,
): Entry => ({
  id: `cp-${slug}`,
  slug,
  issuer,
  name,
  network,
  reward_type,
  reward_currency,
  cents_per_point: 1,
  card_art,
  is_generic: false,
  keywords,
  rates: { ...flat(1), ...rates },
});

export const CATALOG: Entry[] = [
  product('amex-gold', 'American Express', 'Amex Gold', 'amex', 'points', 'Membership Rewards', 'lines', ['gold'], { dining: 4, groceries: 4, travel: 3 }),
  product('amex-platinum', 'American Express', 'Amex Platinum', 'amex', 'points', 'Membership Rewards', 'solid', ['platinum'], { travel: 5 }),
  product('capital-one-savor', 'Capital One', 'Savor', 'mastercard', 'cashback', 'Cash back', 'dots', ['savor'], { dining: 3, groceries: 3, streaming: 3 }),
  product('capital-one-venture-x', 'Capital One', 'Venture X', 'visa', 'points', 'Capital One Miles', 'grid', ['venture'], flat(2)),
  product('chase-freedom-flex', 'Chase', 'Freedom Flex', 'mastercard', 'points', 'Ultimate Rewards', 'lines', ['flex'], { dining: 3 }),
  product('chase-freedom-unlimited', 'Chase', 'Freedom Unlimited', 'visa', 'points', 'Ultimate Rewards', 'dots', ['unlimited'], { ...flat(1.5), dining: 3 }),
  product('chase-sapphire-preferred', 'Chase', 'Sapphire Preferred', 'visa', 'points', 'Ultimate Rewards', 'dots', ['sapphire'], { dining: 3, streaming: 3, travel: 5 }),
  product('citi-custom-cash', 'Citi', 'Custom Cash', 'mastercard', 'points', 'ThankYou Points', 'grid', ['custom cash'], { gas: 5 }),
  product('citi-double-cash', 'Citi', 'Double Cash', 'mastercard', 'cashback', 'Cash back', 'solid', ['double cash'], flat(2)),
  product('discover-it-cash-back', 'Discover', 'Discover it', 'discover', 'cashback', 'Cash back', 'grid', ['discover'], {}),
];

// PRD F2: an account with no match still routes, at 1x on everything.
export const OTHER_CARD: Entry = {
  ...product('other', 'Other', 'Other card', 'visa', 'cashback', 'Cash back', 'solid', [], {}),
  is_generic: true,
};

const ALL = [...CATALOG, OTHER_CARD];

export const catalogRates: CardProductRate[] = ALL.flatMap((p) =>
  (Object.keys(p.rates) as CategoryId[]).map((category_id) => ({ card_product_id: p.id, category_id, multiplier: p.rates[category_id] })),
);

export function productById(id: string): Entry | undefined {
  return ALL.find((p) => p.id === id);
}

// Strips the catalog-only fields so the row matches the CardProduct contract.
export function asCardProduct({ slug: _s, keywords: _k, rates: _r, ...p }: Entry): CardProduct {
  return p;
}

// Pre-match by account name (PRD F2). First keyword hit wins; no hit means Other card.
export function matchProduct(accountName: string): Entry {
  const name = accountName.toLowerCase();
  return CATALOG.find((p) => p.keywords.some((k) => name.includes(k))) ?? OTHER_CARD;
}
