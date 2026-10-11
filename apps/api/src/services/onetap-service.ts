import type { Database } from '@reclaimed/database';
import { ReclaimedError } from '@reclaimed/shared';
import type { Logger } from '../logger.js';
import type { SandboxCreditCard } from '../integrations/plaid/gateway.js';
import type { CardsService } from './cards-service.js';
import type { HardwareService } from './hardware-service.js';
import type { PlaidService } from './plaid-service.js';

/** The test user's credit cards (PRD F2 fallback). Names hit catalog keywords, so they pre-match. */
export const SANDBOX_TEST_CARDS: SandboxCreditCard[] = [
  { name: 'American Express Gold Card', mask: '1008', balance: 842.17, limit: 15_000 },
  { name: 'Chase Sapphire Preferred', mask: '4417', balance: 1_240.5, limit: 10_000 },
  { name: 'Citi Custom Cash Card', mask: '2290', balance: 96.4, limit: 5_000 },
  { name: 'Citi Double Cash Card', mask: '7731', balance: 412.77, limit: 8_000 },
];

/** The app's onetap_cards row (shared/contracts.ts OneTapCardRow). Only the last four reach the app. */
export interface OneTapCardDto {
  id: string;
  last4: string;
  state: 'open' | 'paused';
}

export interface ConnectTestAccountsDto {
  /** plaid_sandbox: imported from a Plaid Sandbox test user. demo: created directly (Plaid not configured). */
  source: 'plaid_sandbox' | 'demo' | 'existing';
  cardIds: string[];
}

interface ImportedCard {
  name: string;
  mask: string | null;
  balanceCents: number;
  limitCents: number;
  issuer: string;
  cardProductId: string | null;
}

/**
 * Backend side of the OneTap app's setup flow (mobile/src/lib/api.ts):
 * connect the user's credit cards, then link the physical OneTap (NFC) card.
 * Each card the app shows is a mock_funding_accounts row: the account the router charges.
 */
export class OneTapService {
  constructor(
    private readonly db: Database,
    private readonly deps: { plaid: PlaidService; cards: CardsService; hardware: HardwareService; logger: Logger },
    private readonly opts: { plaidConfigured: boolean; enrollmentEnabled: boolean; enrollmentWaitMs: number; pollMs?: number },
  ) {}

  async connectTestAccounts(userId: string): Promise<ConnectTestAccountsDto> {
    // Idempotent: a retry, or a second phone, gets the cards already connected.
    const existing = await this.creditCardIds(userId);
    if (existing.length) return { source: 'existing', cardIds: existing };

    let imported: ImportedCard[];
    let source: ConnectTestAccountsDto['source'];
    if (this.opts.plaidConfigured) {
      const { itemId } = await this.deps.plaid.connectSandboxTestUser(userId, SANDBOX_TEST_CARDS);
      const { rows } = await this.db.query<{
        name: string;
        official_name: string | null;
        mask: string | null;
        current_balance_cents: number | null;
        credit_limit_cents: number | null;
        institution_name: string | null;
        card_product_id: string | null;
      }>(
        `select a.name, a.official_name, a.mask, a.current_balance_cents, a.credit_limit_cents, i.institution_name, uc.card_product_id
           from financial_accounts a
           join plaid_items i on i.id = a.plaid_item_id
           left join user_cards uc on uc.financial_account_id = a.id
          where i.id = $1 and a.user_id = $2 and a.type = 'credit' and a.is_active
          order by a.created_at, a.name`,
        [itemId, userId],
      );
      imported = rows.map((r) => ({
        name: r.official_name ?? r.name,
        mask: r.mask,
        balanceCents: r.current_balance_cents ?? 0,
        limitCents: r.credit_limit_cents ?? 500_000,
        issuer: `${r.institution_name ?? 'Plaid'} (sandbox)`,
        cardProductId: r.card_product_id,
      }));
      source = 'plaid_sandbox';
    } else {
      imported = SANDBOX_TEST_CARDS.map((c) => ({
        name: c.name,
        mask: c.mask,
        balanceCents: Math.round(c.balance * 100),
        limitCents: Math.round(c.limit * 100),
        issuer: 'Demo issuer (fictional)',
        cardProductId: null,
      }));
      source = 'demo';
    }

    const cardIds: string[] = [];
    for (const [i, c] of imported.entries()) {
      const funding = await this.deps.cards.createFunding(
        userId,
        {
          displayName: c.name.slice(0, 80),
          fictionalIssuer: c.issuer.slice(0, 80),
          kind: 'CREDIT',
          cardProductId: c.cardProductId ?? (await this.matchProduct(c.name)),
          limitOrBalanceCents: c.limitCents,
          priority: i + 1,
        },
        { last4: c.mask },
      );
      await this.db.query('update mock_funding_accounts set current_balance_cents = $2 where id = $1', [funding.id, c.balanceCents]);
      cardIds.push(funding.id);
    }
    // The first card is the baseline each routing decision is compared with, until the user picks one.
    if (cardIds[0]) {
      await this.db.query('update profiles set default_card_id = coalesce(default_card_id, $2) where id = $1', [userId, cardIds[0]]);
    }
    this.deps.logger.info({ userId, source, cards: cardIds.length }, 'onetap test accounts connected');
    return { source, cardIds };
  }

  /**
   * Returns the user's OneTap card. With none yet, opens an enrollment session and waits for the
   * physical NFC card to be tapped on the reader (the hardware bridge reports the tap).
   */
  async card(userId: string): Promise<OneTapCardDto> {
    const current = await this.currentCard(userId);
    if (current) return current;
    if (!this.opts.enrollmentEnabled) {
      throw new ReclaimedError('FEATURE_DISABLED', 'Linking a card is development-only. Set HARDWARE_TEST_MODE=true on the API.');
    }
    const enrollment = await this.deps.hardware.startEnrollment(userId, { nickname: 'OneTap' });
    const deadline = Date.now() + this.opts.enrollmentWaitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 250));
      const e = await this.deps.hardware.getEnrollment(userId, enrollment.id);
      if (e.status === 'COMPLETED') {
        const card = await this.currentCard(userId);
        if (card) return card;
      }
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

  private async currentCard(userId: string): Promise<OneTapCardDto | null> {
    const { rows } = await this.db.query<{ id: string; display_id: string; status: string }>(
      `select id, display_id, status from reclaimed_cards
        where user_id = $1 and status in ('ACTIVE', 'FROZEN') order by created_at desc limit 1`,
      [userId],
    );
    const r = rows[0];
    return r ? toOneTapCardDto(r) : null;
  }

  private async creditCardIds(userId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from mock_funding_accounts where user_id = $1 and kind = 'CREDIT' and status = 'ACTIVE' order by priority, created_at`,
      [userId],
    );
    return rows.map((r) => r.id);
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

/** Display IDs look like RC-7F3A-19C2; the app shows the last four characters. */
export function toOneTapCardDto(r: { id: string; display_id: string; status: string }): OneTapCardDto {
  return { id: r.id, last4: r.display_id.replace(/[^0-9A-Z]/gi, '').slice(-4), state: r.status === 'FROZEN' ? 'paused' : 'open' };
}
