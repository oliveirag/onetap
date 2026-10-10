import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// One process at a time may use the reader: the bridge or hardware:diagnose.
// The lock file holds the owner's pid and name; a lock whose pid is dead is stale and is taken over.
export const LOCK_PATH = join(tmpdir(), "reclaimed-reader.lock");

export interface LockOwner {
  pid: number;
  tool: string;
  since: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Returns the live process holding the reader, or null.
export function readerHolder(path = LOCK_PATH): LockOwner | null {
  try {
    const owner = JSON.parse(readFileSync(path, "utf8")) as LockOwner;
    return owner.pid !== process.pid && alive(owner.pid) ? owner : null;
  } catch {
    return null;
  }
}

// Takes the lock, or returns the current holder if another live process has it.
export function acquireReaderLock(tool: string, path = LOCK_PATH): { release: () => void } | { heldBy: LockOwner } {
  const holder = readerHolder(path);
  if (holder) return { heldBy: holder };
  const owner: LockOwner = { pid: process.pid, tool, since: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(owner));
  return {
    release() {
      try {
        if ((JSON.parse(readFileSync(path, "utf8")) as LockOwner).pid === process.pid) unlinkSync(path);
      } catch {}
    },
  };
}
