import type { Logger } from "pino";
import {
  API_PREFIX,
  HARDWARE_BRIDGE_ID_HEADER,
  HARDWARE_SIGNATURE_HEADER,
  HARDWARE_TIMESTAMP_HEADER,
} from "@shared/constants.ts";
import { signRequest } from "@shared/node/index.ts";
import type { BridgeTapEvent, TapSink } from "./tap.ts";

// The backend route (apps/api/src/routes/hardware.ts), behind requireBridge.
export const TAP_EVENTS_PATH = `${API_PREFIX}/hardware/tap-events`;

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [250, 500, 1000];
const TIMEOUT_MS = 3000;

// The backend's response envelope (ApiResponse in packages/shared).
type ApiReply =
  | { success: true; data: { tapId: string; outcome: string; message?: string } & Record<string, unknown> }
  | { success: false; error: { code: string; message: string; retryable?: boolean } };

// fetch wraps network failures; the useful part is the cause's code (ECONNREFUSED) or message.
export function errorReason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause as (Error & { code?: string }) | undefined;
  return cause?.code || cause?.message || err.message;
}

class HttpStatusError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryable: boolean) {
    super(`HTTP ${status} ${code}`);
  }
}

// POSTs each tap to BRIDGE_API_URL + /api/v1/hardware/tap-events, signed exactly as requireBridge verifies:
// hex HMAC-SHA256 of `${timestamp}.POST.${path}.${body}` with HARDWARE_BRIDGE_SECRET, ISO timestamp,
// 5-minute skew window. Retries network errors, 5xx, 429 and errors the backend marks retryable; the same
// tapId is reused on every attempt, and the backend dedupes on it.
export function createHttpSink(apiUrl: string, secret: string, log: Logger, backoffMs = BACKOFF_MS): TapSink {
  const url = apiUrl.replace(/\/+$/, "") + TAP_EVENTS_PATH;
  let closing = false;

  async function post(tap: BridgeTapEvent, body: string) {
    const timestamp = new Date().toISOString();
    const headers = {
      "content-type": "application/json",
      [HARDWARE_TIMESTAMP_HEADER]: timestamp,
      [HARDWARE_BRIDGE_ID_HEADER]: tap.bridgeId,
    };
    log.debug({ tapId: tap.tapId, url, headers }, "tap_request"); // signature deliberately not logged
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, [HARDWARE_SIGNATURE_HEADER]: signRequest(secret, { timestamp, method: "POST", path: TAP_EVENTS_PATH, body }) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const reply = (await res.json().catch(() => null)) as ApiReply | null;
    if (res.ok && reply?.success) return { status: res.status, data: reply.data };
    const code = reply && !reply.success ? reply.error.code : "HTTP_ERROR";
    const retryable = res.status >= 500 || res.status === 429 || Boolean(reply && !reply.success && reply.error.retryable);
    throw new HttpStatusError(res.status, code, retryable);
  }

  return {
    name: "http",
    async send(tap: BridgeTapEvent) {
      const body = JSON.stringify(tap);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const { status, data } = await post(tap, body);
          log.info({ tapId: tap.tapId, output: "http", status, attempt, outcome: data.outcome, message: data.message }, "tap_sent");
          log.debug({ tapId: tap.tapId, response: data }, "tap_response");
          return;
        } catch (err) {
          const http = err instanceof HttpStatusError ? err : null;
          const reason = http ? http.code : errorReason(err);
          const last = attempt === MAX_ATTEMPTS || closing || (http !== null && !http.retryable);
          log[last ? "error" : "warn"](
            { tapId: tap.tapId, output: "http", attempt, status: http?.status, reason, willRetry: !last },
            "tap_failed",
          );
          if (last) return;
          await new Promise((r) => setTimeout(r, backoffMs[attempt - 1] ?? 0));
        }
      }
    },
    async close() {
      closing = true; // in-flight sends finish their current attempt, then stop retrying
    },
  };
}
