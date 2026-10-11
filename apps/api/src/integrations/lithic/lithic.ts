import Lithic from 'lithic';
import type {
  PaymentProcessor,
  ProcessorActionResponse,
  ProcessorAuthorizationRequest,
  ProcessorAuthorizationResponse,
} from '@reclaimed/payment-core';
import { AbortError } from '@reclaimed/payment-core';
import { ReclaimedError } from '@reclaimed/shared';

/**
 * Thin wrapper over the official Lithic SDK (Sandbox only). The generic NFC card
 * stores NO payment credential; a Reclaimed test card is merely mapped to a
 * Lithic Sandbox virtual card token. The PAN is fetched transiently for sandbox
 * simulation calls and never persisted or logged.
 */
export interface LithicGateway {
  createVirtualCard(memo: string): Promise<{ token: string; lastFour: string }>;
  simulateAuthorization(args: { cardToken: string; amountCents: number; descriptor: string; mcc: string; merchantAcceptorId: string }): Promise<{ token: string }>;
  getTransaction(token: string): Promise<{ token: string; status: string; result: string }>;
  simulateClearing(token: string, amountCents: number): Promise<void>;
  simulateVoid(token: string, amountCents: number): Promise<void>;
  simulateReturn(args: { cardToken: string; amountCents: number; descriptor: string }): Promise<{ token: string | null }>;
  /** Throws if the signature (webhook-id / webhook-timestamp / webhook-signature) is invalid. */
  verifySignature(rawBody: string, headers: Record<string, string>, secret: string): void;
}

export class LithicSdkGateway implements LithicGateway {
  private readonly client: Lithic;

  constructor(apiKey: string) {
    this.client = new Lithic({ apiKey, environment: 'sandbox' });
  }

  private async pan(cardToken: string): Promise<string> {
    const card = await this.client.cards.retrieve(cardToken);
    if (!card.pan) throw new ReclaimedError('LITHIC_REQUEST_FAILED', 'Sandbox card PAN unavailable for simulation.');
    return card.pan;
  }

  async createVirtualCard(memo: string) {
    const card = await this.client.cards.create({ type: 'VIRTUAL', memo });
    return { token: card.token, lastFour: card.last_four };
  }

  async simulateAuthorization(args: { cardToken: string; amountCents: number; descriptor: string; mcc: string; merchantAcceptorId: string }) {
    const r = await this.client.transactions.simulateAuthorization({
      amount: args.amountCents,
      descriptor: args.descriptor.slice(0, 25),
      pan: await this.pan(args.cardToken),
      mcc: args.mcc,
      merchant_acceptor_id: args.merchantAcceptorId.slice(0, 15),
    });
    if (!r.token) throw new ReclaimedError('LITHIC_REQUEST_FAILED', 'Lithic did not return a transaction token.');
    return { token: r.token };
  }

  async getTransaction(token: string) {
    const t = await this.client.transactions.retrieve(token);
    return { token: t.token, status: t.status, result: t.result };
  }

  async simulateClearing(token: string, amountCents: number) {
    await this.client.transactions.simulateClearing({ token, amount: amountCents });
  }

  async simulateVoid(token: string, amountCents: number) {
    await this.client.transactions.simulateVoid({ token, amount: amountCents });
  }

  async simulateReturn(args: { cardToken: string; amountCents: number; descriptor: string }) {
    const r = await this.client.transactions.simulateReturn({
      amount: args.amountCents,
      descriptor: args.descriptor.slice(0, 25),
      pan: await this.pan(args.cardToken),
    });
    return { token: r.token ?? null };
  }

  verifySignature(rawBody: string, headers: Record<string, string>, secret: string) {
    this.client.webhooks.verifySignature(rawBody, headers, secret);
  }
}

/**
 * PaymentProcessor backed by Lithic Sandbox simulations. Reclaimed's own
 * authorization engine has already checked the card and mock funds and placed a
 * hold before this is called; Lithic's decision (including our ASA responder, if
 * enrolled) is then honored.
 */
export class LithicSandboxProcessor implements PaymentProcessor {
  readonly name = 'lithic_sandbox' as const;
  constructor(private readonly gateway: LithicGateway) {}

  async authorize(req: ProcessorAuthorizationRequest, signal: AbortSignal): Promise<ProcessorAuthorizationResponse> {
    if (!req.lithicCardToken) {
      return { approved: false, processorReference: null, declineCode: 'DECLINED', declineReason: 'CARD_NOT_MAPPED_TO_LITHIC_SANDBOX' };
    }
    const run = async () => {
      const { token } = await this.gateway.simulateAuthorization({
        cardToken: req.lithicCardToken!,
        amountCents: req.amountCents,
        descriptor: req.merchantName,
        mcc: req.mcc,
        merchantAcceptorId: req.merchantId,
      });
      const txn = await this.gateway.getTransaction(token);
      return { token, txn };
    };
    const { token, txn } = await raceAbort(run(), signal);
    const approved = txn.result === 'APPROVED' && txn.status !== 'DECLINED';
    return {
      approved,
      processorReference: token,
      declineCode: approved ? undefined : txn.result === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'DECLINED',
      declineReason: approved ? undefined : `LITHIC_${txn.result}`,
      raw: { lithicStatus: txn.status, lithicResult: txn.result },
    };
  }

  async capture(args: { processorReference: string | null; amountCents: number }): Promise<ProcessorActionResponse> {
    if (!args.processorReference) return { ok: false, processorReference: null };
    await this.gateway.simulateClearing(args.processorReference, args.amountCents);
    return { ok: true, processorReference: args.processorReference };
  }

  async reverse(args: { processorReference: string | null; amountCents: number }): Promise<ProcessorActionResponse> {
    if (!args.processorReference) return { ok: false, processorReference: null };
    await this.gateway.simulateVoid(args.processorReference, args.amountCents);
    return { ok: true, processorReference: args.processorReference };
  }

  async refund(args: { processorReference: string | null; amountCents: number; merchantName: string; lithicCardToken?: string | null }): Promise<ProcessorActionResponse> {
    if (!args.lithicCardToken) return { ok: false, processorReference: null };
    const r = await this.gateway.simulateReturn({ cardToken: args.lithicCardToken, amountCents: args.amountCents, descriptor: args.merchantName });
    return { ok: true, processorReference: r.token };
  }
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    signal.addEventListener('abort', () => reject(new AbortError()), { once: true });
    p.then(resolve, reject);
  });
}
