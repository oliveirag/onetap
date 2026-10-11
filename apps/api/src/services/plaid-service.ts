import { ReclaimedError, decimalToCents, type PlaidItemDto } from '@reclaimed/shared';
import type { Database, Queryable } from '@reclaimed/database';
import { PlaidApiError, type PlaidGateway, type PlaidTransaction, type SandboxCreditCard } from '../integrations/plaid/gateway.js';
import type { TokenCipher } from '../lib/crypto.js';
import type { Logger } from '../logger.js';
import type { CardMatchingService } from './card-matching.js';

const LOGIN_REQUIRED_CODES = new Set(['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'ACCESS_NOT_GRANTED', 'INVALID_CREDENTIALS']);
const UNSUPPORTED_PRODUCT_CODES = new Set(['PRODUCTS_NOT_SUPPORTED', 'PRODUCT_NOT_READY', 'NO_LIABILITY_ACCOUNTS', 'INVALID_PRODUCT', 'ADDITIONAL_CONSENT_REQUIRED']);

interface PlaidItemRow {
  id: string;
  user_id: string;
  plaid_item_id: string;
  access_token_ciphertext: string;
  institution_id: string | null;
  institution_name: string | null;
  status: PlaidItemDto['status'];
  products: string[];
}

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  skipped?: 'IN_PROGRESS';
}

/**
 * Plaid connectivity: link tokens, token exchange, account import, transaction
 * sync (/transactions/sync), liabilities, and disconnection. Access tokens are
 * encrypted at rest and never leave the backend.
 */
export class PlaidService {
  constructor(
    private readonly db: Database,
    private readonly gateway: PlaidGateway | null,
    private readonly cipher: TokenCipher | null,
    private readonly matching: CardMatchingService,
    private readonly logger: Logger,
    private readonly opts: {
      liabilitiesEnabled: boolean;
      webhookUrl?: string;
      redirectUri?: string;
      androidPackageName?: string;
    },
  ) {}

  get configured(): boolean {
    return Boolean(this.gateway && this.cipher);
  }

  private require(): { gateway: PlaidGateway; cipher: TokenCipher } {
    if (!this.gateway || !this.cipher) throw new ReclaimedError('PLAID_NOT_CONFIGURED');
    return { gateway: this.gateway, cipher: this.cipher };
  }

  async createLinkToken(
    userId: string,
    itemId?: string,
    platform?: 'ios' | 'android',
  ): Promise<{ linkToken: string; expiration: string; mode: 'create' | 'update' }> {
    const { gateway, cipher } = this.require();
    let accessToken: string | undefined;
    if (itemId) {
      const item = await this.ownedItem(this.db, userId, itemId);
      accessToken = cipher.decrypt(item.access_token_ciphertext);
    }
    const r = await this.call(() =>
      gateway.createLinkToken({
        userId,
        accessToken,
        webhookUrl: this.opts.webhookUrl,
        // Plaid rejects android_package_name unless it is registered in the dashboard, and
        // Android must not send redirect_uri — so each platform gets only its own field.
        redirectUri: platform === 'android' ? undefined : this.opts.redirectUri,
        androidPackageName: platform === 'android' ? this.opts.androidPackageName : undefined,
        includeLiabilities: this.opts.liabilitiesEnabled,
      }),
    );
    return { ...r, mode: accessToken ? 'update' : 'create' };
  }

  async exchangePublicToken(
    userId: string,
    publicToken: string,
    institution?: { id?: string | null; name?: string | null },
  ): Promise<{ itemId: string; accountsImported: number }> {
    const { gateway, cipher } = this.require();
    const { accessToken, itemId } = await this.call(() => gateway.exchangePublicToken(publicToken));
    const info = await this.call(() => gateway.getItem(accessToken));
    const institutionId = info.institutionId ?? institution?.id ?? null;
    const institutionName =
      institution?.name ?? (institutionId ? await gateway.getInstitutionName(institutionId) : null);

    const row = await this.db.transaction(async (tx) => {
      const existing = await tx.query<{ id: string; user_id: string }>('select id, user_id from plaid_items where plaid_item_id = $1', [itemId]);
      if (existing.rows[0] && existing.rows[0].user_id !== userId) throw new ReclaimedError('CONFLICT', 'This Plaid item belongs to another user.');
      const { rows } = await tx.query<{ id: string }>(
        `insert into plaid_items (user_id, plaid_item_id, access_token_ciphertext, institution_id, institution_name, products, consent_expires_at, status)
         values ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         on conflict (plaid_item_id) do update set access_token_ciphertext = excluded.access_token_ciphertext,
           status = 'ACTIVE', error_code = null, last_error = null, products = excluded.products
         returning id`,
        [userId, itemId, cipher.encrypt(accessToken), institutionId, institutionName, info.products, info.consentExpiresAt],
      );
      await tx.query('insert into plaid_sync_state (plaid_item_id) values ($1) on conflict do nothing', [rows[0]!.id]);
      return rows[0]!;
    });

    const accountsImported = await this.refreshAccounts(row.id);
    // Initial transaction sync and liabilities are best-effort; Plaid may still be preparing data.
    await this.syncTransactions(row.id).catch((err) => this.logger.warn({ err, itemId: row.id }, 'initial transaction sync deferred'));
    await this.refreshLiabilities(row.id).catch((err) => this.logger.warn({ err, itemId: row.id }, 'liabilities refresh skipped'));
    return { itemId: row.id, accountsImported };
  }

  /** PRD F2 fallback: links a Plaid Sandbox custom test user holding these credit cards, without Plaid Link. */
  async connectSandboxTestUser(userId: string, creditCards: SandboxCreditCard[]): Promise<{ itemId: string; accountsImported: number }> {
    const { gateway } = this.require();
    const institutionId = 'ins_109508'; // First Platypus Bank, a Plaid Sandbox institution
    const publicToken = await this.call(() => gateway.createSandboxPublicToken({ institutionId, creditCards }));
    return this.exchangePublicToken(userId, publicToken, { id: institutionId });
  }

  async listItems(userId: string): Promise<PlaidItemDto[]> {
    const { rows } = await this.db.query<{
      id: string;
      institution_id: string | null;
      institution_name: string | null;
      status: PlaidItemDto['status'];
      last_synced_at: Date | null;
      last_error: string | null;
      created_at: Date;
      account_count: number;
    }>(
      `select i.id, i.institution_id, i.institution_name, i.status, i.last_synced_at, i.last_error, i.created_at,
              (select count(*)::int from financial_accounts a where a.plaid_item_id = i.id and a.is_active) as account_count
         from plaid_items i where i.user_id = $1 and i.status <> 'REMOVED' order by i.created_at`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      institutionId: r.institution_id,
      institutionName: r.institution_name,
      status: r.status,
      lastSyncedAt: r.last_synced_at?.toISOString() ?? null,
      lastError: r.last_error,
      accountCount: r.account_count,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** Imports/updates accounts and balances for an item. Returns active account count. */
  async refreshAccounts(itemId: string): Promise<number> {
    const { gateway, cipher } = this.require();
    const item = await this.item(itemId);
    const accounts = await this.call(() => gateway.getAccounts(cipher.decrypt(item.access_token_ciphertext)), item.id);
    const ids: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const a of accounts) {
        const { rows } = await tx.query<{ id: string }>(
          `insert into financial_accounts (user_id, plaid_item_id, plaid_account_id, name, official_name, mask, type, subtype,
              current_balance_cents, available_balance_cents, credit_limit_cents, iso_currency_code, balance_updated_at, is_active)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), true)
           on conflict (plaid_account_id) do update set name = excluded.name, official_name = excluded.official_name,
             mask = excluded.mask, type = excluded.type, subtype = excluded.subtype,
             current_balance_cents = excluded.current_balance_cents, available_balance_cents = excluded.available_balance_cents,
             credit_limit_cents = excluded.credit_limit_cents, iso_currency_code = excluded.iso_currency_code,
             balance_updated_at = now(), is_active = true
           where financial_accounts.user_id = excluded.user_id
           returning id`,
          [item.user_id, item.id, a.accountId, a.name, a.officialName, a.mask?.slice(-4) ?? null, a.type, a.subtype,
            decimalToCents(a.current), decimalToCents(a.available), decimalToCents(a.limit), a.isoCurrencyCode],
        );
        if (rows[0]) ids.push(rows[0].id);
      }
      await tx.query(
        `update financial_accounts set is_active = false where plaid_item_id = $1 and not (id = any($2::uuid[]))`,
        [item.id, ids],
      );
    });
    for (const id of ids) await this.matching.autoMatch(id);
    return ids.length;
  }

  /**
   * /transactions/sync with cursor persistence and pagination. Pages are accumulated
   * and applied atomically with the new cursor, so a failure mid-way is safely retried
   * from the previous cursor. Duplicate delivery is harmless (upsert on plaid id).
   */
  async syncTransactions(itemId: string): Promise<SyncResult> {
    const { gateway, cipher } = this.require();
    const item = await this.item(itemId);
    const lock = await this.db.query<{ transactions_cursor: string | null }>(
      `update plaid_sync_state set sync_in_progress = true, last_sync_started_at = now()
        where plaid_item_id = $1 and (not sync_in_progress or last_sync_started_at < now() - interval '5 minutes')
        returning transactions_cursor`,
      [item.id],
    );
    if (!lock.rows[0]) return { added: 0, modified: 0, removed: 0, skipped: 'IN_PROGRESS' };
    const startCursor = lock.rows[0].transactions_cursor;
    const accessToken = cipher.decrypt(item.access_token_ciphertext);

    try {
      let added: PlaidTransaction[] = [];
      let modified: PlaidTransaction[] = [];
      let removed: { transactionId: string }[] = [];
      let cursor = startCursor;
      for (let restarts = 0; ; ) {
        try {
          let hasMore = true;
          while (hasMore) {
            const page = await gateway.syncTransactions(accessToken, cursor);
            added = added.concat(page.added);
            modified = modified.concat(page.modified);
            removed = removed.concat(page.removed);
            cursor = page.nextCursor;
            hasMore = page.hasMore;
          }
          break;
        } catch (err) {
          if (err instanceof PlaidApiError && err.errorCode === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && restarts < 3) {
            restarts += 1;
            added = [];
            modified = [];
            removed = [];
            cursor = startCursor;
            continue;
          }
          throw err;
        }
      }

      await this.db.transaction(async (tx) => {
        const accountMap = await this.accountMap(tx, item.id);
        for (const t of [...added, ...modified]) {
          const accountId = accountMap.get(t.accountId);
          if (!accountId) continue; // account not shared with Reclaimed
          await tx.query(
            `insert into transactions (user_id, financial_account_id, plaid_transaction_id, pending_transaction_id, name, merchant_name,
                amount_cents, iso_currency_code, date, authorized_date, pending, category, payment_channel)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             on conflict (plaid_transaction_id) do update set financial_account_id = excluded.financial_account_id,
               pending_transaction_id = excluded.pending_transaction_id, name = excluded.name, merchant_name = excluded.merchant_name,
               amount_cents = excluded.amount_cents, iso_currency_code = excluded.iso_currency_code, date = excluded.date,
               authorized_date = excluded.authorized_date, pending = excluded.pending, category = excluded.category,
               payment_channel = excluded.payment_channel`,
            [item.user_id, accountId, t.transactionId, t.pendingTransactionId, t.name, t.merchantName, decimalToCents(t.amount),
              t.isoCurrencyCode, t.date, t.authorizedDate, t.pending, t.category, t.paymentChannel],
          );
        }
        if (removed.length) {
          await tx.query('delete from transactions where user_id = $1 and plaid_transaction_id = any($2::text[])', [
            item.user_id,
            removed.map((r) => r.transactionId),
          ]);
        }
        await tx.query(
          `update plaid_sync_state set transactions_cursor = $2, sync_in_progress = false, last_sync_completed_at = now(),
                  last_sync_status = 'SUCCESS', last_sync_error = null, added_count = $3, modified_count = $4, removed_count = $5
            where plaid_item_id = $1`,
          [item.id, cursor, added.length, modified.length, removed.length],
        );
        await tx.query(`update plaid_items set last_synced_at = now(), status = case when status = 'ERROR' then 'ACTIVE' else status end where id = $1`, [item.id]);
      });
      return { added: added.length, modified: modified.length, removed: removed.length };
    } catch (err) {
      await this.db.query(
        `update plaid_sync_state set sync_in_progress = false, last_sync_status = 'FAILED', last_sync_error = $2 where plaid_item_id = $1`,
        [item.id, err instanceof Error ? err.message.slice(0, 500) : 'unknown'],
      );
      throw this.mapError(err, item.id);
    }
  }

  /** Optional (ENABLE_PLAID_LIABILITIES). Missing fields are stored as null — never invented. */
  async refreshLiabilities(itemId: string): Promise<number> {
    if (!this.opts.liabilitiesEnabled) return 0;
    const { gateway, cipher } = this.require();
    const item = await this.item(itemId);
    let liabilities;
    try {
      liabilities = await gateway.getCreditLiabilities(cipher.decrypt(item.access_token_ciphertext));
    } catch (err) {
      if (err instanceof PlaidApiError && UNSUPPORTED_PRODUCT_CODES.has(err.errorCode)) {
        this.logger.info({ itemId, code: err.errorCode }, 'liabilities not available for item');
        return 0;
      }
      throw this.mapError(err, item.id);
    }
    let n = 0;
    await this.db.transaction(async (tx) => {
      const accountMap = await this.accountMap(tx, item.id);
      for (const l of liabilities) {
        const accountId = accountMap.get(l.accountId);
        if (!accountId) continue;
        await tx.query(
          `insert into account_liabilities (financial_account_id, user_id, last_statement_balance_cents, minimum_payment_cents,
              next_payment_due_date, last_statement_issue_date, last_payment_amount_cents, last_payment_date, aprs, is_overdue, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           on conflict (financial_account_id) do update set last_statement_balance_cents = excluded.last_statement_balance_cents,
             minimum_payment_cents = excluded.minimum_payment_cents, next_payment_due_date = excluded.next_payment_due_date,
             last_statement_issue_date = excluded.last_statement_issue_date, last_payment_amount_cents = excluded.last_payment_amount_cents,
             last_payment_date = excluded.last_payment_date, aprs = excluded.aprs, is_overdue = excluded.is_overdue, updated_at = now()`,
          [accountId, item.user_id, decimalToCents(l.lastStatementBalance), decimalToCents(l.minimumPaymentAmount), l.nextPaymentDueDate,
            l.lastStatementIssueDate, decimalToCents(l.lastPaymentAmount), l.lastPaymentDate, JSON.stringify(l.aprs), l.isOverdue],
        );
        n += 1;
      }
    });
    return n;
  }

  /** Revokes the item at Plaid (best effort) and deletes its local data. */
  async removeItem(userId: string, itemId: string): Promise<void> {
    const { gateway, cipher } = this.require();
    const item = await this.ownedItem(this.db, userId, itemId);
    try {
      await gateway.removeItem(cipher.decrypt(item.access_token_ciphertext));
    } catch (err) {
      // Already-invalid items cannot be removed upstream; local deletion must still happen.
      this.logger.warn({ err, itemId }, 'Plaid item/remove failed; deleting locally');
    }
    await this.db.query('delete from plaid_items where id = $1 and user_id = $2', [item.id, userId]);
  }

  async removeAllForUser(userId: string): Promise<void> {
    const { rows } = await this.db.query<{ id: string }>('select id from plaid_items where user_id = $1', [userId]);
    for (const r of rows) await this.removeItem(userId, r.id);
  }

  async markItemStatus(plaidItemId: string, status: PlaidItemDto['status'], errorCode: string | null, message: string | null): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(
      `update plaid_items set status = $2, error_code = $3, last_error = $4 where plaid_item_id = $1 returning id`,
      [plaidItemId, status, errorCode, message],
    );
    return rows[0]?.id ?? null;
  }

  async findItemByPlaidId(plaidItemId: string): Promise<{ id: string; user_id: string } | null> {
    const { rows } = await this.db.query<{ id: string; user_id: string }>('select id, user_id from plaid_items where plaid_item_id = $1', [plaidItemId]);
    return rows[0] ?? null;
  }

  async ownedItem(db: Queryable, userId: string, itemId: string): Promise<PlaidItemRow> {
    const { rows } = await db.query<PlaidItemRow>(`select * from plaid_items where id = $1 and user_id = $2 and status <> 'REMOVED'`, [itemId, userId]);
    if (!rows[0]) throw new ReclaimedError('NOT_FOUND', 'Institution connection not found.');
    return rows[0];
  }

  private async item(itemId: string): Promise<PlaidItemRow> {
    const { rows } = await this.db.query<PlaidItemRow>('select * from plaid_items where id = $1', [itemId]);
    if (!rows[0]) throw new ReclaimedError('NOT_FOUND', 'Institution connection not found.');
    return rows[0];
  }

  private async accountMap(tx: Queryable, itemId: string): Promise<Map<string, string>> {
    const { rows } = await tx.query<{ id: string; plaid_account_id: string }>(
      'select id, plaid_account_id from financial_accounts where plaid_item_id = $1',
      [itemId],
    );
    return new Map(rows.map((r) => [r.plaid_account_id, r.id]));
  }

  private async call<T>(fn: () => Promise<T>, itemId?: string): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw await this.mapErrorAndMark(err, itemId);
    }
  }

  private async mapErrorAndMark(err: unknown, itemId?: string): Promise<ReclaimedError> {
    if (itemId && err instanceof PlaidApiError && LOGIN_REQUIRED_CODES.has(err.errorCode)) {
      await this.db.query(`update plaid_items set status = 'LOGIN_REQUIRED', error_code = $2, last_error = $3 where id = $1`, [
        itemId,
        err.errorCode,
        err.message,
      ]);
    }
    return this.mapError(err, itemId);
  }

  private mapError(err: unknown, itemId?: string): ReclaimedError {
    if (err instanceof ReclaimedError) return err;
    if (err instanceof PlaidApiError) {
      if (LOGIN_REQUIRED_CODES.has(err.errorCode)) {
        if (itemId) {
          void this.db
            .query(`update plaid_items set status = 'LOGIN_REQUIRED', error_code = $2, last_error = $3 where id = $1`, [itemId, err.errorCode, err.message])
            .catch(() => undefined);
        }
        return new ReclaimedError('PLAID_ITEM_LOGIN_REQUIRED', undefined, { details: { plaidErrorCode: err.errorCode } });
      }
      return new ReclaimedError('PLAID_CONNECTION_FAILED', `Plaid error: ${err.errorCode}`, {
        details: { plaidErrorCode: err.errorCode, plaidErrorType: err.errorType },
        retryable: err.errorType === 'RATE_LIMIT_EXCEEDED' || err.errorType === 'API_ERROR' || err.errorType === 'NETWORK_ERROR',
      });
    }
    return new ReclaimedError('INTERNAL_ERROR', undefined, { cause: err });
  }
}
