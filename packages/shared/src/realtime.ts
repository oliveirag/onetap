import type {
  AuthorizationDto,
  EnrollmentDto,
  HardwareReaderDto,
  HardwareTapDto,
  SimulatedTransactionDto,
} from './dto';

/** Messages pushed over the authenticated WebSocket at /api/v1/realtime. */
export type RealtimeEvent =
  | { type: 'payment.updated'; transaction: SimulatedTransactionDto; authorization?: AuthorizationDto }
  | { type: 'enrollment.updated'; enrollment: EnrollmentDto }
  | { type: 'card.updated'; reclaimedCardId: string }
  | { type: 'hardware.reader'; reader: HardwareReaderDto }
  | { type: 'hardware.tap'; tap: HardwareTapDto }
  | { type: 'bill_payment.updated'; billPaymentId: string; state: string }
  | { type: 'plaid.synced'; plaidItemId: string };

/** First message a client must send after connecting. */
export type RealtimeAuthMessage =
  | { type: 'auth'; accessToken: string }
  | { type: 'auth_terminal'; terminalId: string; timestamp: string; signature: string };

export type RealtimeServerMessage =
  | { type: 'ready'; subject: 'user' | 'terminal' }
  | { type: 'error'; code: string; message: string }
  | { type: 'event'; event: RealtimeEvent };
