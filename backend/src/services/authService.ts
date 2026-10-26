import { randomBytes, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import type { CookieOptions } from 'express';
import { getEnv, isProduction, emailVerificationAvailable } from '../config/environment.js';
import { Host } from '../models/Host.js';
import { Student } from '../models/Student.js';
import { RosterEntry } from '../models/RosterEntry.js';
import type { AuthUser, Role } from '../types/domain.js';
import { AppError, conflict, isDuplicateKeyError, unauthenticated, forbidden } from '../utils/errors.js';
import { normalizeEmail, normalizePrn } from '../utils/text.js';
import { sendVerificationEmail } from './emailService.js';
import { logger } from '../utils/logger.js';

export const SESSION_COOKIE = 'mh_session';

// OWASP-recommended Argon2id parameters.
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// Used to equalize timing when the account does not exist.
let dummyHash: Promise<string> | undefined;

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, ARGON_OPTIONS);

async function verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  const target = hash ?? (await dummyHash);
  try {
    const ok = await argon2.verify(target, password);
    return Boolean(hash) && ok;
  } catch {
    return false;
  }
}

interface SessionClaims {
  sub: string;
  role: Role;
  sid: string;
}

export function issueSession(user: AuthUser): { token: string; sessionId: string; csrfToken: string } {
  const sessionId = randomBytes(18).toString('base64url');
  const env = getEnv();
  const token = jwt.sign({ role: user.role, sid: sessionId } satisfies Omit<SessionClaims, 'sub'>, env.SESSION_SECRET, {
    subject: user.id,
    expiresIn: `${env.SESSION_TTL_HOURS}h`,
    algorithm: 'HS256',
    issuer: 'mathhack',
  });
  return { token, sessionId, csrfToken: csrfTokenFor(sessionId) };
}

export function verifySessionToken(token: string): AuthUser & { sessionId: string } {
  try {
    const claims = jwt.verify(token, getEnv().SESSION_SECRET, { algorithms: ['HS256'], issuer: 'mathhack' }) as jwt.JwtPayload &
      SessionClaims;
    if (!claims.sub || (claims.role !== 'student' && claims.role !== 'host') || !claims.sid) throw new Error('bad claims');
    return { id: claims.sub, role: claims.role, sessionId: claims.sid };
  } catch {
    throw unauthenticated('Your session has expired. Please sign in again.');
  }
}

/** CSRF token bound to the session: HMAC(secret, sessionId). Stateless and unforgeable without the secret. */
export function csrfTokenFor(sessionId: string): string {
  return createHmac('sha256', getEnv().SESSION_SECRET).update(`csrf:${sessionId}`).digest('base64url');
}

export function isValidCsrfToken(sessionId: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const expected = Buffer.from(csrfTokenFor(sessionId));
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sessionCookieOptions(): CookieOptions {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: isProduction() || env.COOKIE_SAME_SITE === 'none',
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN,
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  };
}

/** Confirms the account behind a session still exists and is active. */
export async function loadActiveAccount(user: AuthUser) {
  const account = user.role === 'host' ? await Host.findById(user.id).lean() : await Student.findById(user.id).lean();
  if (!account) throw unauthenticated('Your account no longer exists.');
  if (account.accountStatus !== 'ACTIVE') throw forbidden('Your account is suspended.');
  return account;
}

export interface RegisterStudentInput {
  name: string;
  prn: string;
  email: string;
  department: string;
  academicYear: string;
  password: string;
}

export async function registerStudent(input: RegisterStudentInput) {
  const env = getEnv();
  const prn = normalizePrn(input.prn);
  const email = normalizeEmail(input.email);

  let rosterVerified = false;
  if (env.ROSTER_ENFORCED) {
    const entry = await RosterEntry.findOne({ prn }).lean();
    if (!entry || entry.email !== email) {
      throw new AppError(403, 'FORBIDDEN', 'This PRN and email pair is not on the official roster. Contact the organizers.');
    }
    rosterVerified = true;
  }

  const [prnTaken, emailTaken] = await Promise.all([Student.exists({ prn }), Student.exists({ email })]);
  if (prnTaken) throw conflict('An account with this PRN already exists.', { field: 'prn' });
  if (emailTaken) throw conflict('An account with this email already exists.', { field: 'email' });

  const passwordHash = await hashPassword(input.password);
  let verificationToken: string | undefined;
  const verification: Record<string, unknown> = {};
  if (emailVerificationAvailable()) {
    verificationToken = randomBytes(32).toString('base64url');
    verification.emailVerificationTokenHash = createHash('sha256').update(verificationToken).digest('hex');
    verification.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  try {
    const student = await Student.create({
      name: input.name,
      prn,
      email,
      department: input.department,
      academicYear: input.academicYear,
      passwordHash,
      rosterVerified,
      ...verification,
    });
    if (verificationToken) {
      await sendVerificationEmail(email, input.name, verificationToken).catch((error: unknown) => {
        // Registration still succeeds; the student stays unverified and can request a new link.
        logger.error('Failed to send verification email', { error });
      });
    }
    return student;
  } catch (error) {
    // Unique indexes catch the race where two registrations pass the existence check together.
    if (isDuplicateKeyError(error)) {
      const field = Object.keys(error.keyPattern ?? {})[0] ?? 'prn';
      throw conflict(`An account with this ${field === 'email' ? 'email' : 'PRN'} already exists.`, { field });
    }
    throw error;
  }
}

export async function verifyEmailToken(token: string): Promise<void> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const result = await Student.updateOne(
    { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: { $gt: new Date() } },
    { $set: { emailVerified: true }, $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 } },
  );
  if (result.modifiedCount === 0) throw new AppError(400, 'VALIDATION_ERROR', 'This verification link is invalid or has expired.');
}

export async function resendVerification(studentId: string): Promise<void> {
  if (!emailVerificationAvailable()) {
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Email verification is not configured on this server.');
  }
  const student = await Student.findById(studentId);
  if (!student) throw unauthenticated();
  if (student.emailVerified) return;
  const token = randomBytes(32).toString('base64url');
  student.set({
    emailVerificationTokenHash: createHash('sha256').update(token).digest('hex'),
    emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await student.save();
  await sendVerificationEmail(student.email, student.name, token);
}

const INVALID_LOGIN = 'Invalid credentials.';

export async function loginStudent(identifier: string, password: string) {
  const trimmed = identifier.trim();
  const query = trimmed.includes('@') ? { email: normalizeEmail(trimmed) } : { prn: normalizePrn(trimmed) };
  const student = await Student.findOne(query).select('+passwordHash');
  const ok = await verifyPassword(student?.passwordHash, password);
  if (!student || !ok) throw new AppError(401, 'UNAUTHENTICATED', INVALID_LOGIN);
  if (student.accountStatus !== 'ACTIVE') throw forbidden('Your account is suspended.');
  return student;
}

export async function loginHost(email: string, password: string) {
  const host = await Host.findOne({ email: normalizeEmail(email) }).select('+passwordHash');
  const ok = await verifyPassword(host?.passwordHash, password);
  if (!host || !ok) throw new AppError(401, 'UNAUTHENTICATED', INVALID_LOGIN);
  if (host.accountStatus !== 'ACTIVE') throw forbidden('This host account is suspended.');
  return host;
}

export interface CreateHostResult {
  created: boolean;
  email: string;
}

/** Used only by the administrative createHost script; there is no HTTP route for host creation. */
export async function createHostAccount(input: { name: string; email: string; password: string }): Promise<CreateHostResult> {
  const email = normalizeEmail(input.email);
  if (await Host.exists({ email })) return { created: false, email };
  await Host.create({ name: input.name, email, passwordHash: await hashPassword(input.password), role: 'ADMIN' });
  return { created: true, email };
}
