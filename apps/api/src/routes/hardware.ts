import { Router } from 'express';
import { z } from 'zod';
import { hardwareReaderEventSchema, tapEventSchema } from '@reclaimed/shared';
import type { AppContext } from '../context.js';
import { ok, parse } from '../lib/http.js';
import { requireBridge, requireBridgeOrDevUser } from '../middleware/auth.js';

/** Hardware bridge endpoints. Writes require the HMAC-signed bridge credential. */
export function hardwareRoutes(ctx: AppContext): Router {
  const r = Router();
  const hw = ctx.services.hardware;

  r.get('/hardware/readers', requireBridgeOrDevUser(ctx), async (_req, res) => ok(res, await hw.listReaders()));
  r.get('/hardware/status', requireBridgeOrDevUser(ctx), async (req, res) => ok(res, await hw.status({ userId: req.user?.userId })));

  r.post('/hardware/heartbeat', requireBridge(ctx), async (req, res) => {
    const body = parse(z.object({ bridgeId: z.string().min(1).max(100), readers: z.array(z.string().max(200)).max(10) }), req.body);
    hw.heartbeat(body.bridgeId);
    ok(res, { ok: true, serverTime: new Date().toISOString() });
  });
  r.post('/hardware/reader-events', requireBridge(ctx), async (req, res) => {
    const e = parse(hardwareReaderEventSchema, req.body);
    ok(res, await hw.recordReaderEvent(e));
  });
  r.post('/hardware/tap-events', requireBridge(ctx), async (req, res) => {
    const tap = parse(tapEventSchema, req.body);
    ok(res, await hw.processTap(tap, res.locals.requestId));
  });
  return r;
}
