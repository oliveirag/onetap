import { asCardProduct, catalogRates, matchProduct, productById } from '../catalog';
import type { CardSpendingRow, OneTapCardRow, ProfileRow, TransactionRow, UserCardRow } from '../types';
import { mockCards, mockProfile, mockRates, mockOneTapCard, seedTransactions } from './fixtures';

// In-memory stand-in for the user's Supabase rows. Lives for the app session.
let profile: ProfileRow = { ...mockProfile };
const cards: UserCardRow[] = mockCards.map((c) => ({ ...c }));
let transactions: TransactionRow[] = seedTransactions(new Date());
let oneTap: OneTapCardRow = { ...mockOneTapCard };

export const mockStore = {
  profile: () => ({ ...profile }),
  cards: () => cards.map((c) => ({ ...c })),
  oneTapCard: () => ({ ...oneTap }),
  linkPhysicalCard() {
    oneTap = { ...oneTap, physical_linked: true };
    return { ...oneTap };
  },
  // Stand-in for card_spending: the seeded purchases, as the connected cards would report them.
  cardSpending: (): CardSpendingRow[] =>
    transactions
      .filter((t) => t.status === 'approved')
      .map((t) => {
        const card = cards.find((c) => c.id === t.routed_card_id);
        return {
          id: t.id,
          financial_account_id: t.routed_card_id,
          account_name: card?.account_name ?? 'Card',
          mask: card?.mask ?? null,
          merchant: t.merchant_name,
          amount_cents: t.amount_cents,
          date: t.created_at.slice(0, 10),
          pending: false,
          category_id: t.category_id,
        };
      }),
  // Fixture products plus the catalog, so a card re-matched in onboarding still has rates.
  rates: () => [...mockRates, ...catalogRates].map((r) => ({ ...r })),
  transactions: () => [...transactions],
  updateProfile(patch: Partial<ProfileRow>) {
    profile = { ...profile, ...patch };
    return { ...profile };
  },
  // Card order = priority (1 first). Lower priority wins routing ties.
  setCardOrder(ids: string[]) {
    const byId = new Map(cards.map((c) => [c.id, c]));
    const next = ids.map((id, i) => ({ ...byId.get(id)!, priority: i + 1 }));
    cards.splice(0, cards.length, ...next);
    return ids;
  },
  // Plaid sandbox stand-in (PRD F2 fallback): the four test accounts, pre-matched to the catalog
  // by account name. Card ids stay the same, so the seeded history still points at them.
  connectTestAccounts() {
    const next = mockCards.map((c) => {
      const product = matchProduct(c.account_name);
      return { ...c, card_product_id: product.id, card_product: asCardProduct(product), match_source: 'auto' as const };
    });
    cards.splice(0, cards.length, ...next);
    return cards.map((c) => ({ ...c }));
  },
  setCardProduct(cardId: string, productId: string) {
    const product = productById(productId);
    const i = cards.findIndex((c) => c.id === cardId);
    if (!product || i < 0) throw new Error('Unknown card or product');
    cards[i] = { ...cards[i], card_product_id: product.id, card_product: asCardProduct(product), match_source: 'user' };
    return { ...cards[i] };
  },
  addTransaction(tx: TransactionRow) {
    if (!transactions.some((t) => t.id === tx.id)) transactions = [tx, ...transactions];
  },
};
