import pino from 'pino';

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    base: { service: 'reclaimed-api' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-reclaimed-signature"]',
        'req.headers["plaid-verification"]',
        'req.headers["webhook-signature"]',
        '*.access_token',
        '*.accessToken',
        '*.public_token',
        '*.publicToken',
        '*.secret',
        '*.pan',
        '*.uid',
      ],
      censor: '[redacted]',
    },
    transport: pretty ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } } : undefined,
  });
}
export type Logger = ReturnType<typeof createLogger>;
