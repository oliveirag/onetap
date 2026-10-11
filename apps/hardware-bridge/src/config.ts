import { hostname } from 'node:os';

export function bridgeConfig(env = process.env) {
  return {
    apiUrl: env.BRIDGE_API_URL ?? env.APP_BASE_URL ?? 'http://localhost:4000',
    secret: env.HARDWARE_BRIDGE_SECRET ?? '',
    bridgeId: env.HARDWARE_BRIDGE_ID ?? `bridge-${hostname().split('.')[0]}`,
    readerModel: env.NFC_READER_MODEL ?? 'ACS ACR1252U',
    readerFilter: new RegExp(env.NFC_READER_FILTER ?? 'ACR1252.*PICC', 'i'),
  };
}

export const consoleLogger = {
  info: (msg: string, data?: object) => console.log(`[bridge] ${msg}`, data ? JSON.stringify(data) : ''),
  warn: (msg: string, data?: object) => console.warn(`[bridge] WARN ${msg}`, data ? JSON.stringify(data) : ''),
  error: (msg: string, data?: object) => console.error(`[bridge] ERROR ${msg}`, data ? JSON.stringify(data) : ''),
};
