import { randomUUID } from 'node:crypto';
import { PlaidApiError, type PlaidAccount, type PlaidCreditLiability, type PlaidGateway, type PlaidSyncPage, type PlaidTransaction } from '../src/integrations/plaid/gateway.js';

interface FakeItem {
  itemId: string;
  institutionId: string;
  accounts: PlaidAccount[];
  liabilities: PlaidCreditLiability[];
  /** Sequence of pages returned per cursor. */
  pages: Map<string | null, PlaidSyncPage>;
  removed: boolean;
  loginRequired: boolean;
}

/** In-memory Plaid stand-in for automated tests. Mirrors Plaid Sandbox shapes. */
export class FakePlaidGateway implements PlaidGateway {
  readonly items = new Map<string, FakeItem>(); // keyed by access token
  readonly publicTokens = new Map<string, string>(); // public → access
  readonly webhookKeys = new Map<string, Record<string, unknown>>();
  linkTokenCalls: Parameters<PlaidGateway['createLinkToken']>[0][] = [];
  mutateOnce = false;

  addInstitution(opts: { institutionId: string; accounts: PlaidAccount[]; liabilities?: PlaidCreditLiability[] }): string {
    const access = `access-sandbox-${randomUUID()}`;
    const pub = `public-sandbox-${randomUUID()}`;
    this.publicTokens.set(pub, access);
    this.items.set(access, {
      itemId: `item-${randomUUID()}`,
      institutionId: opts.institutionId,
      accounts: opts.accounts,
      liabilities: opts.liabilities ?? [],
      pages: new Map(),
      removed: false,
      loginRequired: false,
    });
    return pub;
  }

  itemByPublic(pub: string): FakeItem {
    return this.items.get(this.publicTokens.get(pub)!)!;
  }

  async createLinkToken(args: Parameters<PlaidGateway['createLinkToken']>[0]) {
    this.linkTokenCalls.push(args);
    return { linkToken: `link-sandbox-${randomUUID()}`, expiration: new Date(Date.now() + 4 * 3600_000).toISOString() };
  }
  async exchangePublicToken(publicToken: string) {
    const access = this.publicTokens.get(publicToken);
    if (!access) throw new PlaidApiError('INVALID_INPUT', 'INVALID_PUBLIC_TOKEN', 'bad public token', 400);
    return { accessToken: access, itemId: this.items.get(access)!.itemId };
  }
  private item(access: string) {
    const i = this.items.get(access);
    if (!i || i.removed) throw new PlaidApiError('INVALID_INPUT', 'INVALID_ACCESS_TOKEN', 'bad token', 400);
    if (i.loginRequired) throw new PlaidApiError('ITEM_ERROR', 'ITEM_LOGIN_REQUIRED', 'login required', 400);
    return i;
  }
  async getItem(access: string) {
    const i = this.item(access);
    return { itemId: i.itemId, institutionId: i.institutionId, products: ['transactions', 'liabilities'], consentExpiresAt: null };
  }
  async getInstitutionName(id: string) {
    return ({ ins_citi: 'Citibank Online', ins_chase: 'Chase', ins_platypus: 'First Platypus Bank' } as Record<string, string>)[id] ?? null;
  }
  async getAccounts(access: string) {
    return this.item(access).accounts;
  }
  async syncTransactions(access: string, cursor: string | null): Promise<PlaidSyncPage> {
    const i = this.item(access);
    if (this.mutateOnce && cursor !== null) {
      this.mutateOnce = false;
      throw new PlaidApiError('TRANSACTIONS_ERROR', 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', 'mutation', 400);
    }
    return i.pages.get(cursor) ?? { added: [], modified: [], removed: [], nextCursor: cursor ?? 'c-empty', hasMore: false };
  }
  async getCreditLiabilities(access: string) {
    return this.item(access).liabilities;
  }
  async removeItem(access: string) {
    this.item(access).removed = true;
  }
  async getWebhookVerificationKey(keyId: string) {
    const k = this.webhookKeys.get(keyId);
    if (!k) throw new PlaidApiError('INVALID_INPUT', 'INVALID_WEBHOOK_VERIFICATION_KEY_ID', 'unknown kid', 400);
    return k;
  }
}

export function txn(id: string, accountId: string, overrides: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return {
    transactionId: id,
    accountId,
    pendingTransactionId: null,
    name: `Purchase ${id}`,
    merchantName: 'Coffee Shop',
    amount: 12.34,
    isoCurrencyCode: 'USD',
    date: '2026-10-01',
    authorizedDate: null,
    pending: false,
    category: 'FOOD_AND_DRINK',
    paymentChannel: 'in store',
    ...overrides,
  };
}

export const CITI_DC: PlaidAccount = {
  accountId: 'acc-citi-dc',
  name: 'Citi Double Cash® Card',
  officialName: 'Citi Double Cash Card',
  mask: '4321',
  type: 'credit',
  subtype: 'credit card',
  current: 410.55,
  available: 4589.45,
  limit: 5000,
  isoCurrencyCode: 'USD',
};
export const CITI_CHECKING: PlaidAccount = { ...CITI_DC, accountId: 'acc-citi-chk', name: 'Citi Checking', officialName: null, mask: '0001', type: 'depository', subtype: 'checking', limit: null, current: 1200, available: 1200 };
export const CHASE_GENERIC: PlaidAccount = { ...CITI_DC, accountId: 'acc-chase-cc', name: 'Chase Credit Card', officialName: null, mask: '9988', current: 99.99, limit: 10000 };
export const PLATYPUS_CC: PlaidAccount = { ...CITI_DC, accountId: 'acc-plat-cc', name: 'Plaid Credit Card', officialName: 'Plaid Diamond 12.5% APR Interest Credit Card', mask: '3333', current: 410, limit: 2000 };
