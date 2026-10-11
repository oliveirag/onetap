import type { AuthorizationDto, HardwareStatusDto, SimulatedTransactionDto, TestMerchant } from '@reclaimed/shared';

export interface GatewayConfig {
  terminalCode: string;
  apiUrl: string;
  merchants: TestMerchant[];
  configured: boolean;
}

export class GatewayError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idem?: string): Promise<T> {
  const res = await fetch(`/gateway${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(idem ? { 'idempotency-key': idem } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json?.success) throw new GatewayError(json?.error?.code ?? 'HTTP_ERROR', json?.error?.message ?? `HTTP ${res.status}`);
  return json.data as T;
}

export const gateway = {
  config: () => call<GatewayConfig>('GET', '/config'),
  status: () => call<HardwareStatusDto & { terminal: { id: string; code: string } }>('GET', '/status'),
  checkout: (b: { merchantId: string; merchantName: string; mcc: string; amountCents: number; currency: string }) =>
    call<SimulatedTransactionDto>('POST', '/checkout', b, crypto.randomUUID()),
  transaction: (id: string) => call<{ transaction: SimulatedTransactionDto; authorization: AuthorizationDto | null }>('GET', `/transactions/${id}`),
  action: (id: string, action: 'capture' | 'settle' | 'reverse' | 'refund' | 'cancel', body: object = {}) =>
    call<SimulatedTransactionDto>('POST', `/transactions/${id}/${action}`, body, action === 'refund' ? crypto.randomUUID() : undefined),
};
