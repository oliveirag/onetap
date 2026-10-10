import { ERROR_CODES, type ApiResponse, type ErrorCode } from '@reclaimed/shared';
import { env } from './env';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(public code: ErrorCode | 'NETWORK_ERROR', message: string, public status: number | null, public retryable: boolean, public requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Friendly copy for errors the user can act on. Technical details stay in server logs. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK_ERROR') return 'Can’t reach Reclaimed right now. Check your connection and that the API is running.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}/api/v1${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Network request failed', null, true);
  }
  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (json?.success) return json.data;
  if (json && !json.success) throw new ApiError(json.error.code, json.error.message, res.status, json.error.retryable, json.requestId);
  throw new ApiError('INTERNAL_ERROR', ERROR_CODES.INTERNAL_ERROR.message, res.status, true);
}

export const newIdempotencyKey = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
