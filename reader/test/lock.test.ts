import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireReaderLock, readerHolder } from "../src/lock.ts";

const dir = mkdtempSync(join(tmpdir(), "reader-lock-test-"));
const path = join(dir, "reader.lock");
afterEach(() => rmSync(path, { force: true }));

// A pid that is guaranteed dead: a child that has already exited.
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;
// A pid that is alive and is not us: our parent (the vitest main process or the shell).
const otherLivePid = process.ppid;

describe("reader lock", () => {
  it("is free when no lock file exists, and taking it writes our pid", () => {
    expect(readerHolder(path)).toBeNull();
    const lock = acquireReaderLock("bridge", path);
    expect("release" in lock).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: process.pid, tool: "bridge" });
  });

  it("refuses when another live process holds it, and names the holder", () => {
    writeFileSync(path, JSON.stringify({ pid: otherLivePid, tool: "bridge", since: "x" }));
    expect(readerHolder(path)).toMatchObject({ pid: otherLivePid, tool: "bridge" });
    expect(acquireReaderLock("hardware:diagnose", path)).toEqual({ heldBy: expect.objectContaining({ tool: "bridge" }) });
  });

  it("takes over a stale lock left by a dead process", () => {
    writeFileSync(path, JSON.stringify({ pid: deadPid(), tool: "bridge", since: "x" }));
    expect(readerHolder(path)).toBeNull();
    expect("release" in acquireReaderLock("hardware:diagnose", path)).toBe(true);
  });

  it("treats a corrupt lock file as free", () => {
    writeFileSync(path, "not json");
    expect(readerHolder(path)).toBeNull();
  });

  it("release removes only our own lock", () => {
    const lock = acquireReaderLock("bridge", path);
    if (!("release" in lock)) throw new Error("expected lock");
    writeFileSync(path, JSON.stringify({ pid: otherLivePid, tool: "other", since: "x" })); // someone else took over
    lock.release();
    expect(existsSync(path)).toBe(true);

    const mine = acquireReaderLock("bridge", join(dir, "second.lock"));
    if (!("release" in mine)) throw new Error("expected lock");
    mine.release();
    expect(existsSync(join(dir, "second.lock"))).toBe(false);
  });
});
