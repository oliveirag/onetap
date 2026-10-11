import { randomInt } from 'node:crypto';
import {
  ReclaimedError,
  type CreateMockFundingAccountInput,
  type MockFundingAccountDto,
  type Page,
  type ReclaimedCardDto,
  type SimulatedTransactionDto,
  type UpdateCardFundingInput,
  type UserSettableCardStatus,
} from '@reclaimed/shared';
import type { Database } from '@reclaimed/database';
import {
  listMockFundingDtos,
  toReclaimedCardDto,
  toTransactionDto,
  type PaymentTransactionRow,
  type ReclaimedCardRow,
} from '@reclaimed/payment-core';
import { decodeCursor, encodeCursor } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import type { LithicGateway } from '../integrations/lithic/lithic.js';

const ALLOWED_STATUS_CHANGES: Record<string, UserSettableCardStatus[]> = {
  ACTIVE: ['FROZEN', 'REVOKED'],
  FROZEN: ['ACTIVE', 'REVOKED'],
  UNREGISTERED: ['REVOKED'],
  DISABLED: ['REVOKED'],
  REVOKED: [],
};

/** Reclaimed test cards, their simulated funding configuration, and mock funding accounts. */
export class CardsService {
  constructor(
    private readonly db: Database,
    private readonly lithic: LithicGateway | null,
  ) {}

  async list(userId: string): Promise<ReclaimedCardDto[]> {
    const { rows } = await this.db.query<ReclaimedCardRow>(
      `select * from reclaimed_cards where user_id = $1 and status <> 'REVOKED' order by created_at desc`,
      [userId],
    );
    return rows.map(toReclaimedCardDto);
  }

  async get(userId: string, id: string): Promise<ReclaimedCardDto> {
    return toReclaimedCardDto(await this.row(userId, id));
  }

  private async row(userId: string, id: string): Promise<ReclaimedCardRow> {
    const { rows } = await this.db.query<ReclaimedCardRow>('select * from reclaimed_cards where id = $1 and user_id = $2', [id, userId]);
    if (!rows[0]) throw new ReclaimedError('NOT_FOUND', 'Reclaimed card not found.');
    return rows[0];
  }

  async setStatus(userId: string, id: string, status: UserSettableCardStatus, requestId?: string): Promise<ReclaimedCardDto> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<ReclaimedCardRow>('select * from reclaimed_cards where id = $1 and user_id = $2 for update', [id, userId]);
      const card = rows[0];
      if (!card) throw new ReclaimedError('NOT_FOUND', 'Reclaimed card not found.');
      if (card.status === status) return toReclaimedCardDto(card);
      if (!ALLOWED_STATUS_CHANGES[card.status]?.includes(status)) {
        throw new ReclaimedError('CONFLICT', `A ${card.status} card cannot become ${status}.`);
      }
      const updated = (
        await tx.query<ReclaimedCardRow>(
          `update reclaimed_cards set status = $3, revoked_at = case when $3 = 'REVOKED' then now() else revoked_at end
            where id = $1 and user_id = $2 returning *`,
          [id, userId, status],
        )
      ).rows[0]!;
      await audit(tx, { actorType: 'user', actorId: userId, userId, action: `reclaimed_card.${status.toLowerCase()}`, entityType: 'reclaimed_card', entityId: id, metadata: { from: card.status }, requestId });
      return toReclaimedCardDto(updated);
    });
  }

  async setFunding(userId: string, id: string, input: UpdateCardFundingInput): Promise<ReclaimedCardDto> {
    await this.row(userId, id);
    for (const fid of [input.primaryFundingAccountId, input.secondaryFundingAccountId]) {
      if (!fid) continue;
      const ok = await this.db.query(`select 1 from mock_funding_accounts where id = $1 and user_id = $2 and status <> 'CLOSED'`, [fid, userId]);
      if (!ok.rowCount) throw new ReclaimedError('NOT_FOUND', 'Mock funding account not found.');
    }
    const { rows } = await this.db.query<ReclaimedCardRow>(
      `update reclaimed_cards set primary_funding_account_id = $3, secondary_funding_account_id = $4, fallback_enabled = $5,
              per_transaction_limit_cents = coalesce($6, per_transaction_limit_cents), daily_limit_cents = coalesce($7, daily_limit_cents)
        where id = $1 and user_id = $2 returning *`,
      [id, userId, input.primaryFundingAccountId, input.secondaryFundingAccountId, input.fallbackEnabled, input.perTransactionLimitCents ?? null, input.dailyLimitCents ?? null],
    );
    return toReclaimedCardDto(rows[0]!);
  }

  /** Simulated (Reclaimed) transactions for the user, optionally for one card. Never includes Plaid data. */
  async transactions(
    userId: string,
    opts: { cardId?: string; search?: string; limit: number; cursor?: string },
  ): Promise<Page<SimulatedTransactionDto>> {
    if (opts.cardId) await this.row(userId, opts.cardId);
    const c = decodeCursor(opts.cursor);
    const { rows } = await this.db.query<PaymentTransactionRow>(
      `select * from payment_transactions
        where user_id = $1
          and ($2::uuid is null or reclaimed_card_id = $2)
          and ($3::text is null or merchant_name ilike '%' || $3 || '%' or reference ilike '%' || $3 || '%')
          and ($4::timestamptz is null or (created_at, id) < ($4::timestamptz, $5::uuid))
        order by created_at desc, id desc limit $6`,
      [userId, opts.cardId ?? null, opts.search || null, c?.createdAt ?? null, c?.id ?? null, opts.limit + 1],
    );
    const items = rows.slice(0, opts.limit);
    const last = items[items.length - 1];
    return { items: items.map(toTransactionDto), nextCursor: rows.length > opts.limit && last ? encodeCursor(last.created_at, last.id) : null };
  }

  async simulatedTransaction(userId: string, id: string): Promise<SimulatedTransactionDto> {
    const { rows } = await this.db.query<PaymentTransactionRow>('select * from payment_transactions where id = $1 and user_id = $2', [id, userId]);
    if (!rows[0]) throw new ReclaimedError('NOT_FOUND', 'Transaction not found.');
    return toTransactionDto(rows[0]);
  }

  async ledgerForTransaction(userId: string, id: string) {
    await this.simulatedTransaction(userId, id);
    const { rows } = await this.db.query<{ id: string; journal_type: string; description: string; created_at: Date; code: string; direction: 'DEBIT' | 'CREDIT'; amount_cents: number }>(
      `select j.id, j.journal_type, j.description, j.created_at, a.code, e.direction, e.amount_cents
         from ledger_journals j join ledger_entries e on e.journal_id = j.id join ledger_accounts a on a.id = e.ledger_account_id
        where j.payment_transaction_id = $1 order by j.created_at, j.id, e.direction desc`,
      [id],
    );
    const journals = new Map<string, { id: string; journalType: string; description: string; createdAt: string; entries: { ledgerAccountCode: string; direction: 'DEBIT' | 'CREDIT'; amountCents: number }[] }>();
    for (const r of rows) {
      const j = journals.get(r.id) ?? { id: r.id, journalType: r.journal_type, description: r.description, createdAt: r.created_at.toISOString(), entries: [] };
      j.entries.push({ ledgerAccountCode: r.code.replace(/:[0-9a-f-]{36}$/, ''), direction: r.direction, amountCents: r.amount_cents });
      journals.set(r.id, j);
    }
    return [...journals.values()];
  }

  // ---------- Mock funding accounts ----------
  async listFunding(userId: string): Promise<MockFundingAccountDto[]> {
    return listMockFundingDtos(this.db, userId);
  }

  /** `extra.last4` is the real account's mask (e.g. from Plaid); otherwise a random fictional one. */
  async createFunding(userId: string, input: CreateMockFundingAccountInput, extra: { last4?: string | null } = {}): Promise<MockFundingAccountDto> {
    if (input.cardProductId) {
      const p = await this.db.query('select 1 from card_products where id = $1', [input.cardProductId]);
      if (!p.rowCount) throw new ReclaimedError('NOT_FOUND', 'Card product not found.');
    }
    const priority =
      input.priority ??
      ((await this.db.query<{ p: number }>(`select coalesce(max(priority), 0)::int + 1 as p from mock_funding_accounts where user_id = $1 and status <> 'CLOSED'`, [userId])).rows[0]?.p ?? 1);
    const { rows } = await this.db.query<{ id: string }>(
      `insert into mock_funding_accounts (user_id, display_name, fictional_issuer, kind, card_product_id, credit_limit_cents, current_balance_cents, priority, last4)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [userId, input.displayName, input.fictionalIssuer, input.kind, input.cardProductId ?? null,
        input.kind === 'CREDIT' ? input.limitOrBalanceCents : 0, input.kind === 'DEPOSIT' ? input.limitOrBalanceCents : 0, Math.min(priority, 99),
        /^\d{4}$/.test(extra.last4 ?? '') ? extra.last4 : String(randomInt(0, 10_000)).padStart(4, '0')],
    );
    return (await this.listFunding(userId)).find((f) => f.id === rows[0]!.id)!;
  }

  async updateFunding(
    userId: string,
    id: string,
    input: { displayName?: string; status?: string; creditLimitCents?: number; currentBalanceCents?: number },
  ): Promise<MockFundingAccountDto> {
    const { rowCount } = await this.db.query(
      `update mock_funding_accounts set display_name = coalesce($3, display_name), status = coalesce($4, status),
              credit_limit_cents = coalesce($5, credit_limit_cents), current_balance_cents = coalesce($6, current_balance_cents)
        where id = $1 and user_id = $2`,
      [id, userId, input.displayName ?? null, input.status ?? null, input.creditLimitCents ?? null, input.currentBalanceCents ?? null],
    );
    if (!rowCount) throw new ReclaimedError('NOT_FOUND', 'Mock funding account not found.');
    const out = (await this.listFunding(userId)).find((f) => f.id === id);
    if (!out) throw new ReclaimedError('NOT_FOUND', 'Mock funding account not found.');
    return out;
  }

  /**
   * Demo convenience: creates "Mock Citi" (Citi Double Cash, $2,000 limit, priority 1) and
   * "Mock Chase" (Chase Sapphire Preferred, $5,000 limit, priority 2) if missing, and sets them
   * as primary / secondary on the given card with fallback enabled. Fictional accounts only.
   */
  async demoSetup(userId: string, cardId?: string): Promise<{ funding: MockFundingAccountDto[]; card: ReclaimedCardDto | null }> {
    const products = await this.db.query<{ id: string; product_slug: string }>(
      `select id, product_slug from card_products where product_slug in ('citi-double-cash', 'chase-sapphire-preferred')`,
    );
    const bySlug = new Map(products.rows.map((p) => [p.product_slug, p.id]));
    const ensure = async (name: string, issuer: string, slug: string, limit: number, priority: number) => {
      const existing = await this.db.query<{ id: string }>(
        `select id from mock_funding_accounts where user_id = $1 and display_name = $2 and status <> 'CLOSED'`,
        [userId, name],
      );
      if (existing.rows[0]) return existing.rows[0].id;
      const f = await this.createFunding(userId, { displayName: name, fictionalIssuer: issuer, kind: 'CREDIT', cardProductId: bySlug.get(slug) ?? null, limitOrBalanceCents: limit, priority });
      return f.id;
    };
    const citi = await ensure('Mock Citi', 'Mock Citi (fictional)', 'citi-double-cash', 200_000, 1);
    const chase = await ensure('Mock Chase', 'Mock Chase (fictional)', 'chase-sapphire-preferred', 500_000, 2);
    const checking = await this.db.query(`select 1 from mock_funding_accounts where user_id = $1 and display_name = 'Mock Checking'`, [userId]);
    if (!checking.rowCount) {
      await this.createFunding(userId, { displayName: 'Mock Checking', fictionalIssuer: 'Mock Bank (fictional)', kind: 'DEPOSIT', limitOrBalanceCents: 300_000, priority: 3 });
    }
    let card: ReclaimedCardDto | null = null;
    const target = cardId ?? (await this.list(userId))[0]?.id;
    if (target) card = await this.setFunding(userId, target, { primaryFundingAccountId: citi, secondaryFundingAccountId: chase, fallbackEnabled: true });
    return { funding: await this.listFunding(userId), card };
  }

  /** Maps a Reclaimed test card to a NEW Lithic Sandbox virtual card (token stored, PAN never stored). */
  async provisionLithicCard(userId: string, id: string): Promise<ReclaimedCardDto> {
    if (!this.lithic) throw new ReclaimedError('LITHIC_NOT_CONFIGURED');
    const card = await this.row(userId, id);
    if (card.lithic_card_token) return toReclaimedCardDto(card);
    let token: string;
    try {
      token = (await this.lithic.createVirtualCard(`Reclaimed ${card.display_id}`)).token;
    } catch (err) {
      throw new ReclaimedError('LITHIC_REQUEST_FAILED', undefined, { cause: err });
    }
    const { rows } = await this.db.query<ReclaimedCardRow>('update reclaimed_cards set lithic_card_token = $2 where id = $1 returning *', [id, token]);
    return toReclaimedCardDto(rows[0]!);
  }
}
