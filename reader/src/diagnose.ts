// npm run hardware:diagnose — checks the NFC reader end to end and waits for one tap.
// Read-only: no sudo, no writes to cards or system settings. Refuses to run while the bridge holds the reader.
// Options: --tap-timeout=<seconds> (default 10)
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pino from "pino";
import { acquireReaderLock, readerHolder } from "./lock.ts";
import type { CardDetails } from "./pcsc.ts";
import type { CardType } from "./atr.ts";

const run = promisify(execFile);
const ACS_VENDOR_ID = "0x072f";
const CCID_PLIST = "/Library/Preferences/com.apple.security.smartcard";
const CCID_FIX = `sudo defaults write ${CCID_PLIST} useIFDCCID -bool yes`;
const READER_WAIT_MS = 3000;
const REMOVAL_WAIT_MS = 10_000;
const tapTimeoutMs =
  1000 * Number(process.argv.find((a) => a.startsWith("--tap-timeout="))?.split("=")[1] ?? 10);

type Status = "OK" | "PROBLEM" | "INFO";
interface Finding {
  check: string;
  status: Status;
  detail: string;
  fix?: string;
}
const findings: Finding[] = [];

function report(check: string, status: Status, detail: string, fix?: string) {
  findings.push({ check, status, detail, fix });
  const tag = status === "OK" ? "  ok  " : status === "PROBLEM" ? "  !!  " : "  --  ";
  console.log(`${tag}${detail}`);
}

const heading = (n: number | null, title: string) => console.log(`\n${n === null ? "" : `${n}. `}${title}`);

async function systemProfiler(type: string): Promise<unknown> {
  try {
    const { stdout } = await run("system_profiler", ["-json", type], { timeout: 20_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// Finds USB devices (any depth) whose vendor ID is ACS.
function findAcsDevices(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => findAcsDevices(n, found));
  else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const isAcs = Object.entries(obj).some(
      ([k, v]) => /vendor.?id/i.test(k) && typeof v === "string" && v.toLowerCase().includes(ACS_VENDOR_ID),
    );
    if (isAcs) found.push(obj);
    Object.values(obj).forEach((v) => findAcsDevices(v, found));
  }
  return found;
}

// Returns the "#01": "..." style entries of a system_profiler SmartCards section.
function smartCardSection(data: unknown, name: string): string[] {
  const sections = (data as { SPSmartCardsDataType?: Record<string, unknown>[] } | null)?.SPSmartCardsDataType ?? [];
  const section = sections.find((s) => s._name === name) ?? {};
  return Object.entries(section)
    .filter(([k]) => k.startsWith("#"))
    .map(([, v]) => String(v));
}

async function main() {
  console.log("Reclaimed hardware diagnose");

  // 0. Never compete with the bridge for the reader.
  const holder = readerHolder();
  if (holder) {
    console.log(`\nThe ${holder.tool} (pid ${holder.pid}, since ${holder.since}) is holding the reader.`);
    console.log("Stop it first (Ctrl+C in its terminal), then run hardware:diagnose again.");
    process.exitCode = 2;
    return;
  }
  const lock = acquireReaderLock("hardware:diagnose");
  if ("heldBy" in lock) {
    console.log(`\nThe reader was just taken by ${lock.heldBy.tool} (pid ${lock.heldBy.pid}). Stop it and retry.`);
    process.exitCode = 2;
    return;
  }

  let stopPcsc: () => Promise<void> = async () => {};
  try {
    // Environment
    heading(0, "Environment");
    const nvmrc = readFileSync(resolve(import.meta.dirname, "../../.nvmrc"), "utf8").trim();
    const major = process.versions.node.split(".")[0];
    if (major === nvmrc) report("node", "OK", `Node ${process.version} (matches .nvmrc ${nvmrc})`);
    else report("node", "PROBLEM", `Node ${process.version}, but .nvmrc says ${nvmrc}`, `Switch to Node ${nvmrc} (nvm use), then: cd reader && npm rebuild`);

    // 1-2. USB and smart card service
    heading(1, "USB");
    const [usbHost, usbLegacy, smartCards] = await Promise.all([
      systemProfiler("SPUSBHostDataType"),
      systemProfiler("SPUSBDataType"),
      systemProfiler("SPSmartCardsDataType"),
    ]);
    const acs = [...findAcsDevices(usbHost), ...findAcsDevices(usbLegacy)];
    const usbSeen = acs.length > 0;
    if (usbSeen) {
      const d = acs[0];
      const product = Object.entries(d).find(([k]) => /product.?id/i.test(k))?.[1] ?? "?";
      const speed = Object.entries(d).find(([k]) => /speed/i.test(k))?.[1] ?? "?";
      report("usb", "OK", `${d._name} (vendor ${ACS_VENDOR_ID}, product ${product}, ${speed})`);
    } else {
      report("usb", "PROBLEM", "No ACS device on USB", "Physical: reseat the cable, try a different USB-C adapter or port, avoid unpowered hubs.");
    }

    heading(2, "Smart card service");
    let ctkd = false;
    try {
      await run("pgrep", ["-x", "ctkd"]);
      ctkd = true;
    } catch {}
    report("ctkd", ctkd ? "OK" : "PROBLEM", `CryptoTokenKit daemon (ctkd) ${ctkd ? "running" : "not running"}`,
      ctkd ? undefined : "Restart the Mac; ctkd provides PC/SC on macOS.");
    const scReaders = smartCardSection(smartCards, "READERS");
    const scDrivers = smartCardSection(smartCards, "READERS_DRIVERS");
    const scSeen = scReaders.some((r) => r.includes("ACR1252"));
    for (const r of scReaders) console.log(`        reader: ${r}`);
    for (const d of scDrivers) console.log(`        driver: ${d}`);

    let ccid: "on" | "off" | "not set" = "not set";
    try {
      const { stdout } = await run("defaults", ["read", CCID_PLIST, "useIFDCCID"]);
      ccid = stdout.trim() === "1" ? "on" : "off";
    } catch {}

    if (scSeen) report("smartcards", "OK", "macOS smart card service lists the ACR1252");
    else if (usbSeen)
      report("smartcards", "PROBLEM", "Reader is on USB but macOS smart card service does not list it (macOS 14+ driver issue)",
        ccid === "on" ? "The older driver is already on. Unplug/replug the reader, then restart the Mac." : `Run: ${CCID_FIX}  then restart the Mac.`);
    else report("smartcards", "PROBLEM", "macOS smart card service does not list the reader", "Fix USB detection first.");

    // 3. Older CCID driver setting
    heading(3, "CCID driver setting");
    report("ccid", "INFO", `useIFDCCID is ${ccid}${ccid === "not set" ? " (macOS default driver)" : ""}`);

    // 4. PC/SC readers, as the bridge sees them
    heading(4, "PC/SC readers");
    let startPcsc: typeof import("./pcsc.ts").startPcsc;
    try {
      ({ startPcsc } = await import("./pcsc.ts"));
    } catch (err) {
      report("native", "PROBLEM", `nfc-pcsc failed to load: ${(err as Error).message}`,
        "cd reader && npm rebuild (needs Xcode command line tools and Python 3)");
      return;
    }

    const errors: string[] = [];
    const log = pino({ level: "warn" }, { write: (line: string) => {
      const l = JSON.parse(line);
      errors.push(`${l.msg}${l.err ? `: ${l.err}` : ""}${l.readerName ? ` (${l.readerName})` : ""}`);
    } });

    const readers: { name: string; used: boolean }[] = [];
    // The first card read is kept even if it arrives before step 5 (e.g. a card already on the reader),
    // and only that card's removal, after it was read, counts.
    type Tap = { uid: string; cardType: CardType; details: CardDetails; at: Date; beforePrompt: boolean };
    let prompted = false;
    let firstTap: Tap | null = null;
    let removedAt: Date | null = null;
    let wake = () => {};
    const until = (done: () => boolean, ms: number) =>
      new Promise<boolean>((resolve) => {
        if (done()) return resolve(true);
        const timer = setTimeout(() => resolve(done()), ms);
        wake = () => {
          if (done()) {
            clearTimeout(timer);
            resolve(true);
          }
        };
      });
    let piccSeen: () => void = () => {};
    const piccPromise = new Promise<void>((r) => (piccSeen = r));

    const pcsc = startPcsc(log, {
      onReaderSeen: (name, used) => {
        readers.push({ name, used });
        if (used) piccSeen();
      },
      onCard: (uid, cardType, _reader, details) => {
        firstTap ??= { uid, cardType, details, at: new Date(), beforePrompt: !prompted };
        wake();
      },
      onRemoved: (uid) => {
        if (firstTap?.uid === uid && !removedAt) removedAt = new Date();
        wake();
      },
      onReaderGone: (name) => errors.push(`reader_disconnected (${name})`),
    });
    stopPcsc = pcsc.stop;

    const timeout = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));
    const gotPicc = await Promise.race([piccPromise.then(() => true), timeout(READER_WAIT_MS, false)]);
    await timeout(300, null); // let the SAM slot announce too
    for (const r of readers) console.log(`        ${r.used ? "PICC ->" : "       "} ${r.name}${r.used ? "  (used)" : "  (ignored)"}`);
    if (gotPicc) report("pcsc", "OK", "PC/SC reports the PICC reader");
    else report("pcsc", "PROBLEM", readers.length ? "PC/SC lists readers, but none is the ACR1252 PICC" : "PC/SC lists no readers",
      "Unplug and replug the reader, then rerun. If the smart card check above failed, fix that first.");

    // 5-6. Tap and removal
    if (gotPicc) {
      heading(5, "Tap");
      prompted = true;
      if (!firstTap) console.log(`        Tap a card on the reader now (waiting ${tapTimeoutMs / 1000} s)...`);
      await until(() => firstTap !== null, tapTimeoutMs);
      const tap = firstTap as Tap | null;
      if (tap) {
        if (tap.beforePrompt) console.log(`        (card was already on the reader)`);
        console.log(`        card present: yes`);
        console.log(`        UID:          ${tap.uid}`);
        console.log(`        card type:    ${tap.cardType}`);
        console.log(`        ATR:          ${tap.details.atr ?? "(none)"}`);
        console.log(`        scan time:    ${tap.at.toISOString()} (UID read in ${tap.details.readMs} ms)`);
        report("tap", "OK", `Read ${tap.uid}`);

        heading(6, "Removal");
        console.log(`        Lift the card (waiting ${REMOVAL_WAIT_MS / 1000} s)...`);
        await until(() => removedAt !== null, REMOVAL_WAIT_MS);
        const removed = removedAt as Date | null;
        if (removed) report("removal", "OK", `Card removed after ${((removed.getTime() - tap.at.getTime()) / 1000).toFixed(1)} s`);
        else report("removal", "PROBLEM", "Card still on the reader", "Lift the card fully away; if it was lifted, unplug/replug the reader.");
      } else {
        const failed = errors.some((e) => e.startsWith("card_read_failed"));
        report("tap", "PROBLEM", failed ? "A card was seen but its UID could not be read" : `No card detected in ${tapTimeoutMs / 1000} s`,
          failed
            ? "Hold the card flat and still on the reader for a full second; try another card."
            : "Place the card flat on the centre of the reader. It must be a 13.56 MHz NFC card (NTAG/MIFARE).");
      }
    }

    // Errors
    heading(null, "Errors");
    if (errors.length) errors.forEach((e) => console.log(`        ${e}`));
    else console.log("        none");
  } finally {
    // Summary and lock first, so a failure while closing the native reader can't hide the result.
    const problems = findings.filter((f) => f.status === "PROBLEM");
    console.log(`\n${problems.length ? "PROBLEM" : "OK"}${problems.length ? ` (${problems.length})` : ": reader working"}`);
    for (const p of problems) console.log(`  - ${p.detail}\n    fix: ${p.fix}`);
    if (process.exitCode === undefined) process.exitCode = problems.length ? 1 : 0;
    lock.release();
    await stopPcsc();
  }
}

await main();
process.exit();
