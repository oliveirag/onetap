import express, { type Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { API_PREFIX } from '@reclaimed/shared';
import type { AppContext } from './context.js';
import { requestId } from './middleware/request-context.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { ok } from './lib/http.js';
import { userRoutes } from './routes/user.js';
import { hardwareRoutes } from './routes/hardware.js';
import { terminalRoutes } from './routes/terminal.js';
import { webhookRoutes } from './routes/webhooks.js';

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || ctx.config.corsOrigins.includes(origin)),
      allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id'],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    }),
  );
  if (ctx.config.NODE_ENV !== 'test') {
    app.use(pinoHttp({ logger: ctx.logger, customProps: (_req, res) => ({ requestId: res.locals.requestId }), autoLogging: { ignore: (req) => req.url === '/health' } }));
  }
  // Keep the raw body for HMAC / webhook signature verification.
  app.use(express.json({ limit: '256kb', verify: (req, _res, buf) => void ((req as Request).rawBody = Buffer.from(buf)) }));

  const limiter = (limit: number) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => ctx.config.NODE_ENV === 'test',
      handler: (_req, res) =>
        res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.', retryable: true }, requestId: res.locals.requestId }),
    });

  app.get('/health', (_req, res) => ok(res, { status: 'ok', paymentMode: ctx.config.PAYMENT_MODE, liveMoney: false }));

  const v1 = express.Router();
  v1.use('/plaid', limiter(30));
  v1.use('/webhooks', limiter(600));
  v1.use('/hardware', limiter(1200));
  v1.use('/test-terminal', limiter(600));
  v1.use(limiter(300));
  v1.use(webhookRoutes(ctx));
  v1.use(hardwareRoutes(ctx));
  v1.use(terminalRoutes(ctx));
  v1.use(userRoutes(ctx));
  app.use(API_PREFIX, v1);
  app.use(notFound);
  app.use(errorHandler(ctx.logger));
  return app;
}
