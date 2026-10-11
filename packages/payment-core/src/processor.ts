import { newProviderReference } from './ids.js';

export interface ProcessorAuthorizationRequest {
  paymentTransactionId: string;
  reference: string;
  amountCents: number;
  currency: string;
  merchantId: string;
  merchantName: string;
  mcc: string;
  reclaimedCardId: string;
  /** Present when the card is mapped to a Lithic Sandbox card. */
  lithicCardToken?: string | null;
  fundingAccountId: string;
}

export interface ProcessorAuthorizationResponse {
  approved: boolean;
  processorReference: string | null;
  /** Normalized decline code when not approved. */
  declineCode?: 'INSUFFICIENT_FUNDS' | 'DECLINED';
  declineReason?: string;
  raw?: Record<string, unknown>;
}

export interface ProcessorActionResponse {
  ok: boolean;
  processorReference: string | null;
  raw?: Record<string, unknown>;
}

/**
 * Provider-independent payment processor. MockPaymentProcessor is the default;
 * apps/api provides LithicSandboxProcessor behind the same interface.
 */
export interface PaymentProcessor {
  readonly name: 'mock' | 'lithic_sandbox';
  authorize(req: ProcessorAuthorizationRequest, signal: AbortSignal): Promise<ProcessorAuthorizationResponse>;
  capture(args: { processorReference: string | null; amountCents: number }): Promise<ProcessorActionResponse>;
  reverse(args: { processorReference: string | null; amountCents: number }): Promise<ProcessorActionResponse>;
  refund(args: {
    processorReference: string | null;
    amountCents: number;
    merchantName: string;
    lithicCardToken?: string | null;
  }): Promise<ProcessorActionResponse>;
}

export interface MockProcessorOptions {
  /** Artificial latency in ms (used to exercise authorization timeouts). */
  latencyMs?: number;
  /** Force every authorization to decline with this code. */
  forceDecline?: 'INSUFFICIENT_FUNDS' | 'DECLINED' | null;
}

/**
 * Deterministic local processor. Approves every authorization that reaches it
 * (funding checks already happened in the authorization engine) unless configured
 * otherwise. Never contacts any network.
 */
export class MockPaymentProcessor implements PaymentProcessor {
  readonly name = 'mock' as const;
  constructor(public options: MockProcessorOptions = {}) {}

  async authorize(_req: ProcessorAuthorizationRequest, signal: AbortSignal): Promise<ProcessorAuthorizationResponse> {
    if (this.options.latencyMs) await abortableDelay(this.options.latencyMs, signal);
    if (this.options.forceDecline) {
      return {
        approved: false,
        processorReference: newProviderReference('MOCKAUTH'),
        declineCode: this.options.forceDecline,
        declineReason: 'Mock processor configured to decline',
      };
    }
    return { approved: true, processorReference: newProviderReference('MOCKAUTH') };
  }

  async capture(): Promise<ProcessorActionResponse> {
    return { ok: true, processorReference: newProviderReference('MOCKCAP') };
  }

  async reverse(): Promise<ProcessorActionResponse> {
    return { ok: true, processorReference: newProviderReference('MOCKREV') };
  }

  async refund(): Promise<ProcessorActionResponse> {
    return { ok: true, processorReference: newProviderReference('MOCKREF') };
  }
}

export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new AbortError());
      },
      { once: true },
    );
  });
}
