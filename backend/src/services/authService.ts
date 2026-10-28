import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import type { CookieOptions } from 'express';
import { getEnv, isProduction } from '../config/environment.js';
import { Host } from '../models/Host.js';
import { Student } from '../models/Student.js';
import { RosterEntry } from '../models/RosterEntry.js';
import type { AuthUser, Role } from '../types/domain.js';
import { AppError, conflict, isDuplicateKeyError, unauthenticated, forbidden } from '../utils/errors.js';
import { normalizeEmail, normalizePrn } from '../utils/text.js';

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
    return { id: claims.sub, role: claims.role, sessionId: claims.sid, issuedAt: claims.iat };
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

/** Confirms the account behind a session still exists, is active, and has not had its password reset since. */
export async function loadActiveAccount(user: AuthUser) {
  const account =
    user.role === 'host' ? await Host.findById(user.id).lean() : await Student.findById(user.id).select('+passwordChangedAt').lean();
  if (!account) throw unauthenticated('Your account no longer exists.');
  if (account.accountStatus !== 'ACTIVE') throw forbidden('Your account is suspended.');
  const changedAt = (account as { passwordChangedAt?: Date | null }).passwordChangedAt;
  if (changedAt && user.issuedAt !== undefined && user.issuedAt < Math.floor(changedAt.getTime() / 1000)) {
    throw unauthenticated('Your password was changed. Please sign in again.');
  }
  return account;
}

export interface StudentAccountFields {
  name: string;
  prn: string;
  email: string;
  department: string;
  academicYear: string;
  rosterVerified?: boolean;
}

/**
 * The one place student accounts are inserted, for self-registration and host-created participants alike:
 * same normalization, duplicate rules, unique indexes and Argon2id hashing.
 */
export async function createStudentAccount(fields: StudentAccountFields, password: string) {
  const prn = normalizePrn(fields.prn);
  const email = normalizeEmail(fields.email);
  const [prnTaken, emailTaken] = await Promise.all([Student.exists({ prn }), Student.exists({ email })]);
  if (prnTaken) throw conflict('An account with this PRN already exists.', { field: 'prn' });
  if (emailTaken) throw conflict('An account with this email already exists.', { field: 'email' });

  const passwordHash = await hashPassword(password);

  // No verification email or OTP: the account is usable as soon as it is created.
  try {
    return await Student.create({
      name: fields.name,
      prn,
      email,
      department: fields.department,
      academicYear: fields.academicYear,
      passwordHash,
      rosterVerified: fields.rosterVerified ?? false,
    });
  } catch (error) {
    // Unique indexes catch the race where two creations pass the existence check together.
    if (isDuplicateKeyError(error)) {
      const field = Object.keys(error.keyPattern ?? {})[0] ?? 'prn';
      throw conflict(`An account with this ${field === 'email' ? 'email' : 'PRN'} already exists.`, { field });
    }
    throw error;
  }
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

  const { password, ...fields } = input;
  return createStudentAccount({ ...fields, prn, email, rosterVerified }, password);
}

const INVALID_LOGIN = 'Invalid credentials.';

/** Consecutive failed sign-ins that lock a student account, and for how long. */
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_LOCK_MS = 15 * 60_000;

/**
 * Counts a failed sign-in atomically; the attempt that reaches the limit locks the account and restarts the count.
 * Per-account (not per-IP) on purpose: participant passwords are only 4 characters, so guesses spread over many
 * IP addresses must still be capped.
 */
async function recordFailedLogin(studentId: unknown): Promise<void> {
  const reached = { $gte: ['$failedLoginAttempts', MAX_FAILED_LOGINS] };
  await Student.updateOne({ _id: studentId }, [
    { $set: { failedLoginAttempts: { $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1] } } },
    {
      $set: {
        loginLockedUntil: { $cond: [reached, new Date(Date.now() + LOGIN_LOCK_MS), '$loginLockedUntil'] },
        failedLoginAttempts: { $cond: [reached, 0, '$failedLoginAttempts'] },
      },
    },
  ]);
}

function lockedError(until: Date): AppError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return new AppError(
    429,
    'RATE_LIMITED',
    `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask the host to reset your password.`,
  );
}

export async function loginStudent(identifier: string, password: string) {
  const trimmed = identifier.trim();
  const query = trimmed.includes('@') ? { email: normalizeEmail(trimmed) } : { prn: normalizePrn(trimmed) };
  const student = await Student.findOne(query).select('+passwordHash +failedLoginAttempts +loginLockedUntil');
  // A locked account is not checked at all, so guesses made during the lock teach an attacker nothing.
  if (student?.loginLockedUntil && student.loginLockedUntil.getTime() > Date.now()) throw lockedError(student.loginLockedUntil);
  const ok = await verifyPassword(student?.passwordHash, password);
  if (!student || !ok) {
    if (student) await recordFailedLogin(student._id);
    throw new AppError(401, 'UNAUTHENTICATED', INVALID_LOGIN);
  }
  if (student.accountStatus !== 'ACTIVE') throw forbidden('Your account is suspended.');
  if (student.failedLoginAttempts || student.loginLockedUntil) {
    await Student.updateOne({ _id: student._id }, { $set: { failedLoginAttempts: 0 }, $unset: { loginLockedUntil: 1 } });
  }
  return student;
}

/**
 * Replaces a student's password using the same Argon2id hashing. The old password stops working at once, any lock
 * is cleared, and sessions issued before the change are rejected by loadActiveAccount.
 */
export async function setStudentPassword(studentId: string, password: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  const result = await Student.updateOne(
    { _id: studentId },
    { $set: { passwordHash, passwordChangedAt: new Date(), failedLoginAttempts: 0 }, $unset: { loginLockedUntil: 1 } },
  );
  return result.matchedCount === 1;
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
