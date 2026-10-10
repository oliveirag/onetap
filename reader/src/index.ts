// Reclaimed hardware bridge: reads NFC card UIDs from the ACR1252U and reports each tap.
// It never writes to cards and never treats a tap as a payment.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import pino from "pino";
import { loadConfig, describeConfig } from "./config.ts";
import { createBridge } from "./bridge.ts";
import { startPcsc } from "./pcsc.ts";
import { startWsSink } from "./ws-sink.ts";
import { createHttpSink } from "./http-sink.ts";
import { acquireReaderLock } from "./lock.ts";
import type { TapSink } from "./tap.ts";

const FLUSH_TIMEOUT_MS = 5000;

const envPath = resolve(import.meta.dirname, "../.env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const config = loadConfig();
const log = pino({
  level: config.logLevel,
  base: { terminalId: config.terminalId },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ["secret", "*.secret", "HARDWARE_BRIDGE_SECRET", "headers.*"], censor: "[redacted]" },
});
if (!existsSync(envPath)) log.warn({ envPath }, "env_file_missing_using_defaults");
log.info({ config: describeConfig(config) }, "bridge_starting");

const lock = acquireReaderLock("bridge");
if ("heldBy" in lock) {
  log.error({ heldBy: lock.heldBy }, "reader_in_use");
  console.error(`The reader is in use by ${lock.heldBy.tool} (pid ${lock.heldBy.pid}). Stop it first.`);
  process.exit(1);
}
process.on("exit", lock.release);

const sinks: TapSink[] = [];
if (config.tapOutput !== "http") sinks.push(await startWsSink(config.wsPort, log));
if (config.tapOutput !== "websocket") sinks.push(createHttpSink(config.tapUrl!, config.secret!, log));

const bridge = createBridge({ config, sinks, log });
const pcsc = startPcsc(log, bridge.cardHandlers);

// Keyboard: "f" sends a fake tap. Raw keypresses in a terminal; "f" + Enter when stdin is piped.
let stopKeyboard = () => {};
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key: string) => {
    if (key === "\u0003") void shutdown("SIGINT"); // raw mode swallows Ctrl+C
    else if (key.toLowerCase() === "f") bridge.fakeTap();
  });
  stopKeyboard = () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  };
} else {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (line.trim().toLowerCase() === "f") bridge.fakeTap();
  });
  stopKeyboard = () => rl.close();
}
log.info({ fakeTapKey: "f", demoCardUid: config.demoCardUid }, "bridge_ready");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal, pendingSends: bridge.pendingCount() }, "bridge_stopping");

  stopKeyboard();
  await pcsc.stop();

  // Let in-flight sends (and their retries) finish, but don't hang forever.
  await bridge.flush(FLUSH_TIMEOUT_MS);

  await Promise.allSettled(sinks.map((s) => s.close()));
  log.info("bridge_stopped");
  log.flush();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
