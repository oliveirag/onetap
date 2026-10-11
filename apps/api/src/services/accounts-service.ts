import { ReclaimedError, type BankTransactionDto, type FinancialAccountDto, type LiabilityDto, type Page } from '@reclaimed/shared';
import type { Database } from '@reclaimed/database';
import { toCardProductDto, type CardProductRow } from '@reclaimed/payment-core';
import { decodeCursor, encodeCursor } from '../lib/http.js';

interface AccountRow {
  id: string;
  plaid_item_id: string;
  institution_name: string | null;
  item_status: FinancialAccountDto['connectionStatus'];
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance_cents: number | null;
  available_balance_cents: number | null;
  credit_limit_cents: number | null;
  iso_currency_code: string | null;
  balance_updated_at: Date | null;
  cp_id: string | null;
  issuer_name: string | null;
  product_name: string | null;
  product_slug: string | null;
  card_network: CardProductRow['card_network'] | null;
  confirmed_by_user: boolean | null;
}

const ACCOUNT_SELECT = `
  select a.id, a.plaid_item_id, i.institution_name, i.status as item_status, a.name, a.official_name, a.mask, a.type, a.subtype,
         a.current_balance_cents, a.available_balance_cents, a.credit_limit_cents, a.iso_currency_code, a.balance_updated_at,
         cp.id as cp_id, cp.issuer_name, cp.product_name, cp.product_slug, cp.card_network, uc.confirmed_by_user
    from financial_accounts a
    join plaid_items i on i.id = a.plaid_item_id
    left join user_cards uc on uc.financial_account_id = a.id
    left join card_products cp on cp.id = uc.card_product_id`;

export function toAccountDto(r: AccountRow): FinancialAccountDto {
  return {
    id: r.id,
    plaidItemId: r.plaid_item_id,
    institutionName: r.institution_name,
    name: r.name,
    officialName: r.official_name,
    mask: r.mask,
    type: r.type,
    subtype: r.subtype,
    currentBalanceCents: r.current_balance_cents,
    availableBalanceCents: r.available_balance_cents,
    creditLimitCents: r.credit_limit_cents,
    isoCurrencyCode: r.iso_currency_code,
    balanceUpdatedAt: r.balance_updated_at?.toISOString() ?? null,
    connectionStatus: r.item_status,
    cardProduct: r.cp_id
      ? toCardProductDto({ id: r.cp_id, issuer_name: r.issuer_name!, product_name: r.product_name!, product_slug: r.product_slug!, card_network: r.card_network! })
      : null,
    cardProductConfirmed: Boolean(r.confirmed_by_user),
  };
}

/** Read-only views over Plaid-REPORTED data. Simulated activity is never mixed in. */
export class AccountsService {
  constructor(private readonly db: Database) {}

  async list(userId: string, opts: { type?: string } = {}): Promise<FinancialAccountDto[]> {
    const { rows } = await this.db.query<AccountRow>(
      `${ACCOUNT_SELECT} where a.user_id = $1 and a.is_active and i.status <> 'REMOVED' and ($2::text is null or a.type = $2)
       order by i.institution_name nulls last, a.type, a.name`,
      [userId, opts.type ?? null],
    );
    return rows.map(toAccountDto);
  }

  async get(userId: string, id: string): Promise<FinancialAccountDto> {
    const { rows } = await this.db.query<AccountRow>(`${ACCOUNT_SELECT} where a.id = $1 and a.user_id = $2`, [id, userId]);
    if (!rows[0]) throw new ReclaimedError('NOT_FOUND', 'Account not found.');
    return toAccountDto(rows[0]);
  }

  async liability(userId: string, accountId: string): Promise<LiabilityDto | null> {
    await this.get(userId, accountId);
    const { rows } = await this.db.query<{
      financial_account_id: string; last_statement_balance_cents: number | null; minimum_payment_cents: number | null;
      next_payment_due_date: string | null; last_statement_issue_date: string | null; aprs: { aprType: string; aprPercentage: number }[];
      is_overdue: boolean | null; updated_at: Date;
    }>('select * from account_liabilities where financial_account_id = $1 and user_id = $2', [accountId, userId]);
    const l = rows[0];
    if (!l) return null;
    return {
      financialAccountId: l.financial_account_id,
      lastStatementBalanceCents: l.last_statement_balance_cents,
      minimumPaymentCents: l.minimum_payment_cents,
      nextPaymentDueDate: l.next_payment_due_date,
      lastStatementIssueDate: l.last_statement_issue_date,
      aprs: l.aprs ?? [],
      isOverdue: l.is_overdue,
      updatedAt: l.updated_at.toISOString(),
    };
  }

  async transactions(
    userId: string,
    opts: { accountId?: string; search?: string; limit: number; cursor?: string },
  ): Promise<Page<BankTransactionDto>> {
    const c = decodeCursor(opts.cursor);
    // Keyset on (date desc, id desc); the cursor's createdAt carries the date.
    const { rows } = await this.db.query<{
      id: string; financial_account_id: string; account_name: string | null; name: string; merchant_name: string | null;
      amount_cents: number; iso_currency_code: string | null; date: string; pending: boolean; category: string | null;
    }>(
      `select t.id, t.financial_account_id, a.name as account_name, t.name, t.merchant_name, t.amount_cents, t.iso_currency_code,
              t.date, t.pending, t.category
         from transactions t join financial_accounts a on a.id = t.financial_account_id
        where t.user_id = $1
          and ($2::uuid is null or t.financial_account_id = $2)
          and ($3::text is null or t.name ilike '%' || $3 || '%' or t.merchant_name ilike '%' || $3 || '%')
          and ($4::date is null or (t.date, t.id) < ($4::date, $5::uuid))
        order by t.date desc, t.id desc
        limit $6`,
      [userId, opts.accountId ?? null, opts.search || null, c ? c.createdAt.slice(0, 10) : null, c?.id ?? null, opts.limit + 1],
    );
    const items = rows.slice(0, opts.limit).map((t) => ({
      id: t.id,
      financialAccountId: t.financial_account_id,
      accountName: t.account_name,
      name: t.name,
      merchantName: t.merchant_name,
      amountCents: t.amount_cents,
      isoCurrencyCode: t.iso_currency_code,
      date: t.date,
      pending: t.pending,
      category: t.category,
    }));
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > opts.limit && last ? encodeCursor(`${last.date}T00:00:00Z`, last.id) : null };
  }
}
