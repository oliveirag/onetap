import { API_PREFIX, HARDWARE_SIGNATURE_HEADER, HARDWARE_TIMESTAMP_HEADER, TERMINAL_ID_HEADER, type ApiResponse } from '../index';
import { signRequest } from './index';

export class TerminalApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly body: unknown) {
    super(message);
    this.name = 'TerminalApiError';
  }
}

/** HMAC-signed client for /api/v1/test-terminal/* (used by the terminal gateway and hardware tests). */
export function createTerminalClient(opts: { baseUrl: string; terminalCode: string; secret: string }) {
  return async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const full = `${API_PREFIX}${path}`;
    const raw = method === 'GET' ? '' : JSON.stringify(body ?? {});
    const timestamp = new Date().toISOString();
    const res = await fetch(`${opts.baseUrl.replace(/\/$/, '')}${full}`, {
      method,
      headers: {
        'content-type': 'application/json',
        [TERMINAL_ID_HEADER]: opts.terminalCode,
        [HARDWARE_TIMESTAMP_HEADER]: timestamp,
        [HARDWARE_SIGNATURE_HEADER]: signRequest(opts.secret, { timestamp, method, path: full, body: raw }),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: method === 'GET' ? undefined : raw,
    });
    const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (!json) throw new TerminalApiError(res.status, 'HTTP_ERROR', `HTTP ${res.status}`, null);
    if (!json.success) throw new TerminalApiError(res.status, json.error.code, json.error.message, json);
    return json.data;
  };
}
