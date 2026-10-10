import { createHmac } from "node:crypto";
import type { Logger } from "pino";
import type { BridgeTapEvent, TapSink } from "./tap.ts";

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [250, 500, 1000];
const TIMEOUT_MS = 3000;

// Signature the backend must verify: hex HMAC-SHA256 of (timestamp + body), keyed with HARDWARE_BRIDGE_SECRET.
// timestamp is Unix milliseconds as a string, sent in X-Reclaimed-Timestamp; body is the exact JSON sent.
export function signTap(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(timestamp + body).digest("hex");
}

// fetch wraps network failures; the useful part is the cause's code (ECONNREFUSED) or message.
export function errorReason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause as (Error & { code?: string }) | undefined;
  return cause?.code || cause?.message || err.message;
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

// POSTs each tap to the backend. Retries network errors only; the same tapId is reused on every attempt.
export function createHttpSink(url: string, secret: string, log: Logger, backoffMs = BACKOFF_MS): TapSink {
  let closing = false;

  async function post(body: string): Promise<number> {
    const timestamp = Date.now().toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-reclaimed-timestamp": timestamp,
        "x-reclaimed-signature": signTap(secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel();
    if (!res.ok) throw new HttpStatusError(res.status);
    return res.status;
  }

  return {
    name: "http",
    async send(tap: BridgeTapEvent) {
      const body = JSON.stringify(tap);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const status = await post(body);
          log.info({ tapId: tap.tapId, output: "http", status, attempt }, "tap_sent");
          return;
        } catch (err) {
          // Any HTTP response (4xx or 5xx) means the backend saw the request: don't resend.
          if (err instanceof HttpStatusError) {
            log.error({ tapId: tap.tapId, output: "http", status: err.status, attempt, reason: "http_status" }, "tap_failed");
            return;
          }
          const reason = errorReason(err);
          const last = attempt === MAX_ATTEMPTS || closing;
          log[last ? "error" : "warn"]({ tapId: tap.tapId, output: "http", attempt, reason, willRetry: !last }, "tap_failed");
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
