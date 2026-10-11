import { createPgDatabase, type Database } from '@reclaimed/database';
import {
  AuthorizationService,
  BillPaymentService,
  CategoryRoutingSelector,
  MockBillPaymentProvider,
  MockFundingProvider,
  MockPaymentProcessor,
  PaymentLifecycleService,
  TransactionLedger,
  type PaymentProcessor,
} from '@reclaimed/payment-core';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import type { Logger } from './logger.js';
import { SupabaseAuthAdmin, SupabaseAuthVerifier, type AuthAdmin, type AuthVerifier } from './lib/auth.js';
import { TokenCipher } from './lib/crypto.js';
import type { RealtimePublisher } from './realtime/hub.js';
import type { PlaidGateway } from './integrations/plaid/gateway.js';
import { PlaidSdkGateway } from './integrations/plaid/sdk-gateway.js';
import { PlaidWebhookVerifier } from './integrations/plaid/webhook-verifier.js';
import { LithicSandboxProcessor, LithicSdkGateway, type LithicGateway } from './integrations/lithic/lithic.js';
import { StripeSdkGateway, type StripeGateway } from './integrations/stripe/stripe.js';
import { PlaidService } from './services/plaid-service.js';
import { CardMatchingService } from './services/card-matching.js';
import { AccountsService } from './services/accounts-service.js';
import { CardsService } from './services/cards-service.js';
import { HardwareService } from './services/hardware-service.js';
import { ProfileService } from './services/profile-service.js';
import { DashboardService } from './services/dashboard-service.js';
import { OneTapService } from './services/onetap-service.js';
import { StripeChargeService } from './services/stripe-charge-service.js';

export interface ContextOverrides {
  db?: Database;
  authVerifier?: AuthVerifier;
  authAdmin?: AuthAdmin | null;
  plaidGateway?: PlaidGateway | null;
  lithic?: LithicGateway | null;
  stripe?: StripeGateway | null;
  processor?: PaymentProcessor;
  realtime: RealtimePublisher;
  terminalSecrets?: Map<string, string>;
}

/** Wires every dependency from configuration; tests pass overrides for external services. */
export function buildContext(config: Config, logger: Logger, o: ContextOverrides): AppContext {
  const db = o.db ?? createPgDatabase(config.DATABASE_URL);
  const authVerifier = o.authVerifier ?? new SupabaseAuthVerifier(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY ?? config.SUPABASE_SERVICE_ROLE_KEY);
  const authAdmin = o.authAdmin !== undefined ? o.authAdmin : config.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseAuthAdmin(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY) : null;

  const plaidGateway =
    o.plaidGateway !== undefined
      ? o.plaidGateway
      : config.PLAID_CLIENT_ID && config.PLAID_SECRET
        ? new PlaidSdkGateway({
            clientId: config.PLAID_CLIENT_ID,
            secret: config.PLAID_SECRET,
            env: config.PLAID_ENV,
            products: config.PLAID_PRODUCTS,
            countryCodes: config.PLAID_COUNTRY_CODES,
          })
        : null;
  const cipher = config.PLAID_TOKEN_ENCRYPTION_KEY ? new TokenCipher(config.PLAID_TOKEN_ENCRYPTION_KEY) : null;
  const lithic = o.lithic !== undefined ? o.lithic : config.LITHIC_API_KEY ? new LithicSdkGateway(config.LITHIC_API_KEY) : null;
  const stripe = o.stripe !== undefined ? o.stripe : config.STRIPE_SECRET_KEY ? new StripeSdkGateway(config.STRIPE_SECRET_KEY) : null;
  const charges = stripe ? new StripeChargeService(db, stripe, logger) : null;

  let processor: PaymentProcessor = o.processor ?? new MockPaymentProcessor();
  if (!o.processor && config.PAYMENT_MODE === 'lithic_sandbox') {
    if (!lithic) throw new Error('PAYMENT_MODE=lithic_sandbox requires LITHIC_API_KEY.');
    processor = new LithicSandboxProcessor(lithic);
  }

  const funding = new MockFundingProvider();
  const ledger = new TransactionLedger();
  const authorization = new AuthorizationService(db, { funding, selector: new CategoryRoutingSelector(), processor, ledger }, { authorizationTimeoutMs: config.AUTHORIZATION_TIMEOUT_MS });
  const lifecycle = new PaymentLifecycleService(db, { funding, processor, ledger }, { checkoutTtlMs: config.CHECKOUT_TTL_MS });
  const billPay = new BillPaymentService(
    db,
    { provider: new MockBillPaymentProvider(), funding, ledger },
    { submittedToProcessingMs: config.BILL_PAY_STEP_MS, processingToFinalMs: config.BILL_PAY_STEP_MS, completedToReturnMs: config.BILL_PAY_STEP_MS * 2 },
  );

  const matching = new CardMatchingService(db);
  const plaid = new PlaidService(db, plaidGateway, cipher, matching, logger, {
    liabilitiesEnabled: config.ENABLE_PLAID_LIABILITIES,
    webhookUrl: config.PLAID_WEBHOOK_URL,
    redirectUri: config.PLAID_REDIRECT_URI,
    androidPackageName: config.PLAID_ANDROID_PACKAGE_NAME,
  });
  const accounts = new AccountsService(db);
  const cards = new CardsService(db, lithic);
  const pepper = config.NFC_UID_PEPPER ?? config.HARDWARE_BRIDGE_SECRET;
  if (!pepper) logger.warn('NFC_UID_PEPPER / HARDWARE_BRIDGE_SECRET not set — hardware endpoints are disabled.');
  const hardware = new HardwareService(db, { authorization, realtime: o.realtime, logger, charges }, {
    pepper: pepper ?? 'unset-pepper-hardware-disabled',
    debounceMs: config.TAP_DEBOUNCE_MS,
    enrollmentTtlMs: config.ENROLLMENT_TTL_MS,
    paymentMode: config.PAYMENT_MODE,
    lithic: { configured: Boolean(lithic), environment: lithic ? config.LITHIC_ENVIRONMENT : null, asaEnabled: Boolean(lithic && config.LITHIC_ASA_SECRET) },
  });
  const profile = new ProfileService(db, { authAdmin, plaid, logger });
  const dashboard = new DashboardService(db, { accounts, cards, plaid });
  const onetap = new OneTapService(db, { cards, hardware, logger }, {
    enrollmentEnabled: config.isDev || config.HARDWARE_TEST_MODE,
    enrollmentWaitMs: config.ONETAP_ENROLL_WAIT_MS,
  });

  const terminalSecrets = o.terminalSecrets ?? new Map<string, string>();
  if (!o.terminalSecrets && process.env.TEST_TERMINAL_SECRET) {
    terminalSecrets.set(process.env.TEST_TERMINAL_ID ?? 'TERM-DEV-001', process.env.TEST_TERMINAL_SECRET);
  }

  return {
    config,
    logger,
    db,
    authVerifier,
    authAdmin,
    realtime: o.realtime,
    terminalSecrets,
    plaidWebhookVerifier: plaidGateway ? new PlaidWebhookVerifier(plaidGateway) : null,
    lithic,
    stripe,
    services: { plaid, onetap, matching, accounts, cards, hardware, profile, dashboard, authorization, lifecycle, billPay, charges },
  };
}
