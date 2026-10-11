import type { Database } from '@reclaimed/database';
import { newCardDisplayId } from '@reclaimed/payment-core';
import { ReclaimedError } from '@reclaimed/shared';
import type { Logger } from '../logger.js';
import type { CardsService } from './cards-service.js';
import type { HardwareService } from './hardware-service.js';

/** The app's onetap_cards row (shared/contracts.ts OneTapCardRow). Only the last four reach the app. */
export interface OneTapCardDto {
  id: string;
  last4: string;
  state: 'open' | 'paused';
  /** The physical NFC card is attached to this OneTap card. */
  physical_linked: boolean;
}

export interface ConnectCardsDto {
  /** One routable card per credit account the user connected through Plaid, in card order. */
  cardIds: string[];
}

interface PlaidCreditAccount {
  id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  current_balance_cents: number | null;
  available_balance_cents: number | null;
  credit_limit_cents: number | null;
  institution_name: string | null;
  card_product_id: string | null;
  funding_id: string | null;
}

/**
 * Backend side of the OneTap app's setup flow (mobile/src/lib/api.ts):
 * turn the credit cards the user connected through Plaid into routable cards, then link the
 * physical OneTap (NFC) card. Each card the app shows is a mock_funding_accounts row (the
 * account the router charges), linked to the Plaid account it came from.
 */
export class OneTapService {
  constructor(
    private readonly db: Database,
    private readonly deps: { cards: CardsService; hardware: HardwareService; logger: Logger },
    private readonly opts: { enrollmentEnabled: boolean; enrollmentWaitMs: number; pollMs?: number },
  ) {}

  /**
   * Creates or refreshes one routable card per active Plaid credit account. Everything shown
   * (name, last four, balance, limit) comes from Plaid; the product match comes from Plaid
   * matching (user_cards) or the catalog keywords. Idempotent: re-running updates balances.
   */
  async connectCards(userId: string): Promise<ConnectCardsDto> {
    const { rows } = await this.db.query<PlaidCreditAccount>(
      `select a.id, a.name, a.official_name, a.mask, a.current_balance_cents, a.available_balance_cents, a.credit_limit_cents,
              i.institution_name, uc.card_product_id, m.id as funding_id
         from financial_accounts a
         join plaid_items i on i.id = a.plaid_item_id
         left join user_cards uc on uc.financial_account_id = a.id
         left join mock_funding_accounts m on m.financial_account_id = a.id
        where a.user_id = $1 and a.type = 'credit' and a.is_active and i.status <> 'REMOVED'
        order by i.created_at, a.created_at, coalesce(a.official_name, a.name), a.id`,
      [userId],
    );
    if (rows.length === 0) throw new ReclaimedError('NO_CREDIT_CARDS_CONNECTED');

    const cardIds: string[] = [];
    for (const a of rows) {
      const balance = a.current_balance_cents ?? 0;
      // Plaid reports the limit for most cards; otherwise balance + available credit.
      const limit = a.credit_limit_cents ?? (a.available_balance_cents != null ? balance + a.available_balance_cents : 0);
      const name = (a.official_name ?? a.name).slice(0, 80);
      if (a.funding_id) {
        await this.db.query(
          `update mock_funding_accounts set display_name = $2, last4 = coalesce($3, last4), current_balance_cents = $4, credit_limit_cents = $5
            where id = $1 and user_id = $6`,
          [a.funding_id, name, validLast4(a.mask), balance, limit, userId],
        );
        cardIds.push(a.funding_id);
        continue;
      }
      const funding = await this.deps.cards.createFunding(
        userId,
        {
          displayName: name,
          fictionalIssuer: (a.institution_name ?? 'Plaid').slice(0, 80),
          kind: 'CREDIT',
          cardProductId: a.card_product_id ?? (await this.matchProduct(a.official_name ?? a.name)),
          limitOrBalanceCents: limit,
        },
        { last4: validLast4(a.mask) },
      );
      await this.db.query('update mock_funding_accounts set current_balance_cents = $2, financial_account_id = $3 where id = $1', [funding.id, balance, a.id]);
      cardIds.push(funding.id);
    }
    // The first card is the baseline each routing decision is compared with, until the user picks one.
    await this.db.query('update profiles set default_card_id = coalesce(default_card_id, $2) where id = $1', [userId, cardIds[0]]);
    this.deps.logger.info({ userId, cards: cardIds.length }, 'onetap cards connected from plaid');
    return { cardIds };
  }

  /**
   * The user's OneTap card: one card, digital and physical. Created digital right away (no tap);
   * the physical NFC card is attached to it later (linkPhysical, or the operator script).
   */
  async card(userId: string): Promise<OneTapCardDto> {
    const current = await this.currentCard(userId);
    if (current) return current;
    const { rows } = await this.db.query<CardRow>(
      `insert into reclaimed_cards (user_id, display_id, nickname, status)
       values ($1, $2, 'OneTap', 'ACTIVE')
       on conflict do nothing
       returning id, display_id, status, uid_masked`,
      [userId, newCardDisplayId()],
    );
    // A concurrent request created it first (one live digital card per user): return that one.
    const created = rows[0] ? toOneTapCardDto(rows[0]) : await this.currentCard(userId);
    this.deps.logger.info({ userId }, 'onetap digital card created');
    return created!;
  }

  /**
   * Attaches the physical NFC card to the user's OneTap card: opens an enrollment session and waits
   * for the card to be tapped on the reader (the hardware bridge reports the tap).
   */
  async linkPhysical(userId: string): Promise<OneTapCardDto> {
    const card = await this.card(userId);
    if (card.physical_linked) return card;
    if (!this.opts.enrollmentEnabled) {
      throw new ReclaimedError('FEATURE_DISABLED', 'Linking a physical card is development-only. Set HARDWARE_TEST_MODE=true on the API.');
    }
    const enrollment = await this.deps.hardware.startEnrollment(userId, { nickname: 'OneTap' });
    const deadline = Date.now() + this.opts.enrollmentWaitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 250));
      const e = await this.deps.hardware.getEnrollment(userId, enrollment.id);
      if (e.status === 'COMPLETED') return (await this.currentCard(userId)) ?? card;
      if (e.status === 'FAILED') {
        throw e.failureReason === 'CARD_ALREADY_ENROLLED'
          ? new ReclaimedError('NFC_CARD_ALREADY_ENROLLED', 'That card is linked to another account. Tap a different card.')
          : new ReclaimedError('CONFLICT', "That card couldn't be linked. Try again.");
      }
      if (e.status !== 'PENDING') break;
    }
    await this.deps.hardware.cancelEnrollment(userId, enrollment.id).catch(() => undefined);
    throw new ReclaimedError('NFC_ENROLLMENT_TIMEOUT');
  }

  /** Prefers the card that has the physical card attached, then the newest. */
  private async currentCard(userId: string): Promise<OneTapCardDto | null> {
    const { rows } = await this.db.query<CardRow>(
      `select id, display_id, status, uid_masked from reclaimed_cards
        where user_id = $1 and status in ('ACTIVE', 'FROZEN')
        order by (uid_fingerprint is not null) desc, created_at desc limit 1`,
      [userId],
    );
    const r = rows[0];
    return r ? toOneTapCardDto(r) : null;
  }

  /** Pre-match by account name (PRD F2): first catalog keyword hit, else the generic Other card. */
  private async matchProduct(accountName: string): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from card_products
        where (not is_generic and exists (select 1 from unnest(match_keywords) k where position(k in lower($1)) > 0))
           or product_slug = 'other-card'
        order by is_generic, product_slug limit 1`,
      [accountName],
    );
    return rows[0]?.id ?? null;
  }
}

const validLast4 = (mask: string | null) => (mask && /^\d{4}$/.test(mask) ? mask : null);

type CardRow = { id: string; display_id: string; status: string; uid_masked: string | null };

/** Display IDs look like RC-7F3A-19C2; the app shows the last four characters. */
export function toOneTapCardDto(r: CardRow): OneTapCardDto {
  return {
    id: r.id,
    last4: r.display_id.replace(/[^0-9A-Z]/gi, '').slice(-4),
    state: r.status === 'FROZEN' ? 'paused' : 'open',
    physical_linked: r.uid_masked != null,
  };
}
