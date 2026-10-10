import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { captureLog } from "./helpers/log.ts";
import { createHttpSink, signTap } from "../src/http-sink.ts";
import type { BridgeTapEvent } from "../src/tap.ts";

const SECRET = "test-secret-0123456789abcdef0123456789";
const NO_BACKOFF = [0, 0, 0];
const tap: BridgeTapEvent = {
  tapId: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  cardId: "049315A93F0289",
  cardType: "ntag_or_ultralight",
  terminalId: "store-laptop-1",
  readerName: "ACS ACR1252 Dual Reader PICC",
  timestamp: "2026-10-10T18:39:27.653Z",
  source: "nfc",
};

interface Received {
  headers: IncomingMessage["headers"];
  body: string;
}

let closeServer: (() => Promise<void>) | null = null;
afterEach(async () => {
  await closeServer?.();
  closeServer = null;
});

// Local backend stand-in. `respond` decides per request: a status code, or "drop" to kill the connection.
async function backend(respond: (n: number) => number | "drop") {
  const received: Received[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      const action = respond(received.length);
      if (action === "drop") return req.socket.destroy();
      res.statusCode = action;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closeServer = () => new Promise<void>((r) => server.close(() => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hardware/taps`, received };
}

// What the backend should do to verify, written independently of signTap.
function backendVerifies(r: Received) {
  const ts = r.headers["x-reclaimed-timestamp"] as string;
  const expected = createHmac("sha256", SECRET).update(ts + r.body).digest("hex");
  return r.headers["x-reclaimed-signature"] === expected;
}

describe("signTap", () => {
  it("is hex HMAC-SHA256 of timestamp + body (fixed vector)", () => {
    // echo -n '1700000000000{"a":1}' | openssl dgst -sha256 -hmac secret
    expect(signTap("secret", "1700000000000", '{"a":1}')).toBe(
      "d2933619db6d2527b03c5871b07d6754abe07947900ff9b1eedd05e5a7156292",
    );
  });
});

describe("http sink", () => {
  it("sends the tap as JSON with timestamp and signature headers the backend can verify", async () => {
    const b = await backend(() => 202);
    const before = Date.now();
    await createHttpSink(b.url, SECRET, captureLog().log, NO_BACKOFF).send(tap);

    expect(b.received).toHaveLength(1);
    const r = b.received[0];
    expect(r.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(r.body)).toEqual(tap);
    expect(Number(r.headers["x-reclaimed-timestamp"])).toBeGreaterThanOrEqual(before);
    expect(r.headers["x-reclaimed-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(backendVerifies(r)).toBe(true);
  });

  it("a tampered body fails verification", async () => {
    const b = await backend(() => 202);
    await createHttpSink(b.url, SECRET, captureLog().log, NO_BACKOFF).send(tap);
    const r = b.received[0];
    expect(backendVerifies({ ...r, body: r.body.replace(tap.cardId, "DEADBEEF") })).toBe(false);
  });

  it("retries a dropped connection with the same tapId and a fresh valid signature", async () => {
    const b = await backend((n) => (n < 3 ? "drop" : 200));
    const logs = captureLog();
    await createHttpSink(b.url, SECRET, logs.log, NO_BACKOFF).send(tap);

    expect(b.received).toHaveLength(3);
    expect(b.received.map((r) => JSON.parse(r.body).tapId)).toEqual([tap.tapId, tap.tapId, tap.tapId]);
    expect(b.received.every(backendVerifies)).toBe(true);
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

  it.each([400, 401, 409, 422])("never retries a %i", async (status) => {
    const b = await backend(() => status);
    const logs = captureLog();
    await createHttpSink(b.url, SECRET, logs.log, NO_BACKOFF).send(tap);
    expect(b.received).toHaveLength(1);
    expect(logs.lines.find((l) => l.msg === "tap_failed")).toMatchObject({ status, reason: "http_status" });
  });

  it("does not retry a 5xx either (only network errors are retried)", async () => {
    const b = await backend(() => 503);
    await createHttpSink(b.url, SECRET, captureLog().log, NO_BACKOFF).send(tap);
    expect(b.received).toHaveLength(1);
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

  it("never logs the secret or the signature", async () => {
    const b = await backend((n) => (n === 1 ? "drop" : 200));
    const logs = captureLog();
    await createHttpSink(b.url, SECRET, logs.log, NO_BACKOFF).send(tap);
    const text = JSON.stringify(logs.lines);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(b.received[0].headers["x-reclaimed-signature"] as string);
  });
});
