import type { IconName } from '@/components/ui/iconNames';
import { productById } from './catalog';
import { CATEGORIES } from './categories';
import { MERCHANTS, type MockMerchant } from './mocks/fixtures';
import type { CategoryId } from './types';

// Questionnaire before the account exists (app-onboarding-questionnaire skill, Venmo as the
// visual reference). Answers stay on the phone until sign-up copies them onto the account.

export type GoalId = 'earn' | 'trip' | 'guess' | 'budget' | 'simple';
export type PainId = 'forget' | 'one-card' | 'worth' | 'time' | 'missing';

export const GOALS: { id: GoalId; label: string; icon: IconName; pains: string }[] = [
  { id: 'earn', label: 'Earn more on what I already buy', icon: 'arrow-up', pains: 'earning more' },
  { id: 'trip', label: 'Save up points for a trip', icon: 'plane', pains: 'that trip' },
  { id: 'guess', label: 'Stop guessing which card to use', icon: 'question', pains: 'picking the right card' },
  { id: 'budget', label: 'Make a student budget go further', icon: 'student', pains: 'a budget that goes further' },
  { id: 'simple', label: 'Keep my cards simple', icon: 'sparkles', pains: 'keeping it simple' },
];

// Each pain has the fix we show back on the solution screen. Promises only: no invented stats.
export const PAINS: { id: PainId; label: string; fix: string; icon: IconName }[] = [
  { id: 'forget', label: "I can't remember which card earns what", fix: 'OneTap knows every card you own and picks the best one at the register.', icon: 'cards' },
  { id: 'one-card', label: 'I use one card for everything', fix: 'Keep tapping one card. Each purchase still goes to the card that earns the most.', icon: 'tap' },
  { id: 'worth', label: "I don't know what my points are worth", fix: 'Every purchase shows the points you earned and what they are worth in dollars.', icon: 'tag' },
  { id: 'time', label: "I don't have time to track rewards", fix: 'Nothing to track. Your phone shows where each purchase went about 2 seconds after the tap.', icon: 'clock' },
  { id: 'missing', label: "I don't know how much I'm missing", fix: 'See how much extra you earned compared with using one card, every month.', icon: 'chart' },
];

export type Answers = {
  goal: GoalId | null;
  pains: PainId[];
  spend: CategoryId[];
};

export const emptyAnswers: Answers = { goal: null, pains: [], spend: [] };

// Their real cards arrive with Plaid after sign-up, so the plan uses three popular cards as a
// labeled example of what routing does with their spending.
export const SAMPLE_WALLET = ['cp-amex-gold', 'cp-chase-sapphire-preferred', 'cp-citi-custom-cash'];
const DEFAULT_SPEND: CategoryId[] = ['dining', 'groceries', 'gas'];

// The screens before sign-up, in order. The progress pill counts these.
export const FLOW = ['goal', 'pains', 'spend', 'building', 'plan', 'name', 'account'] as const;
export type FlowStep = (typeof FLOW)[number];

// Fixes for the pains they picked (up to three), shown on the plan. Falls back to the first three.
export function fixesFor(pains: PainId[]) {
  const picked = PAINS.filter((p) => pains.includes(p.id));
  return (picked.length ? picked : PAINS).slice(0, 3);
}

// PRD F4 math with catalog multipliers: points = round(dollars x multiplier), value = points x cpp.
function earn(productId: string, category: CategoryId, amountCents: number) {
  const p = productById(productId);
  const multiplier = p?.rates[category] ?? 1;
  const points = Math.round((amountCents * multiplier) / 100);
  return { multiplier, points, value: Math.round(points * (p?.cents_per_point ?? 1)) };
}

export type DemoPurchase = {
  merchant: MockMerchant;
  cardId: string;
  cardName: string;
  multiplier: number;
  points: number;
  valueCents: number;
  oneCardValueCents: number;
};

export type Plan = {
  rules: { category: CategoryId; label: string; icon: IconName; cardName: string; multiplier: number }[];
  purchases: DemoPurchase[];
  oneCardName: string;
  totalCents: number;
  oneCardCents: number;
};

// One purchase per spend category they picked (topped up to three from the defaults), each routed
// like Auto mode: highest value wins, a tie goes to the card listed first. The comparison is the
// single card that would have earned the most across the same purchases, so the extra is honest.
export function buildPlan(a: Answers, ids: string[] = SAMPLE_WALLET): Plan {
  const cats = [...new Set([...a.spend, ...DEFAULT_SPEND])].slice(0, 3);
  const merchants = cats.map((c) => MERCHANTS.find((m) => m.category_id === c)!).filter(Boolean);
  const name = (id: string) => productById(id)?.name ?? 'Your card';

  const best = (category: CategoryId, amount: number) =>
    ids.reduce((top, id) => (earn(id, category, amount).value > earn(top, category, amount).value ? id : top), ids[0]);

  const totalFor = (id: string) => merchants.reduce((sum, m) => sum + earn(id, m.category_id, m.amount_cents).value, 0);
  const oneCard = ids.reduce((top, id) => (totalFor(id) > totalFor(top) ? id : top), ids[0]);

  const purchases = merchants.map((m) => {
    const cardId = best(m.category_id, m.amount_cents);
    const won = earn(cardId, m.category_id, m.amount_cents);
    return {
      merchant: m,
      cardId,
      cardName: name(cardId),
      multiplier: won.multiplier,
      points: won.points,
      valueCents: won.value,
      oneCardValueCents: earn(oneCard, m.category_id, m.amount_cents).value,
    };
  });

  // Rate per category, independent of amount: priced on a $100 purchase.
  const rules = (Object.keys(CATEGORIES) as CategoryId[]).map((category) => {
    const id = best(category, 10000);
    return { category, ...CATEGORIES[category], cardName: name(id), multiplier: earn(id, category, 10000).multiplier };
  });

  return {
    rules,
    purchases,
    oneCardName: name(oneCard),
    totalCents: purchases.reduce((s, p) => s + p.valueCents, 0),
    oneCardCents: purchases.reduce((s, p) => s + p.oneCardValueCents, 0),
  };
}

export function shareText(plan: Plan): string {
  const lines = plan.rules.map((r) => `${r.label}: ${r.cardName} (${r.multiplier}x)`);
  return ['My OneTap plan', ...lines, '', 'One card at the register. The best of my cards on every purchase.'].join('\n');
}


// Skipping personalization goes straight to the account, so the pill counts only those steps.
export const SHORT_FLOW: FlowStep[] = ['name', 'account'];

export const progressOf = (step: FlowStep, skipped = false) => {
  const flow: readonly FlowStep[] = skipped ? SHORT_FLOW : FLOW;
  return { index: flow.indexOf(step), total: flow.length };
};
