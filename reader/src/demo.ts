// npm run demo:hardware — demo-day launcher for the bridge.
// Checks the reader and the backend, keeps the Mac awake (caffeinate), runs the bridge in "both" mode,
// restarts it if it crashes, and stops everything on Ctrl+C.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify, parseEnv } from "node:util";
import { loadConfig } from "./config.ts";
import { readerHolder } from "./lock.ts";
import { isPiccReader } from "./pcsc.ts";

const RESTART_DELAY_MS = 2000;
const HEALTH_TIMEOUT_MS = 3000;
const STOP_TIMEOUT_MS = 8000;

const run = promisify(execFile);
const readerDir = resolve(import.meta.dirname, "..");
const envPath = resolve(readerDir, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);
process.env.TAP_OUTPUT = "both";

const stamp = () => new Date().toISOString().slice(11, 19);
const say = (msg: string) => console.log(`[demo ${stamp()}] ${msg}`);
function fail(problem: string, fix: string): never {
  console.error(`\n  ✖ ${problem}\n    → ${fix}\n`);
  process.exit(1);
}

// The terminal ID lives in the repo's root .env (TEST_TERMINAL_ID), not in reader/.env.
function terminalId(): string {
  if (process.env.TEST_TERMINAL_ID) return process.env.TEST_TERMINAL_ID;
  try {
    return parseEnv(readFileSync(resolve(readerDir, "../.env"), "utf8")).TEST_TERMINAL_ID ?? "(not set)";
  } catch {
    return "(not set)";
  }
}

// Reader names as macOS lists them, e.g. "ACS ACR1252 Dual Reader PICC (no card present)" → name only.
async function findPiccReader(): Promise<string | null> {
  try {
    const { stdout } = await run("system_profiler", ["-json", "SPSmartCardsDataType"], { timeout: 10_000 });
    const sections = (JSON.parse(stdout) as { SPSmartCardsDataType?: Record<string, unknown>[] }).SPSmartCardsDataType ?? [];
    const readers = Object.entries(sections.find((s) => s._name === "READERS") ?? {})
      .filter(([k]) => k.startsWith("#"))
      .map(([, v]) => String(v).replace(/\s*\(.*\)$/, ""));
    return readers.find(isPiccReader) ?? null;
  } catch {
    return null;
  }
}

async function checkBackend(apiUrl: string): Promise<void> {
  try {
    const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: { status?: string } } | null;
    if (res.ok && body?.data?.status === "ok") return;
    fail(`Backend at ${apiUrl} answered /health with HTTP ${res.status}.`, "Check the API terminal for errors, then restart it (npm run dev:api).");
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).name;
    fail(`Backend at ${apiUrl} is not reachable (${cause}).`, "Start it in another terminal: npm run dev:api");
  }
}

// ---- Preflight ----
let config;
try {
  config = loadConfig();
} catch (err) {
  fail(`reader/.env is invalid: ${(err as Error).message}`, "Fix reader/.env (see reader/.env.example).");
}

const holder = readerHolder();
if (holder) fail(`The reader is already in use by ${holder.tool} (pid ${holder.pid}).`, "Stop that process first (Ctrl+C in its terminal).");

const readerName = await findPiccReader();
if (!readerName) {
  fail("NFC reader not detected (no \"ACS ACR1252 … PICC\" in macOS Smart Cards).", "Plug the ACR1252U in (directly or via the hub), wait 3 s, and run this again.");
}
await checkBackend(config.apiUrl!);

// ---- Banner ----
const line = "─".repeat(56);
console.log(`\n${line}
  Reclaimed hardware demo
${line}
  Reader       ${readerName}
  Terminal ID  ${terminalId()}
  Backend      ${config.apiUrl}  (healthy)
  Output       ${config.tapOutput}  (store page ws://127.0.0.1:${config.wsPort} + backend)
  Demo card    ${config.demoCardUid ?? "(DEMO_CARD_UID not set — fake tap disabled)"}
  Bridge ID    ${config.bridgeId}

  Press f for fake tap · Ctrl+C to stop
${line}\n`);

// ---- Keep awake + supervise the bridge ----
// -w: caffeinate exits by itself if this process dies without cleaning up.
const caffeinate = spawn("caffeinate", ["-dimsu", "-w", String(process.pid)], { stdio: "ignore" });
say(`caffeinate -dimsu running (pid ${caffeinate.pid})`);

let bridge: ChildProcess | null = null;
let stopping = false;
let restartTimer: NodeJS.Timeout | null = null;
let starts = 0;

function startBridge() {
  restartTimer = null;
  starts++;
  // stdin is shared so the bridge reads the "f" key (and Ctrl+C in raw mode) directly.
  bridge = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: readerDir, stdio: "inherit", env: process.env });
  say(`bridge started (pid ${bridge.pid}${starts > 1 ? `, restart #${starts - 1}` : ""})`);
  bridge.on("exit", (code, signal) => {
    bridge = null;
    // A crash can leave the terminal in raw mode, which swallows Ctrl+C.
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    // Exit 0 is the bridge's own clean shutdown (Ctrl+C in its raw-mode keyboard handler).
    if (stopping || code === 0) return void stopAll("bridge stopped");
    say(`bridge exited (${signal ?? `code ${code}`}) — restarting in ${RESTART_DELAY_MS / 1000}s`);
    restartTimer = setTimeout(startBridge, RESTART_DELAY_MS);
  });
}

async function stopAll(reason: string) {
  if (stopping && !bridge) return finish(reason);
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (bridge) {
    say("stopping bridge…");
    const b = bridge;
    const exited = new Promise((r) => b.once("exit", r));
    b.kill("SIGTERM");
    const timer = setTimeout(() => b.kill("SIGKILL"), STOP_TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
  }
  finish(reason);
}

let finished = false;
function finish(reason: string) {
  if (finished) return;
  finished = true;
  caffeinate.kill();
  say(`${reason}; caffeinate stopped. Bye.`);
  process.exit(0);
}

// Ctrl+C when the bridge is not in raw mode (e.g. during a restart delay) reaches us as SIGINT.
// The bridge gets the same SIGINT from the terminal and shuts itself down.
process.on("SIGINT", () => void stopAll("Ctrl+C"));
process.on("SIGTERM", () => void stopAll("SIGTERM"));

startBridge();
