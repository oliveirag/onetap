import { matchProduct } from './catalog';
import { buildPlan, emptyAnswers, fixesFor, PAINS, SAMPLE_WALLET } from './onboarding';

it('routes each plan purchase to the card that earns the most, with PRD F4 reward math', () => {
  const plan = buildPlan({ ...emptyAnswers, spend: ['dining', 'gas'] });
  // Two picked categories, topped up to three from the defaults.
  expect(plan.purchases.map((p) => [p.merchant.name, p.cardName, p.multiplier, p.points, p.valueCents])).toEqual([
    ['Knight Bites', 'Amex Gold', 4, 52, 52], // $13.00 x 4 (the PRD's own example)
    ['Sunshine Fuel', 'Custom Cash', 5, 209, 209], // $41.75 x 5 = 208.75, rounds to 209
    ['Pegasus Market', 'Amex Gold', 4, 257, 257], // $64.20 x 4 = 256.8, rounds to 257
  ]);
  expect(plan.totalCents).toBe(518);
});

it('compares against the single card that would have earned the most on the same purchases', () => {
  const plan = buildPlan({ ...emptyAnswers, spend: ['dining', 'gas', 'groceries'] });
  // Amex alone: 52 + 42 (gas at 1x) + 257.
  expect(plan.oneCardName).toBe('Amex Gold');
  expect(plan.oneCardCents).toBe(351);
  expect(plan.totalCents - plan.oneCardCents).toBe(167);
});

it('gives a tie to the card listed first', () => {
  const plan = buildPlan({ ...emptyAnswers, spend: ['dining'] }, ['cp-citi-double-cash', 'cp-capital-one-venture-x']);
  expect(plan.rules.every((r) => r.cardName === 'Double Cash')).toBe(true);
  expect(plan.totalCents).toBe(plan.oneCardCents);
});

it('routes between the cards they carry, in the order picked', () => {
  const plan = buildPlan({ ...emptyAnswers, wallet: ['cp-citi-custom-cash', 'cp-amex-gold'], spend: ['gas'] });
  expect(plan.sample).toBe(false);
  expect(plan.purchases.map((p) => p.cardName)).toEqual(['Custom Cash', 'Amex Gold', 'Amex Gold']);
  expect(plan.rules.find((r) => r.category === 'general')?.cardName).toBe('Custom Cash'); // 1x tie: picked first
});

it('falls back to a labeled sample wallet when no cards were picked', () => {
  const plan = buildPlan(emptyAnswers);
  expect(plan.sample).toBe(true);
  expect(plan.purchases).toHaveLength(3);
  expect(new Set(plan.purchases.map((p) => p.cardId)).size).toBeGreaterThan(1);
  expect(SAMPLE_WALLET).toContain(plan.purchases[0].cardId);
});

it('mirrors back up to three of the pains they picked', () => {
  expect(fixesFor(['worth', 'time']).map((p) => p.id)).toEqual(['worth', 'time']);
  expect(fixesFor([])).toEqual(PAINS.slice(0, 3));
});

it('pre-matches accounts by name and sends unknown cards to Other (PRD F2)', () => {
  expect(matchProduct('American Express Gold Card').name).toBe('Amex Gold');
  expect(matchProduct('Chase Sapphire Preferred').name).toBe('Sapphire Preferred');
  expect(matchProduct('Wells Fargo Active Cash Card').is_generic).toBe(true);
});
