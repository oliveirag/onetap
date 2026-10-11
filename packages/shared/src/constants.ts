export const API_PREFIX = '/api/v1';
export const HARDWARE_SIGNATURE_HEADER = 'x-reclaimed-signature';
export const HARDWARE_TIMESTAMP_HEADER = 'x-reclaimed-timestamp';
export const HARDWARE_BRIDGE_ID_HEADER = 'x-reclaimed-bridge-id';
export const TERMINAL_ID_HEADER = 'x-reclaimed-terminal-id';
export const IDEMPOTENCY_HEADER = 'idempotency-key';
/** Signed hardware/terminal requests older than this are rejected (replay protection). */
export const SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;
export const TEST_MODE_BANNER = 'TEST MODE — NO REAL MONEY MOVED';
