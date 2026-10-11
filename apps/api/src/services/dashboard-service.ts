import type { DashboardSummaryDto } from '@reclaimed/shared';
import type { Database } from '@reclaimed/database';
import type { AccountsService } from './accounts-service.js';
import type { CardsService } from './cards-service.js';
import type { PlaidService } from './plaid-service.js';

/** Real (Plaid-reported) and simulated (Reclaimed) data are returned in separate sections. */
export class DashboardService {
  constructor(
    private readonly db: Database,
    private readonly deps: { accounts: AccountsService; cards: CardsService; plaid: PlaidService },
  ) {}

  async summary(userId: string): Promise<DashboardSummaryDto> {
    const [accounts, items, bank, cards, sim, funding] = await Promise.all([
      this.deps.accounts.list(userId, { type: 'credit' }),
      this.deps.plaid.listItems(userId),
      this.deps.accounts.transactions(userId, { limit: 5 }),
      this.deps.cards.list(userId),
      this.deps.cards.transactions(userId, { limit: 5 }),
      this.deps.cards.listFunding(userId),
    ]);
    const lastSynced = items.map((i) => i.lastSyncedAt).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
    return {
      real: {
        connectedCreditCards: accounts.length,
        totalKnownCreditBalanceCents: accounts.reduce((s, a) => s + (a.currentBalanceCents ?? 0), 0),
        institutions: items.map((i) => ({ id: i.id, name: i.institutionName, status: i.status, lastSyncedAt: i.lastSyncedAt })),
        recentTransactions: bank.items,
        lastSyncedAt: lastSynced,
      },
      simulated: {
        reclaimedCard: cards[0] ?? null,
        recentTransactions: sim.items,
        mockFundingAccounts: funding,
      },
    };
  }
}
