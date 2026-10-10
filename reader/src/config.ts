import { normalizeUid } from "@shared/nfc.ts";

export type TapOutput = "websocket" | "http" | "both";

export interface Config {
  terminalId: string;
  tapOutput: TapOutput;
  wsPort: number;
  tapUrl: string | null;      // BACKEND_URL + TAP_PATH; null unless output includes http
  secret: string | null;      // never log this
  demoCardUid: string | null;
  debounceMs: number;
  logLevel: string;
}

const OUTPUTS: TapOutput[] = ["websocket", "http", "both"];
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];

function int(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}

// Reads and validates config. Throws with a readable message on bad values.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tapOutput = (env.TAP_OUTPUT?.trim() || "websocket") as TapOutput;
  if (!OUTPUTS.includes(tapOutput)) throw new Error(`TAP_OUTPUT must be one of ${OUTPUTS.join(", ")}, got "${tapOutput}"`);

  const logLevel = env.LOG_LEVEL?.trim() || "info";
  if (!LOG_LEVELS.includes(logLevel)) throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);

  const wsPort = int("WS_PORT", 8787, env);
  if (wsPort < 1 || wsPort > 65535) throw new Error("WS_PORT must be between 1 and 65535");

  let tapUrl: string | null = null;
  let secret: string | null = null;
  if (tapOutput !== "websocket") {
    const base = env.BACKEND_URL?.trim();
    if (!base) throw new Error(`BACKEND_URL is required when TAP_OUTPUT=${tapOutput}`);
    const path = env.TAP_PATH?.trim() || "/hardware/taps";
    tapUrl = new URL(base.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`)).toString();
    secret = env.HARDWARE_BRIDGE_SECRET?.trim() || null;
    if (!secret || secret.length < 32) {
      throw new Error(`HARDWARE_BRIDGE_SECRET must be set (32+ characters) when TAP_OUTPUT=${tapOutput}`);
    }
  }

  const demo = env.DEMO_CARD_UID?.trim();

  return {
    terminalId: env.TERMINAL_ID?.trim() || "store-laptop-1",
    tapOutput,
    wsPort,
    tapUrl,
    secret,
    demoCardUid: demo ? normalizeUid(demo) : null,
    debounceMs: int("DEBOUNCE_MS", 1500, env),
    logLevel,
  };
}

// Config safe to log: the secret is reduced to whether it is set.
export function describeConfig(c: Config) {
  const { secret, ...rest } = c;
  return { ...rest, secret: secret ? "set" : "unset" };
}
