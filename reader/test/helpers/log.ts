import pino from "pino";

// A real pino logger that records each JSON line, so tests can assert on log events.
export function captureLog() {
  const lines: Record<string, unknown>[] = [];
  const log = pino({ level: "debug" }, { write: (s: string) => void lines.push(JSON.parse(s)) });
  const events = () => lines.map((l) => l.msg as string);
  return { log, lines, events };
}
