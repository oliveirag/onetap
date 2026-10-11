import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildContext } from './build-context.js';
import { createApp } from './app.js';
import { RealtimeHub, type RealtimePublisher } from './realtime/hub.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.isDev);

// The hub needs the context (db/auth) and the context needs a publisher; bridge with a forwarder.
let hub: RealtimeHub | null = null;
const forwarder: RealtimePublisher = {
  toUser: (u, e) => hub?.toUser(u, e),
  toTerminal: (t, e) => hub?.toTerminal(t, e),
  hardware: (e) => hub?.hardware(e),
};
const ctx = buildContext(config, logger, { realtime: forwarder });
hub = new RealtimeHub({ db: ctx.db, authVerifier: ctx.authVerifier, terminalSecrets: ctx.terminalSecrets, logger, hardwareToUsers: config.isDev });

const server = createServer(createApp(ctx));
hub.attach(server);
const stopJobs = config.JOBS_ENABLED ? startJobs(ctx) : () => undefined;

server.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      paymentMode: config.PAYMENT_MODE,
      plaid: ctx.services.plaid.configured ? config.PLAID_ENV : 'not configured',
      lithic: ctx.lithic ? 'sandbox' : 'not configured',
      terminals: [...ctx.terminalSecrets.keys()],
    },
    'Reclaimed API listening — SIMULATION ONLY, no live money movement',
  );
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  stopJobs();
  hub?.close();
  server.close(() => void ctx.db.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
