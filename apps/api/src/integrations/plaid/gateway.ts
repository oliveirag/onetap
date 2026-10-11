/**
 * Provider-neutral view of the Plaid operations Reclaimed uses. Business logic
 * depends on this interface only; PlaidSdkGateway is the real implementation and
 * tests use an in-memory fake.
 */
export interface PlaidAccount {
  accountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current: number | null;
  available: number | null;
  limit: number | null;
  isoCurrencyCode: string | null;
}

export interface PlaidTransaction {
  transactionId: string;
  accountId: string;
  pendingTransactionId: string | null;
  name: string;
  merchantName: string | null;
  amount: number;
  isoCurrencyCode: string | null;
  date: string;
  authorizedDate: string | null;
  pending: boolean;
  category: string | null;
  paymentChannel: string | null;
}

export interface PlaidSyncPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transactionId: string }[];
  nextCursor: string;
  hasMore: boolean;
}

export interface PlaidCreditLiability {
  accountId: string;
  aprs: { aprType: string; aprPercentage: number }[];
  isOverdue: boolean | null;
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;
  lastStatementIssueDate: string | null;
  lastStatementBalance: number | null;
  minimumPaymentAmount: number | null;
  nextPaymentDueDate: string | null;
}

export interface PlaidItemInfo {
  itemId: string;
  institutionId: string | null;
  products: string[];
  consentExpiresAt: string | null;
}

export interface PlaidGateway {
  createLinkToken(args: {
    userId: string;
    accessToken?: string;
    webhookUrl?: string;
    redirectUri?: string;
    androidPackageName?: string;
    includeLiabilities: boolean;
  }): Promise<{ linkToken: string; expiration: string }>;
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  getItem(accessToken: string): Promise<PlaidItemInfo>;
  getInstitutionName(institutionId: string): Promise<string | null>;
  getAccounts(accessToken: string): Promise<PlaidAccount[]>;
  syncTransactions(accessToken: string, cursor: string | null): Promise<PlaidSyncPage>;
  getCreditLiabilities(accessToken: string): Promise<PlaidCreditLiability[]>;
  removeItem(accessToken: string): Promise<void>;
  getWebhookVerificationKey(keyId: string): Promise<Record<string, unknown>>;
}

/** Normalized Plaid API error. */
export class PlaidApiError extends Error {
  constructor(
    public readonly errorType: string,
    public readonly errorCode: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PlaidApiError';
  }
}
