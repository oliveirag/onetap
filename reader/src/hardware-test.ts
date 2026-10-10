// npm run hardware:test — guided physical tests on the real reader.
// The operator does each step, the runner records real events, and the operator decides the status.
// Nothing is ever marked PASS automatically. Results go to docs/hardware-test-results.md.
// Options: --only=2,4   run a subset (others are written as NOT RUN)
//          --out=<path> write results somewhere else
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import pino from "pino";
import { createBridge } from "./bridge.ts";
import { errorReason } from "./http-sink.ts";
import { acquireReaderLock } from "./lock.ts";
import { PICC_READER_NAME, startPcsc } from "./pcsc.ts";
import type { TapSink } from "./tap.ts";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../..");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const only = arg("only")?.split(",").map(Number);
const outPath = resolve(ROOT, arg("out") ?? "docs/hardware-test-results.md");

type Status = "PASS" | "FAIL" | "BLOCKED" | "NOT RUN";

// ---------- Event recording ----------

interface Ev {
  time: string;
  msg: string;
  [k: string]: unknown;
}
const RECORDED = new Set([
  "reader_connected", "reader_disconnected", "reader_ignored", "reader_error", "pcsc_error", "pcsc_restarting",
  "card_detected", "card_removed", "card_read_failed", "tap", "duplicate_ignored",
]);
const events: Ev[] = [];
const log = pino(
  { level: "debug", timestamp: pino.stdTimeFunctions.isoTime },
  { write: (line: string) => {
    const e = JSON.parse(line) as Ev;
    if (RECORDED.has(e.msg)) events.push(e);
  } },
);

function describe(e: Ev): string {
  const t = e.time.slice(11, 23);
  const tap = e.tap as { tapId: string; cardId: string; source: string } | undefined;
  const fields =
    e.msg === "tap" ? `cardId=${tap!.cardId} tapId=${tap!.tapId.slice(0, 8)} source=${tap!.source}`
    : e.msg === "card_detected" ? `cardId=${e.cardId} cardType=${e.cardType} atr=${e.atr} readMs=${e.readMs}`
    : e.msg === "duplicate_ignored" ? `cardId=${e.cardId} reason=${e.reason} sinceMs=${e.sinceMs}`
    : e.msg === "card_removed" ? `cardId=${e.cardId}`
    : e.readerName ? `${e.readerName}${e.err ? ` err=${e.err}` : ""}`
    : e.err ? `err=${e.err}` : "";
  return `${t}  ${e.msg.padEnd(18)} ${fields}`;
}

const taps = (evs: Ev[]) => evs.filter((e) => e.msg === "tap").map((e) => (e.tap as { cardId: string }).cardId);
const count = (evs: Ev[], msg: string) => evs.filter((e) => e.msg === msg).length;

// ---------- Terminal I/O ----------

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("SIGINT", () => {
  console.log("\nAborted. No results written.");
  void cleanup().then(() => process.exit(130));
});
const say = (s = "") => console.log(s);
const step = (s: string) => console.log(`  > ${s}`);

async function record(instruction: string): Promise<Ev[]> {
  step(instruction);
  await rl.question("    Press Enter when you have finished. ");
  const from = recordStart;
  recordStart = events.length;
  return events.slice(from);
}
let recordStart = 0;
async function ready() {
  await rl.question("  Press Enter to start. ");
  recordStart = events.length;
}

async function askStatus(): Promise<{ status: Status; issues: string }> {
  for (;;) {
    const a = (await rl.question("  Your verdict: [p]ass / [f]ail / [b]locked: ")).trim().toLowerCase();
    const status = ({ p: "PASS", f: "FAIL", b: "BLOCKED" } as const)[a[0] as "p" | "f" | "b"];
    if (!status) continue;
    const issues = (await rl.question("  Remaining issues (Enter for none): ")).trim();
    return { status, issues };
  }
}

// ---------- Tests ----------

interface Result {
  id: number;
  name: string;
  expected: string;
  actual: string;
  status: Status;
  evidence: string[];
  issues: string;
}

interface Test {
  id: number;
  name: string;
  expected: string;
  run(): Promise<Omit<Result, "id" | "name" | "expected">>;
}

// Shows evidence and an informational check, then asks the operator for the verdict.
async function conclude(evs: Ev[], actual: string, looksRight: boolean) {
  const evidence = evs.map(describe);
  say("\n  Evidence:");
  say(evidence.length ? evidence.map((l) => `    ${l}`).join("\n") : "    (no events)");
  say(`\n  Observed: ${actual}`);
  say(`  Hint: ${looksRight ? "this matches the expected result" : "this does NOT match the expected result"} (you decide)`);
  return { actual, evidence, ...(await askStatus()) };
}

const readersSeen: { name: string; used: boolean }[] = [];
let piccName: string | null = null;

const physicalTests: Test[] = [
  {
    id: 1,
    name: "Reader detection",
    expected: `PC/SC lists "${PICC_READER_NAME}" (used) and the SAM slot (ignored); reader_connected logged once for the PICC`,
    async run() {
      step("Make sure the reader is plugged in. Nothing to tap.");
      await ready();
      const evs = events.filter((e) => e.msg === "reader_connected" || e.msg === "reader_ignored");
      const list = readersSeen.map((r) => `${r.name} (${r.used ? "used" : "ignored"})`).join(", ") || "none";
      const ok = readersSeen.some((r) => r.used && r.name === PICC_READER_NAME) && count(evs, "reader_connected") === 1;
      return conclude(evs, `Readers: ${list}`, ok);
    },
  },
  {
    id: 2,
    name: "NFC scan",
    expected: "One card_detected with a 14-character uppercase hex UID, card type and ATR; exactly one tap",
    async run() {
      await ready();
      const evs = await record("Tap card A once: hold it flat on the reader for about 1 second, then lift it away.");
      const detected = evs.filter((e) => e.msg === "card_detected");
      const t = taps(evs);
      const actual = detected.length
        ? `${detected.length} detection(s), ${t.length} tap(s): ${detected.map((d) => `${d.cardId} (${d.cardType})`).join(", ")}`
        : "No card detected";
      return conclude(evs, actual, t.length === 1 && /^[0-9A-F]{14}$/.test(t[0]));
    },
  },
  {
    id: 3,
    name: "Card removal",
    expected: "card_removed for the same UID, after its card_detected",
    async run() {
      await ready();
      const evs = await record("Place card A on the reader, keep it there for 2 seconds, then lift it away.");
      const det = evs.find((e) => e.msg === "card_detected");
      const rem = evs.find((e) => e.msg === "card_removed");
      const actual = det && rem
        ? `Detected ${det.cardId} at ${det.time.slice(11, 23)}, removed ${rem.cardId} at ${rem.time.slice(11, 23)} (${((Date.parse(rem.time) - Date.parse(det.time)) / 1000).toFixed(1)} s held)`
        : `card_detected: ${det ? "yes" : "no"}, card_removed: ${rem ? "yes" : "no"}`;
      return conclude(evs, actual, !!det && !!rem && det.cardId === rem.cardId && rem.time >= det.time);
    },
  },
  {
    id: 4,
    name: "Repeated taps",
    expected: "Holding for 5 s gives one tap; lift and re-tap (more than 1.5 s apart) gives two taps",
    async run() {
      await ready();
      const held = await record("Part A: place card A on the reader and HOLD it still for 5 seconds, then lift it.");
      say(`    Part A taps: ${taps(held).length}`);
      step("Wait 2 seconds before part B.");
      const retap = await record("Part B: tap card A, lift it, wait 2 seconds, tap it again, lift it.");
      const a = taps(held).length;
      const b = taps(retap).length;
      const actual = `Part A (hold 5 s): ${a} tap(s), ${count(held, "duplicate_ignored")} duplicate(s) ignored. Part B (lift and re-tap): ${b} tap(s)`;
      return conclude([...held, ...retap], actual, a === 1 && b === 2);
    },
  },
  {
    id: 5,
    name: "Multiple cards",
    expected: "Two taps with two distinct UIDs",
    async run() {
      await ready();
      const evs = await record("Tap card A, lift it. Then tap card B, lift it.");
      const t = taps(evs);
      const distinct = new Set(t);
      return conclude(evs, `${t.length} tap(s), ${distinct.size} distinct UID(s): ${[...distinct].join(", ") || "none"}`, t.length === 2 && distinct.size === 2);
    },
  },
  {
    id: 6,
    name: "Disconnection",
    expected: "reader_disconnected on unplug, reader_connected on replug, then a tap is read without restarting",
    async run() {
      await ready();
      const evs = await record(
        "Unplug the reader's USB cable. Wait 3 seconds. Plug it back in. Wait until its light comes on, then tap card A once and lift it.",
      );
      const gone = evs.findIndex((e) => e.msg === "reader_disconnected");
      const back = evs.findIndex((e, i) => i > gone && e.msg === "reader_connected");
      const after = back >= 0 ? taps(evs.slice(back)) : [];
      const actual = `Disconnected: ${gone >= 0 ? evs[gone].time.slice(11, 23) : "not seen"}. Reconnected: ${back >= 0 ? evs[back].time.slice(11, 23) : "not seen"}. Taps after replug: ${after.join(", ") || "none"}`;
      return conclude(evs, actual, gone >= 0 && back > gone && after.length >= 1);
    },
  },
];

async function backendStatus(): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.BACKEND_URL?.trim();
  if (!url) return { ok: false, detail: "BACKEND_URL is not set" };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    await res.body?.cancel();
    return { ok: true, detail: `${url} responded HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `${url} did not respond (${errorReason(err)})` };
  }
}

const backendTests: Omit<Test, "run">[] = [
  { id: 7, name: "Backend communication", expected: "A real tap reaches the backend as a signed request and is accepted" },
  { id: 8, name: "Payment simulation", expected: "A tap at the store page produces an approved Lithic sandbox authorization and a transaction row" },
  { id: 9, name: "Frozen card", expected: "A tap with the Reclaimed card paused is declined" },
  { id: 10, name: "Refund", expected: "A refund of the tapped transaction is recorded against the same transaction" },
];

// ---------- Report ----------

function writeReport(results: Result[], env: Record<string, string>) {
  const row = (r: Result) => `| ${r.id} | ${r.name} | ${r.status} |`;
  const md = [
    "# Hardware test results",
    "",
    "Generated by `npm run hardware:test`. Each status was chosen by the person running the test after",
    "seeing the evidence; the runner never marks a test PASS on its own. Evidence lines are real events",
    "from the reader (UTC time of day, event, fields).",
    "",
    "| | |",
    "|---|---|",
    ...Object.entries(env).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Summary",
    "",
    "| # | Test | Status |",
    "|---|---|---|",
    ...results.map(row),
    "",
    ...results.flatMap((r) => [
      `## ${r.id}. ${r.name}`,
      "",
      `**Status:** ${r.status}`,
      "",
      `**Expected:** ${r.expected}`,
      "",
      `**Actual:** ${r.actual}`,
      "",
      "**Evidence:**",
      "",
      "```",
      ...(r.evidence.length ? r.evidence : ["(none)"]),
      "```",
      "",
      `**Remaining issues:** ${r.issues || "None"}`,
      "",
    ]),
  ].join("\n");
  writeFileSync(outPath, md);
}

// ---------- Main ----------

let cleanup = async () => {};

async function main() {
  const envPath = resolve(import.meta.dirname, "../.env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  say("Reclaimed hardware test\n");
  const lock = acquireReaderLock("hardware:test");
  if ("heldBy" in lock) {
    say(`The ${lock.heldBy.tool} (pid ${lock.heldBy.pid}) is holding the reader. Stop it first, then run hardware:test again.`);
    process.exitCode = 2;
    return;
  }

  const sink: TapSink = { name: "test", send: async () => {}, close: async () => {} };
  const bridge = createBridge({
    config: { terminalId: process.env.TERMINAL_ID?.trim() || "store-laptop-1", debounceMs: Number(process.env.DEBOUNCE_MS) || 1500, demoCardUid: null },
    sinks: [sink],
    log,
  });
  const pcsc = startPcsc(log, {
    ...bridge.cardHandlers,
    onReaderSeen: (name, used) => {
      readersSeen.push({ name, used });
      if (used) piccName = name;
    },
  });
  cleanup = async () => {
    lock.release();
    await pcsc.stop();
    rl.close();
  };

  const [{ stdout: macVersion }, { stdout: macBuild }] = await Promise.all([
    run("sw_vers", ["-productVersion"]),
    run("sw_vers", ["-buildVersion"]),
  ]);
  await new Promise((r) => setTimeout(r, 1500)); // let PC/SC announce readers
  const env = {
    Date: new Date().toISOString(),
    macOS: `${macVersion.trim()} (${macBuild.trim()})`,
    Node: process.version,
    Reader: piccName ?? "not detected",
    "Debounce window": `${Number(process.env.DEBOUNCE_MS) || 1500} ms`,
  };
  for (const [k, v] of Object.entries(env)) say(`  ${k}: ${v}`);
  say(`\nResults will be written to ${outPath}`);
  say("Press Ctrl+C at any time to abort without writing results.");

  const results: Result[] = [];
  const selected = (id: number) => !only || only.includes(id);

  for (const test of physicalTests) {
    if (!selected(test.id)) {
      results.push({ id: test.id, name: test.name, expected: test.expected, actual: "Not run", status: "NOT RUN", evidence: [], issues: "" });
      continue;
    }
    say(`\n${"=".repeat(70)}\nTest ${test.id}: ${test.name}\n  Expected: ${test.expected}\n`);
    results.push({ id: test.id, name: test.name, expected: test.expected, ...(await test.run()) });
  }

  const backend = await backendStatus();
  for (const test of backendTests) {
    const base = { id: test.id, name: test.name, expected: test.expected };
    if (!selected(test.id)) {
      results.push({ ...base, actual: "Not run", status: "NOT RUN", evidence: [], issues: "" });
      continue;
    }
    say(`\n${"=".repeat(70)}\nTest ${test.id}: ${test.name}\n  Expected: ${test.expected}\n`);
    if (!backend.ok) {
      say(`  BLOCKED: backend not connected (${backend.detail})`);
      results.push({ ...base, actual: `Not run: ${backend.detail}`, status: "BLOCKED", evidence: [], issues: "Backend not connected" });
      continue;
    }
    say(`  ${backend.detail}. The steps for this test are not automated yet.`);
    step("Run it by hand against the backend, then report what happened.");
    const actual = (await rl.question("  What happened? ")).trim() || "(no description)";
    results.push({ ...base, actual, evidence: [backend.detail], ...(await askStatus()) });
  }

  writeReport(results, env);
  say(`\n${"=".repeat(70)}\nSummary`);
  for (const r of results) say(`  ${String(r.id).padStart(2)}. ${r.name.padEnd(24)} ${r.status}`);
  say(`\nWritten to ${outPath}`);
}

try {
  await main();
} finally {
  await cleanup();
}
process.exit();
