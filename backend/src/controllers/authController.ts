import type { Request, Response } from 'express';
import { emailVerificationAvailable, getEnv } from '../config/environment.js';
import { Host } from '../models/Host.js';
import { Student } from '../models/Student.js';
import * as authService from '../services/authService.js';
import type { AuthUser } from '../types/domain.js';
import { unauthenticated } from '../utils/errors.js';
import type { z } from 'zod';
import type { loginSchema, registerSchema } from '../validation/authSchemas.js';
import { recordAudit } from '../services/auditService.js';

function startSession(res: Response, user: AuthUser): string {
  const { token, csrfToken } = authService.issueSession(user);
  res.cookie(authService.SESSION_COOKIE, token, authService.sessionCookieOptions());
  return csrfToken;
}

function verificationInfo() {
  const env = getEnv();
  return { emailVerificationAvailable: emailVerificationAvailable(), emailVerificationRequired: env.REQUIRE_EMAIL_VERIFICATION };
}

export async function register(req: Request, res: Response): Promise<void> {
  const input = req.body as z.output<typeof registerSchema>;
  const student = await authService.registerStudent(input);
  const csrfToken = startSession(res, { id: student.id, role: 'student' });
  res.status(201).json({ user: { ...student.toJSON(), role: 'student' }, csrfToken, ...verificationInfo() });
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = req.body as z.output<typeof loginSchema>;
  if (input.role === 'host') {
    const host = await authService.loginHost(input.email, input.password);
    const csrfToken = startSession(res, { id: host.id, role: 'host' });
    await recordAudit({ actorId: host.id, actorRole: 'host', action: 'host.login' });
    res.json({ user: { ...host.toJSON(), role: 'host' }, csrfToken });
    return;
  }
  const student = await authService.loginStudent(input.identifier, input.password);
  const csrfToken = startSession(res, { id: student.id, role: 'student' });
  res.json({ user: { ...student.toJSON(), role: 'student' }, csrfToken, ...verificationInfo() });
}

export function logout(_req: Request, res: Response): void {
  const options = { ...authService.sessionCookieOptions() };
  delete options.maxAge;
  res.clearCookie(authService.SESSION_COOKIE, options);
  res.status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  const auth = req.auth;
  if (!auth) throw unauthenticated();
  const account = auth.role === 'host' ? await Host.findById(auth.id) : await Student.findById(auth.id);
  if (!account) throw unauthenticated();
  res.json({
    user: { ...account.toJSON(), role: auth.role },
    csrfToken: authService.csrfTokenFor(auth.sessionId),
    ...(auth.role === 'student' ? verificationInfo() : {}),
  });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  await authService.verifyEmailToken((req.body as { token: string }).token);
  res.json({ verified: true });
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw unauthenticated();
  await authService.resendVerification(req.auth.id);
  res.status(202).json({ sent: true });
}
