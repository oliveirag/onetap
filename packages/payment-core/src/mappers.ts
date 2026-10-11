import type {
  AuthorizationDto,
  AuthorizationResult,
  BillPaymentDto,
  CardProductDto,
  EnrollmentDto,
  MockFundingAccountDto,
  PaymentState,
  ReclaimedCardDto,
  SimulatedTransactionDto,
} from '@reclaimed/shared';
import type { Queryable } from '@reclaimed/database';
import { availableCents, type MockFundingRow } from './funding.js';

const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

export interface PaymentTransactionRow {
  id: string;
  reference: string;
  terminal_id: string;
  user_id: string | null;
  reclaimed_card_id: string | null;
  merchant_id: string;
  merchant_name: string;
  mcc: string;
  amount_cents: number;
  currency: string;
  state: PaymentState;
  authorization_result: AuthorizationResult | null;
  decline_reason: string | null;
  funding_account_id: string | null;
  funding_account_name: string | null;
  processor: 'mock' | 'lithic_sandbox';
  processor_reference: string | null;
  captured_cents: number;
  refunded_cents: number;
  expires_at: Date;
  authorized_at: Date | null;
  captured_at: Date | null;
  settled_at: Date | null;
  reversed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function toTransactionDto(r: PaymentTransactionRow): SimulatedTransactionDto {
  return {
    id: r.id,
    reference: r.reference,
    terminalId: r.terminal_id,
    merchantId: r.merchant_id,
    merchantName: r.merchant_name,
    mcc: r.mcc,
    amountCents: r.amount_cents,
    currency: r.currency,
    state: r.state,
    authorizationResult: r.authorization_result,
    declineReason: r.decline_reason,
    reclaimedCardId: r.reclaimed_card_id,
    fundingAccountId: r.funding_account_id,
    fundingAccountName: r.funding_account_name,
    capturedCents: r.captured_cents,
    refundedCents: r.refunded_cents,
    processor: r.processor,
    expiresAt: iso(r.expires_at)!,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    simulated: true,
  };
}

export async function loadTransaction(db: Queryable, id: string): Promise<PaymentTransactionRow | null> {
  const { rows } = await db.query<PaymentTransactionRow>('select * from payment_transactions where id = $1', [id]);
  return rows[0] ?? null;
}

export async function loadAuthorizationDto(
  db: Queryable,
  where: { id?: string; paymentTransactionId?: string },
): Promise<AuthorizationDto | null> {
  const col = where.id ? 'id' : 'payment_transaction_id';
  const val = where.id ?? where.paymentTransactionId;
  const { rows } = await db.query<{
    id: string;
    payment_transaction_id: string;
    result: AuthorizationResult | null;
    decline_reason: string | null;
    processor: string;
    total_ms: number | null;
    db_lookup_ms: number | null;
    funding_evaluation_ms: number | null;
    processor_ms: number | null;
    created_at: Date;
  }>(`select * from authorization_attempts where ${col} = $1`, [val]);
  const a = rows[0];
  if (!a) return null;
  const attempts = await db.query<{
    funding_account_id: string | null;
    funding_account_name: string;
    sequence: number;
    result: AuthorizationResult;
    reason: string | null;
  }>('select * from funding_attempts where authorization_attempt_id = $1 order by sequence', [a.id]);
  return {
    id: a.id,
    paymentTransactionId: a.payment_transaction_id,
    result: a.result ?? 'INTERNAL_ERROR',
    declineReason: a.decline_reason,
    processor: a.processor,
    fundingAttempts: attempts.rows.map((f) => ({
      fundingAccountId: f.funding_account_id ?? '',
      fundingAccountName: f.funding_account_name,
      sequence: f.sequence,
      result: f.result,
      reason: f.reason,
    })),
    latency: {
      totalMs: a.total_ms ?? 0,
      dbLookupMs: a.db_lookup_ms ?? 0,
      fundingEvaluationMs: a.funding_evaluation_ms ?? 0,
      processorMs: a.processor_ms ?? 0,
    },
    createdAt: iso(a.created_at)!,
  };
}

export interface CardProductRow {
  id: string;
  issuer_name: string;
  product_name: string;
  product_slug: string;
  card_network: CardProductDto['cardNetwork'];
}

export function toCardProductDto(r: CardProductRow): CardProductDto {
  return {
    id: r.id,
    issuerName: r.issuer_name,
    productName: r.product_name,
    productSlug: r.product_slug,
    cardNetwork: r.card_network,
  };
}

export function toMockFundingDto(r: MockFundingRow, product: CardProductRow | null): MockFundingAccountDto {
  return {
    id: r.id,
    displayName: r.display_name,
    fictionalIssuer: r.fictional_issuer,
    kind: r.kind,
    cardProduct: product ? toCardProductDto(product) : null,
    creditLimitCents: r.credit_limit_cents,
    currentBalanceCents: r.current_balance_cents,
    pendingHoldsCents: r.pending_holds_cents,
    availableCents: availableCents(r),
    status: r.status,
    priority: r.priority,
  };
}

export async function listMockFundingDtos(db: Queryable, userId: string): Promise<MockFundingAccountDto[]> {
  const { rows } = await db.query<MockFundingRow & { cp_id: string | null } & Partial<CardProductRow>>(
    `select m.*, cp.id as cp_id, cp.issuer_name, cp.product_name, cp.product_slug, cp.card_network
       from mock_funding_accounts m left join card_products cp on cp.id = m.card_product_id
      where m.user_id = $1 and m.status <> 'CLOSED'
      order by m.priority, m.created_at`,
    [userId],
  );
  return rows.map((r) =>
    toMockFundingDto(
      r,
      r.cp_id
        ? {
            id: r.cp_id,
            issuer_name: r.issuer_name!,
            product_name: r.product_name!,
            product_slug: r.product_slug!,
            card_network: r.card_network!,
          }
        : null,
    ),
  );
}

export interface ReclaimedCardRow {
  id: string;
  user_id: string;
  display_id: string;
  nickname: string | null;
  status: ReclaimedCardDto['status'];
  uid_fingerprint: string;
  uid_masked: string;
  card_technology: string | null;
  primary_funding_account_id: string | null;
  secondary_funding_account_id: string | null;
  fallback_enabled: boolean;
  per_transaction_limit_cents: number;
  daily_limit_cents: number;
  enrolled_at: Date | null;
  last_tapped_at: Date | null;
  lithic_card_token: string | null;
}

export function toReclaimedCardDto(r: ReclaimedCardRow): ReclaimedCardDto {
  return {
    id: r.id,
    displayId: r.display_id,
    nickname: r.nickname,
    status: r.status,
    uidMasked: r.uid_masked,
    cardTechnology: r.card_technology,
    primaryFundingAccountId: r.primary_funding_account_id,
    secondaryFundingAccountId: r.secondary_funding_account_id,
    fallbackEnabled: r.fallback_enabled,
    perTransactionLimitCents: r.per_transaction_limit_cents,
    dailyLimitCents: r.daily_limit_cents,
    enrolledAt: iso(r.enrolled_at),
    lastTappedAt: iso(r.last_tapped_at),
    lithicSandboxMapped: Boolean(r.lithic_card_token),
  };
}

export interface EnrollmentRow {
  id: string;
  user_id: string;
  status: EnrollmentDto['status'];
  reader_id: string | null;
  nickname: string | null;
  reclaimed_card_id: string | null;
  failure_reason: string | null;
  expires_at: Date;
  created_at: Date;
}

export function toEnrollmentDto(r: EnrollmentRow): EnrollmentDto {
  return {
    id: r.id,
    status: r.status,
    readerId: r.reader_id,
    reclaimedCardId: r.reclaimed_card_id,
    failureReason: r.failure_reason,
    expiresAt: iso(r.expires_at)!,
    createdAt: iso(r.created_at)!,
  };
}

export interface BillPaymentRow {
  id: string;
  user_id: string;
  financial_account_id: string | null;
  financial_account_name: string | null;
  funding_account_id: string | null;
  funding_account_name: string | null;
  amount_cents: number;
  currency: string;
  state: BillPaymentDto['state'];
  scenario: BillPaymentDto['scenario'];
  failure_reason: string | null;
  idempotency_key: string | null;
  next_transition_at: Date | null;
  submitted_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function loadBillPaymentDto(db: Queryable, id: string, userId: string): Promise<BillPaymentDto | null> {
  const { rows } = await db.query<BillPaymentRow>('select * from bill_payment_intents where id = $1 and user_id = $2', [
    id,
    userId,
  ]);
  const r = rows[0];
  if (!r) return null;
  const events = await db.query<{ state: BillPaymentDto['state']; note: string | null; created_at: Date }>(
    'select state, note, created_at from bill_payment_events where intent_id = $1 order by created_at, id',
    [id],
  );
  return toBillPaymentDto(r, events.rows);
}

export function toBillPaymentDto(
  r: BillPaymentRow,
  events: { state: BillPaymentDto['state']; note: string | null; created_at: Date }[],
): BillPaymentDto {
  return {
    id: r.id,
    financialAccountId: r.financial_account_id ?? '',
    financialAccountName: r.financial_account_name,
    fundingAccountId: r.funding_account_id ?? '',
    fundingAccountName: r.funding_account_name,
    amountCents: r.amount_cents,
    currency: r.currency,
    state: r.state,
    scenario: r.scenario,
    failureReason: r.failure_reason,
    submittedAt: iso(r.submitted_at),
    completedAt: iso(r.completed_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    events: events.map((e) => ({ state: e.state, note: e.note, createdAt: iso(e.created_at)! })),
    testMode: true,
  };
}
