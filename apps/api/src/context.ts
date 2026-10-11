import type { Database } from '@reclaimed/database';
import type { AuthorizationService, BillPaymentService, PaymentLifecycleService } from '@reclaimed/payment-core';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { AuthAdmin, AuthVerifier } from './lib/auth.js';
import type { RealtimePublisher } from './realtime/hub.js';
import type { PlaidService } from './services/plaid-service.js';
import type { PlaidWebhookVerifier } from './integrations/plaid/webhook-verifier.js';
import type { LithicGateway } from './integrations/lithic/lithic.js';
import type { CardMatchingService } from './services/card-matching.js';
import type { AccountsService } from './services/accounts-service.js';
import type { CardsService } from './services/cards-service.js';
import type { HardwareService } from './services/hardware-service.js';
import type { ProfileService } from './services/profile-service.js';
import type { DashboardService } from './services/dashboard-service.js';
import type { OneTapService } from './services/onetap-service.js';

export interface AppContext {
  config: Config;
  logger: Logger;
  db: Database;
  authVerifier: AuthVerifier;
  authAdmin: AuthAdmin | null;
  realtime: RealtimePublisher;
  /** terminal_code → shared secret (from env; only the hash is stored in the DB). */
  terminalSecrets: Map<string, string>;
  plaidWebhookVerifier: PlaidWebhookVerifier | null;
  lithic: LithicGateway | null;
  services: {
    plaid: PlaidService;
    onetap: OneTapService;
    matching: CardMatchingService;
    accounts: AccountsService;
    cards: CardsService;
    hardware: HardwareService;
    profile: ProfileService;
    dashboard: DashboardService;
    authorization: AuthorizationService;
    lifecycle: PaymentLifecycleService;
    billPay: BillPaymentService;
  };
}
