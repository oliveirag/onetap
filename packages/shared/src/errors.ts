export const ERROR_CODES = {
  AUTH_UNAUTHORIZED: { status: 401, retryable: false, message: 'Authentication is required.' },
  AUTH_FORBIDDEN: { status: 403, retryable: false, message: 'You do not have access to this resource.' },
  VALIDATION_FAILED: { status: 400, retryable: false, message: 'The request is invalid.' },
  NOT_FOUND: { status: 404, retryable: false, message: 'The requested resource was not found.' },
  CONFLICT: { status: 409, retryable: false, message: 'The request conflicts with the current state.' },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    retryable: false,
    message: 'This idempotency key was already used with a different request.',
  },
  RATE_LIMITED: { status: 429, retryable: true, message: 'Too many requests. Please slow down.' },
  FEATURE_DISABLED: { status: 503, retryable: false, message: 'This feature is not enabled in this environment.' },
  PLAID_CONNECTION_FAILED: { status: 502, retryable: true, message: 'We could not reach your bank through Plaid.' },
  PLAID_ITEM_LOGIN_REQUIRED: {
    status: 409,
    retryable: false,
    message: 'Your bank connection expired. Please reconnect this institution.',
  },
  PLAID_NOT_CONFIGURED: { status: 503, retryable: false, message: 'Plaid credentials are not configured.' },
  WEBHOOK_VERIFICATION_FAILED: { status: 401, retryable: false, message: 'Webhook signature verification failed.' },
  NFC_READER_NOT_FOUND: { status: 404, retryable: true, message: 'No NFC reader was found.' },
  NFC_READER_DISCONNECTED: { status: 503, retryable: true, message: 'The NFC reader is disconnected.' },
  NFC_CARD_UNSUPPORTED: { status: 422, retryable: false, message: 'This NFC card type is not supported.' },
  NFC_CARD_NOT_ENROLLED: { status: 404, retryable: false, message: 'This NFC card is not enrolled in Reclaimed.' },
  NFC_CARD_ALREADY_ENROLLED: { status: 409, retryable: false, message: 'This NFC card is already enrolled.' },
  NFC_CARD_FROZEN: { status: 403, retryable: false, message: 'This Reclaimed card is frozen.' },
  NFC_DUPLICATE_TAP: { status: 409, retryable: false, message: 'This tap was already processed.' },
  NFC_ENROLLMENT_NOT_ACTIVE: { status: 409, retryable: false, message: 'There is no active enrollment session.' },
  HARDWARE_BRIDGE_UNAVAILABLE: { status: 503, retryable: true, message: 'The hardware bridge is not connected.' },
  HARDWARE_AUTH_FAILED: { status: 401, retryable: false, message: 'Hardware bridge authentication failed.' },
  TERMINAL_AUTH_FAILED: { status: 401, retryable: false, message: 'Terminal authentication failed.' },
  TERMINAL_BUSY: { status: 409, retryable: false, message: 'This terminal already has a pending checkout.' },
  PAYMENT_DECLINED: { status: 402, retryable: false, message: 'The simulated payment was declined.' },
  INSUFFICIENT_FUNDS: { status: 402, retryable: false, message: 'The selected mock account has insufficient funds.' },
  LIMIT_EXCEEDED: { status: 402, retryable: false, message: 'This would exceed a simulated spending limit.' },
  AUTHORIZATION_TIMEOUT: { status: 504, retryable: true, message: 'The simulated authorization timed out.' },
  INVALID_PAYMENT_STATE: { status: 409, retryable: false, message: 'That action is not allowed in the current state.' },
  LITHIC_NOT_CONFIGURED: { status: 503, retryable: false, message: 'Lithic Sandbox is not configured.' },
  LITHIC_REQUEST_FAILED: { status: 502, retryable: true, message: 'The Lithic Sandbox request failed.' },
  DATABASE_ERROR: { status: 500, retryable: true, message: 'A database error occurred.' },
  INTERNAL_ERROR: { status: 500, retryable: true, message: 'Something went wrong on our side.' },
} as const satisfies Record<string, { status: number; retryable: boolean; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
  requestId: string;
}

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  requestId: string;
}

export type ApiResponse<T> = ApiSuccessBody<T> | ApiErrorBody;

/** Error type used by every Reclaimed service. Carries a stable code clients can branch on. */
export class ReclaimedError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, options?: { details?: unknown; cause?: unknown; retryable?: boolean }) {
    const def = ERROR_CODES[code];
    super(message ?? def.message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'ReclaimedError';
    this.code = code;
    this.status = def.status;
    this.retryable = options?.retryable ?? def.retryable;
    this.details = options?.details;
  }
}

export function isReclaimedError(err: unknown): err is ReclaimedError {
  return err instanceof ReclaimedError;
}
