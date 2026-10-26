import type { NextFunction, Request, Response } from 'express';
import { isAllowedOrigin } from '../config/cors.js';
import { SESSION_COOKIE, isValidCsrfToken, verifySessionToken } from '../services/authService.js';
import { AppError } from '../utils/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestOrigin(req: Request): string | undefined {
  const origin = req.get('origin');
  if (origin) return origin;
  const referer = req.get('referer');
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return 'invalid';
  }
}

/**
 * Defense in depth against CSRF:
 *  1. State-changing requests from browsers must come from the configured frontend origin.
 *  2. Requests carrying a session cookie must also echo the session-bound CSRF token in X-CSRF-Token.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!isAllowedOrigin(requestOrigin(req))) throw new AppError(403, 'CSRF_FAILED', 'Request origin is not allowed.');

  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token) {
    let sessionId: string;
    try {
      sessionId = verifySessionToken(token).sessionId;
    } catch {
      // An expired cookie is harmless here; authentication rejects it if the route needs a session.
      return next();
    }
    if (!isValidCsrfToken(sessionId, req.get('x-csrf-token'))) {
      throw new AppError(403, 'CSRF_FAILED', 'Security token missing or invalid. Refresh the page and try again.');
    }
  }
  next();
}
