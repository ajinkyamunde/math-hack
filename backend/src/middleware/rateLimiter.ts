import rateLimit, { type Options } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { getEnv } from '../config/environment.js';

function limiter(options: Partial<Options>): RequestHandler {
  if (getEnv().RATE_LIMIT_DISABLED) return (_req, _res, next) => next();
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' } });
    },
    ...options,
  });
}

/** General API ceiling per client IP. Generous because a whole lab may share one NAT address. */
export const apiLimiter = (): RequestHandler => limiter({ windowMs: 60_000, limit: 600 });

/** Brute-force protection for credential endpoints, keyed by IP + identifier. */
export const authLimiter = (): RequestHandler =>
  limiter({
    windowMs: 15 * 60_000,
    limit: 20,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = String(body.identifier ?? body.email ?? body.prn ?? '').toLowerCase().slice(0, 100);
      return `${req.ip}:${id}`;
    },
  });

export const registrationLimiter = (): RequestHandler => limiter({ windowMs: 60 * 60_000, limit: 50 });
/** Host account administration (adding participants, resetting passwords): enough for a busy check-in desk. */
export const participantAdminLimiter = (): RequestHandler => limiter({ windowMs: 60_000, limit: 60 });
export const uploadLimiter = (): RequestHandler => limiter({ windowMs: 60_000, limit: 20 });
