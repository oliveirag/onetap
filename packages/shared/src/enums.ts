/**
 * Canonical enumerations shared by the API, payment core, hardware bridge,
 * terminal simulator and mobile app. These values are mirrored by Postgres
 * CHECK constraints in packages/database/supabase/migrations.
 */

export const RECLAIMED_CARD_STATUSES = ['UNREGISTERED', 'ACTIVE', 'FROZEN', 'DISABLED', 'REVOKED'] as const;
export type ReclaimedCardStatus = (typeof RECLAIMED_CARD_STATUSES)[number];

/** Statuses a cardholder may set from the app. DISABLED/REVOKED are terminal or admin-only. */
export const USER_SETTABLE_CARD_STATUSES = ['ACTIVE', 'FROZEN', 'REVOKED'] as const;
export type UserSettableCardStatus = (typeof USER_SETTABLE_CARD_STATUSES)[number];

export const PAYMENT_STATES = [
  'CREATED',
  'AUTHORIZATION_PENDING',
  'AUTHORIZED',
  'DECLINED',
  'CAPTURED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'REVERSED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const AUTHORIZATION_RESULTS = [
  'APPROVED',
  'DECLINED',
  'CARD_FROZEN',
  'INVALID_CARD',
  'INSUFFICIENT_FUNDS',
  'LIMIT_EXCEEDED',
  'AUTHORIZATION_TIMEOUT',
  'INTERNAL_ERROR',
] as const;
export type AuthorizationResult = (typeof AUTHORIZATION_RESULTS)[number];

export const BILL_PAYMENT_STATES = [
  'DRAFT',
  'SUBMITTED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'RETURNED',
] as const;
export type BillPaymentState = (typeof BILL_PAYMENT_STATES)[number];

/** Test-mode scenarios the mock bill-payment provider can be asked to play out. */
export const BILL_PAYMENT_SCENARIOS = ['SUCCESS', 'FAIL', 'RETURN'] as const;
export type BillPaymentScenario = (typeof BILL_PAYMENT_SCENARIOS)[number];

export const MOCK_FUNDING_KINDS = ['CREDIT', 'DEPOSIT'] as const;
export type MockFundingKind = (typeof MOCK_FUNDING_KINDS)[number];

export const MOCK_FUNDING_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type MockFundingStatus = (typeof MOCK_FUNDING_STATUSES)[number];

export const NFC_ENROLLMENT_STATUSES = ['PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED', 'FAILED'] as const;
export type NfcEnrollmentStatus = (typeof NFC_ENROLLMENT_STATUSES)[number];

export const PLAID_ITEM_STATUSES = ['ACTIVE', 'LOGIN_REQUIRED', 'ERROR', 'REMOVED'] as const;
export type PlaidItemStatus = (typeof PLAID_ITEM_STATUSES)[number];

export const CARD_NETWORKS = ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'] as const;
export type CardNetwork = (typeof CARD_NETWORKS)[number];

export const PAYMENT_MODES = ['mock', 'lithic_sandbox'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const HARDWARE_EVENT_TYPES = [
  'READER_CONNECTED',
  'READER_DISCONNECTED',
  'CARD_PRESENTED',
  'CARD_REMOVED',
  'READER_ERROR',
] as const;
export type HardwareEventType = (typeof HARDWARE_EVENT_TYPES)[number];

/** What the backend did with a physical tap. */
export const TAP_OUTCOMES = [
  'ENROLLED',
  'ENROLLMENT_REJECTED',
  'AUTHORIZATION_STARTED',
  'NO_PENDING_CHECKOUT',
  'DUPLICATE_TAP',
  'UNKNOWN_CARD',
  'IGNORED',
] as const;
export type TapOutcome = (typeof TAP_OUTCOMES)[number];
