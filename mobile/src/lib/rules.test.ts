import { mockCards, mockRates } from './mocks/fixtures';
import { routingRules } from './rules';

const byCategory = (rules: ReturnType<typeof routingRules>) => Object.fromEntries(rules.map((r) => [r.category, r]));

it('picks the highest-earning card for every category', () => {
  const r = byCategory(routingRules(mockCards, mockRates));
  expect(r.dining.card.id).toBe('card-amex');
  expect(r.dining.multiplier).toBe(4);
  expect(r.gas.card.id).toBe('card-citi');
  expect(r.travel.card.id).toBe('card-sapphire');
  expect(r.general.card.id).toBe('card-active');
  expect(r.general.tie).toBe(false);
});

it('breaks a tie with the card order and says so', () => {
  const rates = mockRates.map((x) => (x.category_id === 'gas' && x.card_product_id === 'p-card-active' ? { ...x, multiplier: 5 } : x));
  const citiFirst = byCategory(routingRules(mockCards, rates)).gas;
  expect(citiFirst.card.id).toBe('card-citi');
  expect(citiFirst.tie).toBe(true);

  const activeFirst = mockCards.map((c) => (c.id === 'card-active' ? { ...c, priority: 0 } : c));
  expect(byCategory(routingRules(activeFirst, rates)).gas.card.id).toBe('card-active');
});

it('skips paused cards, weighs cents per point, and handles no cards', () => {
  const noAmex = mockCards.map((c) => (c.id === 'card-amex' ? { ...c, is_active: false } : c));
  expect(byCategory(routingRules(noAmex, mockRates)).dining.card.id).toBe('card-sapphire');

  const richSapphire = mockCards.map((c) => (c.id === 'card-sapphire' ? { ...c, card_product: { ...c.card_product!, cents_per_point: 1.5 } } : c));
  expect(byCategory(routingRules(richSapphire, mockRates)).dining.card.id).toBe('card-sapphire'); // 3 x 1.5 > 4 x 1

  expect(routingRules([], mockRates)).toEqual([]);
});
