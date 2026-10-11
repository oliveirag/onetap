import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { verifyRequestSignature } from "@shared/node/index.ts";
import { tapEventSchema } from "@shared/schemas.ts";
import { captureLog } from "./helpers/log.ts";
import { createHttpSink, TAP_EVENTS_PATH } from "../src/http-sink.ts";
import type { BridgeTapEvent } from "../src/tap.ts";

const SECRET = "test-secret-0123456789abcdef0123456789";
const NO_BACKOFF = [0, 0, 0];
const tap: BridgeTapEvent = {
  tapId: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  uid: "049315A93F0289",
  cardType: "ntag_or_ultralight",
  bridgeId: "store-laptop-1",
  readerName: "ACS ACR1252 Dual Reader PICC",
  presentedAt: "2026-10-10T18:39:27.653Z",
  source: "nfc",
};

interface Received {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

type Reply = { status: number; error?: { code: string; retryable?: boolean } } | "drop";
const OK: Reply = { status: 200 };

let closeServer: (() => Promise<void>) | null = null;
afterEach(async () => {
  await closeServer?.();
  closeServer = null;
});

// Local backend stand-in that answers with the API's envelope. `respond` decides per request.
async function backend(respond: (n: number) => Reply) {
  const received: Received[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method!, path: req.url!.split("?")[0], headers: req.headers, body });
      const r = respond(received.length);
      if (r === "drop") return req.socket.destroy();
      res.statusCode = r.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(
        r.error
          ? { success: false, error: { message: r.error.code, retryable: false, ...r.error } }
          : { success: true, data: { tapId: JSON.parse(body).tapId, outcome: "UNKNOWN_CARD", message: "This NFC card is not enrolled in Reclaimed." } },
      ));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closeServer = () => new Promise<void>((r) => server.close(() => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, received };
}

// Exactly what the API's requireBridge does (apps/api/src/middleware/auth.ts).
function backendVerifies(r: Received, secret = SECRET) {
  const sig = (r.headers["x-reclaimed-signature"] as string) ?? "";
  const parts = { timestamp: (r.headers["x-reclaimed-timestamp"] as string) ?? "", method: r.method, path: r.path, body: r.body };
  return Boolean(r.headers["x-reclaimed-bridge-id"]) && verifyRequestSignature(secret, parts, sig);
}

describe("http sink", () => {
  it("POSTs to /api/v1/hardware/tap-events with headers the backend verifies", async () => {
    const b = await backend(() => OK);
    await createHttpSink(b.url, SECRET, captureLog().log, NO_BACKOFF).send(tap);

    expect(b.received).toHaveLength(1);
    const r = b.received[0];
    expect(r.method).toBe("POST");
    expect(r.path).toBe(TAP_EVENTS_PATH);
    expect(TAP_EVENTS_PATH).toBe("/api/v1/hardware/tap-events");
    expect(r.headers["content-type"]).toBe("application/json");
    expect(r.headers["x-reclaimed-bridge-id"]).toBe(tap.bridgeId);
    expect(new Date(r.headers["x-reclaimed-timestamp"] as string).toISOString()).toBe(r.headers["x-reclaimed-timestamp"]);
    expect(JSON.parse(r.body)).toEqual(tap);
    expect(tapEventSchema.safeParse(JSON.parse(r.body)).success).toBe(true);
    expect(backendVerifies(r)).toBe(true);
  });

  it("fails verification with a tampered body, a different path or the wrong secret", async () => {
    const b = await backend(() => OK);
    await createHttpSink(b.url, SECRET, captureLog().log, NO_BACKOFF).send(tap);
    const r = b.received[0];
    expect(backendVerifies({ ...r, body: r.body.replace(tap.uid, "DEADBEEF") })).toBe(false);
    expect(backendVerifies({ ...r, path: "/hardware/taps" })).toBe(false);
    expect(backendVerifies(r, "another-secret-0123456789abcdef")).toBe(false);
  });

  it("works when BRIDGE_API_URL has a trailing slash", async () => {
    const b = await backend(() => OK);
    await createHttpSink(`${b.url}/`, SECRET, captureLog().log, NO_BACKOFF).send(tap);
    expect(b.received[0].path).toBe(TAP_EVENTS_PATH);
    expect(backendVerifies(b.received[0])).toBe(true);
  });

  it("logs the backend's outcome", async () => {
    const b = await backend(() => OK);
    const logs = captureLog();
    await createHttpSink(b.url, SECRET, logs.log, NO_BACKOFF).send(tap);
    expect(logs.lines.find((l) => l.msg === "tap_sent")).toMatchObject({ status: 200, attempt: 1, outcome: "UNKNOWN_CARD" });
  });

  it("retries a dropped connection with the same tapId and a fresh valid signature", async () => {
    const b = await backend((n) => (n < 3 ? "drop" : OK));
    const logs = captureLog();
    await createHttpSink(b.url, SECRET, logs.log, NO_BACKOFF).send(tap);

    expect(b.received).toHaveLength(3);
    expect(b.received.map((r) => JSON.parse(r.body).tapId)).toEqual([tap.tapId, tap.tapId, tap.tapId]);
    expect(b.received.every((r) => backendVerifies(r))).toBe(true);
    expect(logs.lines.filter((l) => l.msg === "tap_failed").map((l) => l.willRetry)).toEqual([true, true]);
    expect(logs.lines.find((l) => l.msg === "tap_sent")).toMatchObject({ attempt: 3, status: 200 });
  });

  it("gives up after 4 attempts when the backend is unreachable", async () => {
    const b = await backend(() => "drop");
    const logs = captureLog();
    await createHttpSink(b.url, SECRET, logs.log, NO_BACKOFF).send(tap);
    expect(b.received).toHaveLength(4);
    expect(logs.lines.filter((l) => l.msg === "tap_failed").at(-1)).toMatchObject({ attempt: 4, willRetry: false });
    expect(logs.lines.find((l) => l.msg === "tap_failed")?.reason).toMatch(/\S/); // a readable reason, not ""
  });

  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "HARDWARE_AUTH_FAILED"],
    [409, "NFC_DUPLICATE_TAP"],
  ])("never retries a %i (%s) and logs the backend's error code", async (status, code) => {
    const b = await backend(() => ({ status, error: { code } }));
    const logs = captureLog();
    await createHttpSink(b.url, SECRET, logs.log, NO_BACKOFF).send(tap);
    expect(b.received).toHaveLength(1);
    expect(logs.lines.find((l) => l.msg === "tap_failed")).toMatchObject({ status, reason: code, willRetry: false });
  });

  it.each([
    ["a 503", { status: 503, error: { code: "SERVICE_UNAVAILABLE" } }],
    ["a 429", { status: 429, error: { code: "RATE_LIMITED" } }],
    ["a 4xx the backend marks retryable", { status: 409, error: { code: "CONFLICT", retryable: true } }],
  ] as [string, Reply][])("retries %s", async (_name, reply) => {
    const b = await backend((n) => (n === 1 ? reply : OK));
    await createHttpSink(b.url, SECRET, captureLog().log, NO_BACKOFF).send(tap);
    expect(b.received).toHaveLength(2);
  });

  it("stops retrying once the sink is closing", async () => {
    let sink!: ReturnType<typeof createHttpSink>;
    const b = await backend(() => {
      void sink.close();
      return "drop";
    });
    sink = createHttpSink(b.url, SECRET, captureLog().log, NO_BACKOFF);
    await sink.send(tap);
    expect(b.received).toHaveLength(1);
  });

  it("never logs the secret or the signature, even at debug level", async () => {
    const b = await backend((n) => (n === 1 ? "drop" : OK));
    const logs = captureLog(); // records debug and up
    await createHttpSink(b.url, SECRET, logs.log, NO_BACKOFF).send(tap);
    const text = JSON.stringify(logs.lines);
    expect(logs.lines.some((l) => l.msg === "tap_request")).toBe(true);
    expect(text).not.toContain(SECRET);
    for (const r of b.received) expect(text).not.toContain(r.headers["x-reclaimed-signature"] as string);
  });
});
