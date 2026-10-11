import type { Database } from '@reclaimed/database';
import { availableCents, type MockFundingRow } from '@reclaimed/payment-core';

/** Subset of Lithic's ASA request (CardAuthorization) that Reclaimed uses. */
export interface AsaRequest {
  token: string;
  amount: number;
  status?: string;
  card?: { token?: string };
  merchant?: { descriptor?: string; mcc?: string; acceptor_id?: string };
}

export type AsaResult = 'APPROVED' | 'CARD_PAUSED' | 'INSUFFICIENT_FUNDS' | 'UNAUTHORIZED_MERCHANT' | 'SUSPECTED_FRAUD';

/**
 * Auth Stream Access responder. Lithic calls this synchronously for every
 * authorization on an enrolled sandbox program.
 *  - If Reclaimed initiated the simulation (an AUTHORIZATION_PENDING transaction with a
 *    hold already placed for this card/amount) → APPROVED, honoring our engine's decision.
 *  - Otherwise (e.g. a simulation started from the Lithic dashboard), apply the same
 *    deterministic card-status and mock-funds checks, without placing a hold.
 */
export async function decideAsa(db: Database, req: AsaRequest): Promise<{ result: AsaResult; reason: string }> {
  const cardToken = req.card?.token;
  if (!cardToken) return { result: 'UNAUTHORIZED_MERCHANT', reason: 'NO_CARD_TOKEN' };
  if (req.status && req.status !== 'AUTHORIZATION' && req.status !== 'FINANCIAL_AUTHORIZATION') {
    return { result: 'UNAUTHORIZED_MERCHANT', reason: `UNSUPPORTED_${req.status}` };
  }
  const card = (
    await db.query<{ id: string; user_id: string; status: string; primary_funding_account_id: string | null }>(
      'select id, user_id, status, primary_funding_account_id from reclaimed_cards where lithic_card_token = $1',
      [cardToken],
    )
  ).rows[0];
  if (!card) return { result: 'UNAUTHORIZED_MERCHANT', reason: 'UNKNOWN_CARD' };
  if (card.status === 'FROZEN') return { result: 'CARD_PAUSED', reason: 'CARD_FROZEN' };
  if (card.status !== 'ACTIVE') return { result: 'CARD_PAUSED', reason: `CARD_${card.status}` };

  const pending = await db.query(
    `select 1 from payment_transactions p
      join ledger_journals j on j.payment_transaction_id = p.id and j.journal_type = 'AUTHORIZATION_HOLD'
     where p.reclaimed_card_id = $1 and p.state = 'AUTHORIZATION_PENDING' and p.amount_cents = $2`,
    [card.id, req.amount],
  );
  if (pending.rowCount) return { result: 'APPROVED', reason: 'RECLAIMED_ENGINE_APPROVED_HOLD' };

  const funding = (
    await db.query<MockFundingRow>(
      `select * from mock_funding_accounts where user_id = $1 and status = 'ACTIVE'
        order by (id = $2) desc, priority, created_at limit 1`,
      [card.user_id, card.primary_funding_account_id],
    )
  ).rows[0];
  if (!funding || availableCents(funding) < req.amount) return { result: 'INSUFFICIENT_FUNDS', reason: 'MOCK_FUNDS' };
  return { result: 'APPROVED', reason: 'STANDALONE_CHECKS_PASSED' };
}
