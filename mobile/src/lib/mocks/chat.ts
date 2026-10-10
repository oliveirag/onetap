import { formatCents } from '../money';
import { aggregate } from '../spending';
import type { ChatRequest, ChatResponse } from '../types';
import { mockStore } from './store';

// Stand-in for the chat service (Sultan) until it is live. Spending answers are computed from the
// same mock rows the Spending tab shows, so the two always agree. Points answers are canned demo text.
const POINTS: Record<string, string> = {
  'fly to canada':
    'Your 42,000 Amex Membership Rewards points transfer 1:1 to Air Canada Aeroplan. Orlando to Toronto in economy is 12,500 points one way plus $45.60 in taxes. The cash fare is $286.00, so that is about 1.9 cents per point.',
  'a weekend in new york':
    'Your 31,500 Chase Ultimate Rewards points transfer 1:1 to World of Hyatt. A standard room in Midtown is 15,000 points a night, so two nights uses 30,000 points instead of $612.00 in cash.',
  'what can my points get me':
    'You have 73,500 transferable points across Amex Gold and Sapphire Preferred. That covers a round trip to Toronto in economy, or two hotel nights in New York, with points left over.',
};

function spendingReply(message: string): string {
  const txs = mockStore.transactions();
  const s = aggregate(txs, mockStore.cards());
  if (s.totalSpendCents === 0) return 'You have no purchases through Reclaimed this month yet.';

  const q = message.toLowerCase();
  if (q.includes('earned the most')) {
    const byCard = new Map<string, number>();
    const month = new Date().getUTCMonth();
    for (const t of txs) {
      if (t.status !== 'approved' || new Date(t.created_at).getUTCMonth() !== month) continue;
      byCard.set(t.routed_card_id, (byCard.get(t.routed_card_id) ?? 0) + t.reward_value_cents);
    }
    const [id, cents] = [...byCard].sort((a, b) => b[1] - a[1])[0];
    const card = mockStore.cards().find((c) => c.id === id);
    return `${card?.card_product?.name ?? 'One card'} earned the most this month: ${formatCents(cents)} in rewards out of ${formatCents(s.rewardsCents)} total.`;
  }
  if (q.includes('extra')) {
    return `Routing earned you ${formatCents(s.extraCents)} more than putting everything on your default card. Total rewards this month are ${formatCents(s.rewardsCents)}.`;
  }
  const [top, next] = s.byCategory;
  const pct = Math.round((top.cents / s.totalSpendCents) * 100);
  return `You spent ${formatCents(s.totalSpendCents)} this month. ${top.label} was the largest at ${formatCents(top.cents)}, ${pct}% of the total${next ? `, then ${next.label} at ${formatCents(next.cents)}` : ''}.`;
}

export async function mockChat(req: ChatRequest): Promise<ChatResponse> {
  await new Promise((r) => setTimeout(r, 900));
  const key = req.message.trim().toLowerCase();
  const reply =
    req.mode === 'relay'
      ? spendingReply(req.message)
      : (POINTS[key] ?? 'Tell me where you want to go and I will check which of your points get you there for the least.');
  return { reply, threadId: req.threadId ?? `mock-${req.mode}` };
}
