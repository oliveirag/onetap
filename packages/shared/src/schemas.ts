import { z } from 'zod';
import {
  BILL_PAYMENT_SCENARIOS,
  HARDWARE_EVENT_TYPES,
  MOCK_FUNDING_KINDS,
  MOCK_FUNDING_STATUSES,
  USER_SETTABLE_CARD_STATUSES,
} from './enums';

/** Simulated money is always an integer number of minor units (cents). */
export const amountCentsSchema = z.number().int().positive().max(10_000_000);
export const currencySchema = z
  .string()
  .length(3)
  .transform((v) => v.toUpperCase())
  .pipe(z.literal('USD', { error: 'Only USD is supported in Phase 1.' }));
export const mccSchema = z.string().regex(/^\d{4}$/, 'MCC must be four digits.');
export const uuidSchema = z.uuid();

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

// ---------- Auth (client-side forms) ----------
/** Trims before validating so pasted addresses with stray spaces are accepted. */
export const emailSchema = z.string().trim().pipe(z.email('Enter a valid email.'));
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128)
  .regex(/[A-Za-z]/, 'Include a letter.')
  .regex(/\d/, 'Include a number.');

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Enter your name.').max(120),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });
export const verifyOtpSchema = z.object({
  email: z.email(),
  token: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

// ---------- Profile ----------
export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    themePreference: z.enum(['system', 'light', 'dark']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field.');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------- Plaid ----------
export const linkTokenRequestSchema = z.object({
  /** When set, creates an update-mode link token to repair an existing item. */
  itemId: uuidSchema.optional(),
  /** Client platform. Android Link tokens need the registered package name; iOS uses redirect_uri. */
  platform: z.enum(['ios', 'android']).optional(),
});
export const exchangeTokenSchema = z.object({
  publicToken: z.string().min(1).max(500),
  institution: z
    .object({ id: z.string().max(100).nullish(), name: z.string().max(200).nullish() })
    .optional(),
});

// ---------- Card products ----------
export const cardProductSearchSchema = z.object({ search: z.string().trim().max(100).optional() });
export const confirmCardProductSchema = z.object({
  /** null clears the association (product unconfirmed). */
  cardProductId: uuidSchema.nullable(),
});

// ---------- Mock funding ----------
export const createMockFundingAccountSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  fictionalIssuer: z.string().trim().min(1).max(80),
  kind: z.enum(MOCK_FUNDING_KINDS).default('CREDIT'),
  cardProductId: uuidSchema.nullish(),
  /** CREDIT: credit limit. DEPOSIT: starting balance. */
  limitOrBalanceCents: z.number().int().min(0).max(100_000_000),
  priority: z.number().int().min(1).max(99).optional(),
});
export type CreateMockFundingAccountInput = z.infer<typeof createMockFundingAccountSchema>;

export const updateMockFundingAccountSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    status: z.enum(MOCK_FUNDING_STATUSES).optional(),
    creditLimitCents: z.number().int().min(0).max(100_000_000).optional(),
    /** Developer control used to stage insufficient-funds scenarios. */
    currentBalanceCents: z.number().int().min(0).max(100_000_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field.');

// ---------- Reclaimed cards ----------
export const startEnrollmentSchema = z.object({
  readerId: uuidSchema.optional(),
  nickname: z.string().trim().min(1).max(40).optional(),
});
export const updateCardStatusSchema = z.object({ status: z.enum(USER_SETTABLE_CARD_STATUSES) });
export const updateCardFundingSchema = z
  .object({
    primaryFundingAccountId: uuidSchema.nullable(),
    secondaryFundingAccountId: uuidSchema.nullable(),
    fallbackEnabled: z.boolean(),
    perTransactionLimitCents: z.number().int().min(100).max(10_000_000).optional(),
    dailyLimitCents: z.number().int().min(100).max(50_000_000).optional(),
  })
  .refine(
    (v) => !v.primaryFundingAccountId || v.primaryFundingAccountId !== v.secondaryFundingAccountId,
    { path: ['secondaryFundingAccountId'], message: 'Secondary account must differ from primary.' },
  );
export type UpdateCardFundingInput = z.infer<typeof updateCardFundingSchema>;

// ---------- Hardware ----------
export const hardwareReaderEventSchema = z.object({
  eventId: uuidSchema,
  type: z.enum(HARDWARE_EVENT_TYPES),
  readerName: z.string().min(1).max(200),
  bridgeId: z.string().min(1).max(100),
  occurredAt: z.iso.datetime(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type HardwareReaderEvent = z.infer<typeof hardwareReaderEventSchema>;

export const tapEventSchema = z.object({
  /** Unique per physical presentation; the backend dedupes on it. */
  tapId: uuidSchema,
  readerName: z.string().min(1).max(200),
  bridgeId: z.string().min(1).max(100),
  /** Hex-encoded tag UID read via the PC/SC GET DATA pseudo-APDU (FF CA 00 00 00). */
  uid: z.string().regex(/^[0-9A-Fa-f]{8,20}$/, 'UID must be 4-10 bytes of hex.'),
  atr: z.string().regex(/^[0-9A-Fa-f]{2,66}$/).optional(),
  cardType: z.string().max(60).optional(),
  presentedAt: z.iso.datetime(),
});
export type TapEvent = z.infer<typeof tapEventSchema>;

// ---------- Terminal ----------
export const createCheckoutSchema = z.object({
  merchantId: z.string().trim().min(1).max(40),
  merchantName: z.string().trim().min(1).max(80),
  mcc: mccSchema,
  amountCents: amountCentsSchema,
  currency: currencySchema.default('USD'),
});
export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

export const refundSchema = z.object({
  /** Omit for a full refund of the remaining refundable amount. */
  amountCents: amountCentsSchema.optional(),
  reason: z.string().trim().max(200).optional(),
});

// ---------- Bill pay ----------
export const createBillPaymentSchema = z.object({
  financialAccountId: uuidSchema,
  fundingAccountId: uuidSchema,
  amountCents: amountCentsSchema,
  /** false saves a DRAFT; true submits immediately. */
  confirm: z.boolean().default(true),
  scenario: z.enum(BILL_PAYMENT_SCENARIOS).default('SUCCESS'),
});
export type CreateBillPaymentInput = z.infer<typeof createBillPaymentSchema>;

// ---------- Activity ----------
export const transactionsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  accountId: uuidSchema.optional(),
});
