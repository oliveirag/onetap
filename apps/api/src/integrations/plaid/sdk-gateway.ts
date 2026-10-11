import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products, type Transaction } from 'plaid';
import { PlaidApiError, type PlaidGateway, type PlaidTransaction } from './gateway.js';

function wrap(err: unknown): never {
  const e = err as { response?: { status?: number; data?: { error_type?: string; error_code?: string; error_message?: string } } };
  const d = e.response?.data;
  if (d?.error_code) throw new PlaidApiError(d.error_type ?? 'API_ERROR', d.error_code, d.error_message ?? d.error_code, e.response?.status);
  throw new PlaidApiError('NETWORK_ERROR', 'PLAID_UNREACHABLE', err instanceof Error ? err.message : String(err));
}

const mapTxn = (t: Transaction): PlaidTransaction => ({
  transactionId: t.transaction_id,
  accountId: t.account_id,
  pendingTransactionId: t.pending_transaction_id ?? null,
  name: t.name,
  merchantName: t.merchant_name ?? null,
  amount: t.amount,
  isoCurrencyCode: t.iso_currency_code ?? null,
  date: t.date,
  authorizedDate: t.authorized_date ?? null,
  pending: t.pending,
  category: t.personal_finance_category?.primary ?? null,
  categoryDetailed: t.personal_finance_category?.detailed ?? null,
  paymentChannel: t.payment_channel ?? null,
});

export class PlaidSdkGateway implements PlaidGateway {
  private readonly api: PlaidApi;
  private readonly products: Products[];
  private readonly countryCodes: CountryCode[];

  constructor(opts: { clientId: string; secret: string; env: 'sandbox' | 'production'; products?: Products[]; countryCodes?: CountryCode[] }) {
    this.products = opts.products?.length ? opts.products : [Products.Transactions];
    this.countryCodes = opts.countryCodes?.length ? opts.countryCodes : [CountryCode.Us];
    this.api = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[opts.env],
        baseOptions: { headers: { 'PLAID-CLIENT-ID': opts.clientId, 'PLAID-SECRET': opts.secret, 'Plaid-Version': '2020-09-14' } },
      }),
    );
  }

  async createLinkToken(args: Parameters<PlaidGateway['createLinkToken']>[0]) {
    try {
      const { data } = await this.api.linkTokenCreate({
        client_name: 'Reclaimed',
        language: 'en',
        country_codes: this.countryCodes,
        user: { client_user_id: args.userId },
        ...(args.accessToken
          ? { access_token: args.accessToken } // update mode (repair an expired connection)
          : {
              products: this.products,
              ...(args.includeLiabilities && !this.products.includes(Products.Liabilities) ? { optional_products: [Products.Liabilities] } : {}),
            }),
        transactions: args.accessToken ? undefined : { days_requested: 90 },
        webhook: args.webhookUrl,
        redirect_uri: args.redirectUri,
        android_package_name: args.androidPackageName,
      });
      return { linkToken: data.link_token, expiration: data.expiration };
    } catch (err) {
      wrap(err);
    }
  }

  async exchangePublicToken(publicToken: string) {
    try {
      const { data } = await this.api.itemPublicTokenExchange({ public_token: publicToken });
      return { accessToken: data.access_token, itemId: data.item_id };
    } catch (err) {
      wrap(err);
    }
  }

  async getItem(accessToken: string) {
    try {
      const { data } = await this.api.itemGet({ access_token: accessToken });
      return {
        itemId: data.item.item_id,
        institutionId: data.item.institution_id ?? null,
        products: data.item.products ?? [],
        consentExpiresAt: data.item.consent_expiration_time ?? null,
      };
    } catch (err) {
      wrap(err);
    }
  }

  async getInstitutionName(institutionId: string) {
    try {
      const { data } = await this.api.institutionsGetById({ institution_id: institutionId, country_codes: this.countryCodes });
      return data.institution.name;
    } catch {
      return null;
    }
  }

  async getAccounts(accessToken: string) {
    try {
      const { data } = await this.api.accountsGet({ access_token: accessToken });
      return data.accounts.map((a) => ({
        accountId: a.account_id,
        name: a.name,
        officialName: a.official_name ?? null,
        mask: a.mask ?? null,
        type: a.type,
        subtype: a.subtype ?? null,
        current: a.balances.current ?? null,
        available: a.balances.available ?? null,
        limit: a.balances.limit ?? null,
        isoCurrencyCode: a.balances.iso_currency_code ?? null,
      }));
    } catch (err) {
      wrap(err);
    }
  }

  async syncTransactions(accessToken: string, cursor: string | null) {
    try {
      const { data } = await this.api.transactionsSync({ access_token: accessToken, cursor: cursor ?? undefined, count: 250 });
      return {
        added: data.added.map(mapTxn),
        modified: data.modified.map(mapTxn),
        removed: data.removed.map((r) => ({ transactionId: r.transaction_id })),
        nextCursor: data.next_cursor,
        hasMore: data.has_more,
      };
    } catch (err) {
      wrap(err);
    }
  }

  async getCreditLiabilities(accessToken: string) {
    try {
      const { data } = await this.api.liabilitiesGet({ access_token: accessToken });
      return (data.liabilities.credit ?? [])
        .filter((c) => c.account_id)
        .map((c) => ({
          accountId: c.account_id!,
          aprs: c.aprs.map((a) => ({ aprType: a.apr_type, aprPercentage: a.apr_percentage })),
          isOverdue: c.is_overdue,
          lastPaymentAmount: c.last_payment_amount,
          lastPaymentDate: c.last_payment_date,
          lastStatementIssueDate: c.last_statement_issue_date,
          lastStatementBalance: c.last_statement_balance,
          minimumPaymentAmount: c.minimum_payment_amount,
          nextPaymentDueDate: c.next_payment_due_date,
        }));
    } catch (err) {
      wrap(err);
    }
  }

  async removeItem(accessToken: string) {
    try {
      await this.api.itemRemove({ access_token: accessToken });
    } catch (err) {
      wrap(err);
    }
  }

  async getWebhookVerificationKey(keyId: string) {
    try {
      const { data } = await this.api.webhookVerificationKeyGet({ key_id: keyId });
      return data.key as unknown as Record<string, unknown>;
    } catch (err) {
      wrap(err);
    }
  }
}
