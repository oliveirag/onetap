import { CATEGORIES } from './categories';
import { formatCents, formatReward } from './money';
import type { DecisionReason, TransactionRow } from './types';

export type ReceiptLine = { id: string; name: string; multiplier: number; valueCents: number; chosen: boolean };

export type Receipt = {
  lines: ReceiptLine[];
  hasComparison: boolean;
  reasonNote: string | null;
  autoNote: string | null;
  /** The Stripe test-mode charge of the underlying card; null when there is none. */
  chargeNote: string | null;
  summary: string;
};

const REASON: Record<DecisionReason, string | null> = {
  best_rate: null,
  tie_priority: 'Tied with another card. Your card order broke the tie.',
  manual: 'You chose this card in Manual mode.',
  fallback_default: 'Your chosen card was unavailable, so your default card was used.',
};

// Everything "Why this card" shows, derived from the transaction row alone (plus the routed card's name).
export function buildReceipt(tx: TransactionRow, cardName: string): Receipt {
  const others = [...(tx.alternatives ?? [])]
    .sort((a, b) => b.value_cents - a.value_cents)
    .map((a) => ({ id: a.user_card_id, name: a.card_name, multiplier: a.multiplier, valueCents: a.value_cents, chosen: false }));

  return {
    lines: [{ id: tx.routed_card_id, name: cardName, multiplier: tx.multiplier, valueCents: tx.reward_value_cents, chosen: true }, ...others],
    hasComparison: others.length > 0,
    reasonNote: REASON[tx.decision_reason],
    autoNote:
      tx.routing_mode === 'manual' && tx.best_value_cents > tx.reward_value_cents ? `Auto would have earned ${formatReward(tx.best_value_cents)}.` : null,
    chargeNote: chargeNote(tx, cardName),
    summary: `Routed to ${cardName}, ${Number(tx.multiplier.toFixed(2))} times ${CATEGORIES[tx.category_id].label.toLowerCase()}, plus ${formatCents(tx.reward_value_cents)}`,
  };
}

function chargeNote(tx: TransactionRow, cardName: string): string | null {
  const amount = formatCents(tx.amount_cents);
  const chargedId = tx.charged_card_id ?? tx.routed_card_id;
  const fellBack = chargedId !== tx.routed_card_id;
  const charged = fellBack ? (tx.alternatives?.find((a) => a.user_card_id === chargedId)?.card_name ?? 'your default card') : cardName;
  switch (tx.charge_status) {
    case 'pending':
      return `Charging ${amount} to ${cardName} in Stripe test mode.`;
    case 'succeeded':
      return !fellBack
        ? `Charged ${amount} to ${cardName} in Stripe test mode.`
        : `${cardName} declined, so ${amount} was charged to ${charged} in Stripe test mode.`;
    case 'failed':
      return `The Stripe test-mode charge of ${amount} failed.`;
    default:
      return null;
  }
}
