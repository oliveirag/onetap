import {
  API_PREFIX,
  HARDWARE_BRIDGE_ID_HEADER,
  HARDWARE_SIGNATURE_HEADER,
  HARDWARE_TIMESTAMP_HEADER,
  type ApiResponse,
  type HardwareReaderEvent,
  type TapEvent,
  type TapResultDto,
} from '@reclaimed/shared';
import { signRequest } from '@reclaimed/shared/node';

export interface BridgeApi {
  sendTap(tap: TapEvent): Promise<TapResultDto>;
  sendReaderEvent(e: HardwareReaderEvent): Promise<void>;
  heartbeat(readers: string[]): Promise<void>;
}

export class BridgeApiError extends Error {
  constructor(message: string, public readonly status: number | null, public readonly code: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'BridgeApiError';
  }
}

/**
 * HMAC-signed client for the Reclaimed hardware endpoints. Tap and reader events
 * carry bridge-generated UUIDs, so retries are safe (the API dedupes on them).
 */
export class HttpBridgeApi implements BridgeApi {
  constructor(
    private readonly opts: { baseUrl: string; secret: string; bridgeId: string; fetchImpl?: typeof fetch; maxAttempts?: number; timeoutMs?: number },
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const full = `${API_PREFIX}${path}`;
    const raw = JSON.stringify(body);
    const attempts = this.opts.maxAttempts ?? 4;
    let lastErr: BridgeApiError | null = null;
    for (let i = 0; i < attempts; i++) {
      const timestamp = new Date().toISOString();
      try {
        const res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, '')}${full}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [HARDWARE_TIMESTAMP_HEADER]: timestamp,
            [HARDWARE_BRIDGE_ID_HEADER]: this.opts.bridgeId,
            [HARDWARE_SIGNATURE_HEADER]: signRequest(this.opts.secret, { timestamp, method: 'POST', path: full, body: raw }),
          },
          body: raw,
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
        });
        const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
        if (res.ok && json?.success) return json.data;
        const code = json && !json.success ? json.error.code : 'HTTP_ERROR';
        const retryable = res.status >= 500 || res.status === 429 || Boolean(json && !json.success && json.error.retryable);
        lastErr = new BridgeApiError(json && !json.success ? json.error.message : `HTTP ${res.status}`, res.status, code, retryable);
        if (!retryable) throw lastErr;
      } catch (err) {
        if (err instanceof BridgeApiError && !err.retryable) throw err;
        lastErr = err instanceof BridgeApiError ? err : new BridgeApiError(`Backend unreachable: ${(err as Error).message}`, null, 'HARDWARE_BRIDGE_UNAVAILABLE', true);
      }
      await new Promise((r) => setTimeout(r, Math.min(250 * 2 ** i, 2_000)));
    }
    throw lastErr ?? new BridgeApiError('Unknown error', null, 'INTERNAL_ERROR', false);
  }

  sendTap(tap: TapEvent) {
    return this.post<TapResultDto>('/hardware/tap-events', tap);
  }
  async sendReaderEvent(e: HardwareReaderEvent) {
    await this.post('/hardware/reader-events', e);
  }
  async heartbeat(readers: string[]) {
    await this.post('/hardware/heartbeat', { bridgeId: this.opts.bridgeId, readers });
  }
}
