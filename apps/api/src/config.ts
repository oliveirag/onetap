import { z } from 'zod';
import { CountryCode, Products } from 'plaid';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

/** Comma-separated list whose entries must all be members of `allowed` (case-insensitive). */
const csvOf = <T extends string>(allowed: readonly T[], def: string, normalize: (s: string) => string) =>
  z
    .string()
    .default(def)
    .transform((v) => [...new Set(v.split(',').map((s) => normalize(s.trim())).filter(Boolean))])
    .refine((list) => list.length > 0, 'must not be empty')
    .refine((list) => list.every((x) => (allowed as readonly string[]).includes(x)), { message: `entries must be one of: ${allowed.join(', ')}` })
    .transform((list) => list as T[]);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_BASE_URL: z.url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:8081'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().default('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),
  SUPABASE_URL: z.string().default('http://127.0.0.1:54321'),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  // Products requested when creating a new Link token. Transactions is always required (sync depends on it).
  PLAID_PRODUCTS: csvOf(Object.values(Products), 'transactions', (s) => s.toLowerCase()).refine(
    (list) => list.includes(Products.Transactions),
    'must include transactions',
  ),
  PLAID_COUNTRY_CODES: csvOf(Object.values(CountryCode), 'US', (s) => s.toUpperCase()),
  PLAID_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  ENABLE_PLAID_LIABILITIES: bool(true),
  PLAID_WEBHOOK_URL: z.string().optional(),
  PLAID_REDIRECT_URI: z.string().optional(),
  PLAID_ANDROID_PACKAGE_NAME: z.string().default('com.reclaimed.app'),
  PLAID_VERIFY_WEBHOOKS: bool(true),

  LITHIC_API_KEY: z.string().optional(),
  LITHIC_ENVIRONMENT: z.enum(['sandbox']).default('sandbox'),
  LITHIC_WEBHOOK_SECRET: z.string().optional(),
  LITHIC_ASA_SECRET: z.string().optional(),

  NFC_READER_MODEL: z.string().default('ACS ACR1252U'),
  HARDWARE_BRIDGE_SECRET: z.string().min(16).optional(),
  HARDWARE_TEST_MODE: bool(false),
  NFC_UID_PEPPER: z.string().min(16).optional(),
  TAP_DEBOUNCE_MS: z.coerce.number().int().default(1500),

  PAYMENT_MODE: z.enum(['mock', 'lithic_sandbox']).default('mock'),
  BILL_PAYMENT_MODE: z.enum(['mock']).default('mock'),
  TEST_TERMINAL_ENABLED: bool(true),
  CHECKOUT_TTL_MS: z.coerce.number().int().default(90_000),
  AUTHORIZATION_TIMEOUT_MS: z.coerce.number().int().default(5_000),
  ENROLLMENT_TTL_MS: z.coerce.number().int().default(60_000),
  SETTLEMENT_DELAY_MS: z.coerce.number().int().default(3_000),
  BILL_PAY_STEP_MS: z.coerce.number().int().default(4_000),
  JOBS_ENABLED: bool(true),
});

export type Config = z.infer<typeof schema> & { isProduction: boolean; isDev: boolean; corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `PLAID_SECRET=` in .env) as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    // Phase 1 is a prototype. Refuse to run anything that looks like live money.
    if (c.PLAID_ENV === 'production') throw new Error('PLAID_ENV=production is not permitted in Phase 1.');
  }
  return {
    ...c,
    isProduction: c.NODE_ENV === 'production',
    isDev: c.NODE_ENV !== 'production',
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
