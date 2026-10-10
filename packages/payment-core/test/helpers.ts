import { createTestDatabase } from '@reclaimed/database/testing';
import { upsertDevTerminal, type Database } from '@reclaimed/database';
import {
  AuthorizationService,
  BillPaymentService,
  ConfiguredFundingSelector,
  MockBillPaymentProvider,
  MockFundingProvider,
  MockPaymentProcessor,
  PaymentLifecycleService,
  TransactionLedger,
  newCardDisplayId,
} from '../src/index.js';

export async function setup(opts: { processor?: MockPaymentProcessor; timeoutMs?: number; checkoutTtlMs?: number } = {}) {
  const db = await createTestDatabase();
  const processor = opts.processor ?? new MockPaymentProcessor();
  const funding = new MockFundingProvider();
  const ledger = new TransactionLedger();
  const auth = new AuthorizationService(
    db,
    { funding, selector: new ConfiguredFundingSelector(), processor, ledger },
    { authorizationTimeoutMs: opts.timeoutMs ?? 2000 },
  );
  const lifecycle = new PaymentLifecycleService(db, { funding, processor, ledger }, { checkoutTtlMs: opts.checkoutTtlMs ?? 60_000 });
  const billPay = new BillPaymentService(
    db,
    { provider: new MockBillPaymentProvider(), funding, ledger },
    { submittedToProcessingMs: 0, processingToFinalMs: 0, completedToReturnMs: 0 },
  );
  const terminal = await upsertDevTerminal(db, { terminalCode: 'TERM-TEST', secret: 'terminal-secret' });
  return { db, processor, funding, ledger, auth, lifecycle, billPay, terminalId: terminal.id };
}

export async function createUser(db: Database, email = `u${Math.random().toString(36).slice(2)}@example.com`) {
  const { rows } = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
  return rows[0]!.id;
}

export async function createFunding(
  db: Database,
  userId: string,
  name: string,
  opts: { limit?: number; balance?: number; kind?: 'CREDIT' | 'DEPOSIT'; priority?: number; status?: string } = {},
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into mock_funding_accounts (user_id, display_name, fictional_issuer, kind, credit_limit_cents, current_balance_cents, priority, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [userId, name, name.replace('Mock ', ''), opts.kind ?? 'CREDIT', opts.limit ?? 200_000, opts.balance ?? 0, opts.priority ?? 10, opts.status ?? 'ACTIVE'],
  );
  return rows[0]!.id;
}

export async function createCard(
  db: Database,
  userId: string,
  opts: { primary?: string | null; secondary?: string | null; fallback?: boolean; status?: string; perTxn?: number; daily?: number } = {},
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into reclaimed_cards (user_id, display_id, status, uid_fingerprint, uid_masked, primary_funding_account_id,
       secondary_funding_account_id, fallback_enabled, per_transaction_limit_cents, daily_limit_cents, enrolled_at)
     values ($1, $2, $3, $4, '••••A1B2', $5, $6, $7, $8, $9, now()) returning id`,
    [
      userId,
      newCardDisplayId(),
      opts.status ?? 'ACTIVE',
      `fp-${Math.random()}`,
      opts.primary ?? null,
      opts.secondary ?? null,
      opts.fallback ?? true,
      opts.perTxn ?? 100_000,
      opts.daily ?? 250_000,
    ],
  );
  return rows[0]!.id;
}

export function authInput(txn: { id: string; merchantId: string; merchantName: string; mcc: string; amountCents: number; currency: string; terminalId: string }, cardId: string) {
  return {
    transactionId: txn.id,
    reclaimedCardId: cardId,
    merchantId: txn.merchantId,
    merchantName: txn.merchantName,
    mcc: txn.mcc,
    amountCents: txn.amountCents,
    currency: txn.currency,
    terminalId: txn.terminalId,
    timestamp: new Date().toISOString(),
  };
}

export const WALMART = { merchantId: 'MID-WALMART-0001', merchantName: 'Walmart', mcc: '5310', currency: 'USD' };

export async function fundingRow(db: Database, id: string) {
  return (await db.query<{ current_balance_cents: number; pending_holds_cents: number; credit_limit_cents: number }>(
    'select current_balance_cents, pending_holds_cents, credit_limit_cents from mock_funding_accounts where id = $1',
    [id],
  )).rows[0]!;
}
