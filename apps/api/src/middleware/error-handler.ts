import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES, isReclaimedError, ReclaimedError, type ApiErrorBody, type ErrorCode } from '@reclaimed/shared';
import type { Logger } from '../logger.js';

function toReclaimed(err: unknown): ReclaimedError {
  if (isReclaimedError(err)) return err;
  const e = err as { type?: string; status?: number; code?: string; name?: string };
  if (e?.type === 'entity.parse.failed') return new ReclaimedError('VALIDATION_FAILED', 'Malformed JSON body.');
  if (e?.type === 'entity.too.large') return new ReclaimedError('VALIDATION_FAILED', 'Request body too large.');
  if (typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
    if (e.code === '23505') return new ReclaimedError('CONFLICT', 'A conflicting record already exists.', { cause: err });
    if (e.code === 'P0001' && String((err as Error).message).includes('Invalid payment state transition')) {
      return new ReclaimedError('INVALID_PAYMENT_STATE', (err as Error).message, { cause: err });
    }
    return new ReclaimedError('DATABASE_ERROR', undefined, { cause: err });
  }
  return new ReclaimedError('INTERNAL_ERROR', undefined, { cause: err });
}

export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const e = toReclaimed(err);
    const requestId = (res.locals.requestId as string) ?? 'unknown';
    const log = { requestId, code: e.code, method: req.method, path: req.path, err: e.cause ?? err };
    if (e.status >= 500) logger.error(log, e.message);
    else logger.warn({ requestId, code: e.code, method: req.method, path: req.path }, e.message);
    const code: ErrorCode = e.code in ERROR_CODES ? e.code : 'INTERNAL_ERROR';
    const body: ApiErrorBody = {
      success: false,
      error: {
        code,
        // Never leak internal error text for 5xx responses.
        message: e.status >= 500 && e.code === 'INTERNAL_ERROR' ? ERROR_CODES.INTERNAL_ERROR.message : e.message,
        retryable: e.retryable,
        ...(e.details !== undefined && e.status < 500 ? { details: e.details } : {}),
      },
      requestId,
    };
    if (!res.headersSent) res.status(e.status).json(body);
  };
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new ReclaimedError('NOT_FOUND', 'Route not found.'));
}
