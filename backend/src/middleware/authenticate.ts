import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, loadActiveAccount, verifySessionToken } from '../services/authService.js';
import { forbidden, unauthenticated } from '../utils/errors.js';

/** Verifies the HTTP-only session cookie and confirms the account is still active. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || !token) throw unauthenticated();
  const session = verifySessionToken(token);
  await loadActiveAccount(session);
  req.auth = session;
  next();
}

export function requireStudent(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) throw unauthenticated();
  if (req.auth.role !== 'student') throw forbidden('This action is only available to students.');
  next();
}
