import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthenticated } from '../utils/errors.js';

/** Host role comes only from the server-signed session; nothing the client sends can grant it. */
export function authorizeHost(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) throw unauthenticated();
  if (req.auth.role !== 'host') throw forbidden('Host access required.');
  next();
}
