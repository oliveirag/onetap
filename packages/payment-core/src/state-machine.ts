import { ReclaimedError, type PaymentState } from '@reclaimed/shared';

/**
 * Allowed payment state transitions. Mirrored in Postgres by
 * public.enforce_payment_transition() as defense in depth.
 */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  CREATED: ['AUTHORIZATION_PENDING', 'FAILED'],
  AUTHORIZATION_PENDING: ['AUTHORIZED', 'DECLINED', 'FAILED'],
  AUTHORIZED: ['CAPTURED', 'REVERSED'],
  CAPTURED: ['SETTLEMENT_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  SETTLEMENT_PENDING: ['SETTLED'],
  SETTLED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED', 'SETTLEMENT_PENDING'],
  DECLINED: [],
  REVERSED: [],
  REFUNDED: [],
  FAILED: [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransition(from, to)) {
    throw new ReclaimedError('INVALID_PAYMENT_STATE', `Cannot move a payment from ${from} to ${to}.`, {
      details: { from, to },
    });
  }
}

export function isTerminalState(state: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[state].length === 0;
}

/** States in which an approved authorization still counts against spend limits. */
export const SPEND_COUNTING_STATES: readonly PaymentState[] = [
  'AUTHORIZATION_PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'PARTIALLY_REFUNDED',
];
