/**
 * Per-account lockout and post-reset session revocation, with the Student model stubbed (no database).
 * The real Argon2id hashing and session tokens are used.
 */
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Student } from '../src/models/Student.js';
import { LOGIN_LOCK_MS, MAX_FAILED_LOGINS, hashPassword, issueSession, loadActiveAccount, loginStudent, setStudentPassword, verifySessionToken } from '../src/services/authService.js';

const id = new Types.ObjectId();

function stubStudent(fields: Record<string, unknown>) {
  const doc = { _id: id, accountStatus: 'ACTIVE', failedLoginAttempts: 0, ...fields };
  vi.spyOn(Student, 'findOne').mockReturnValue({ select: async () => doc } as never);
  return vi.spyOn(Student, 'updateOne').mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
}

afterEach(() => vi.restoreAllMocks());

describe('student login protection', () => {
  it('accepts the correct 4-character password', async () => {
    const update = stubStudent({ passwordHash: await hashPassword('Ab12') });
    await expect(loginStudent('riya@gmail.com', 'Ab12')).resolves.toMatchObject({ _id: id });
    expect(update).not.toHaveBeenCalled();
  });

  it('counts a wrong password against the account with an atomic update that locks at the limit', async () => {
    const update = stubStudent({ passwordHash: await hashPassword('Ab12') });
    await expect(loginStudent('riya@gmail.com', 'Ab13')).rejects.toMatchObject({ status: 401, message: 'Invalid credentials.' });
    expect(update).toHaveBeenCalledTimes(1);
    const [filter, pipeline] = update.mock.calls[0]! as unknown as [unknown, { $set: { loginLockedUntil: { $cond: [unknown, string] } } }[]];
    expect(filter).toEqual({ _id: id });
    const text = JSON.stringify(pipeline);
    expect(text).toContain(`"$gte":["$failedLoginAttempts",${MAX_FAILED_LOGINS}]`);
    expect(text).toContain('loginLockedUntil');
    // The lock lasts LOGIN_LOCK_MS from now.
    const lockedUntil = new Date(pipeline[1]!.$set.loginLockedUntil.$cond[1]);
    expect(Math.abs(lockedUntil.getTime() - (Date.now() + LOGIN_LOCK_MS))).toBeLessThan(5000);
  });

  it('refuses a locked account even with the right password, without checking it', async () => {
    const update = stubStudent({ passwordHash: await hashPassword('Ab12'), loginLockedUntil: new Date(Date.now() + 10 * 60_000) });
    await expect(loginStudent('riya@gmail.com', 'Ab12')).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/Try again in 10 minutes.*reset your password/) });
    expect(update).not.toHaveBeenCalled();
  });

  it('allows sign-in again once the lock has expired and clears the counters', async () => {
    const update = stubStudent({ passwordHash: await hashPassword('Ab12'), failedLoginAttempts: 3, loginLockedUntil: new Date(Date.now() - 1000) });
    await expect(loginStudent('riya@gmail.com', 'Ab12')).resolves.toBeTruthy();
    expect(update).toHaveBeenCalledWith({ _id: id }, { $set: { failedLoginAttempts: 0 }, $unset: { loginLockedUntil: 1 } });
  });

  it('does not reveal whether an unknown account exists', async () => {
    vi.spyOn(Student, 'findOne').mockReturnValue({ select: async () => null } as never);
    const update = vi.spyOn(Student, 'updateOne');
    await expect(loginStudent('ghost@gmail.com', 'Ab12')).rejects.toMatchObject({ status: 401, message: 'Invalid credentials.' });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('password reset', () => {
  it('stores only an Argon2id hash, records the change time and clears any lock', async () => {
    const update = vi.spyOn(Student, 'updateOne').mockResolvedValue({ matchedCount: 1 } as never);
    expect(await setStudentPassword(String(id), 'Zz99')).toBe(true);
    const [, change] = update.mock.calls[0]! as unknown as [unknown, { $set: Record<string, unknown>; $unset: Record<string, unknown> }];
    expect(String(change.$set.passwordHash)).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(change)).not.toContain('Zz99');
    expect(change.$set.passwordChangedAt).toBeInstanceOf(Date);
    expect(change.$set.failedLoginAttempts).toBe(0);
    expect(change.$unset).toEqual({ loginLockedUntil: 1 });
  });

  it('rejects sessions issued before the reset and accepts newer ones', async () => {
    const old = verifySessionToken(issueSession({ id: String(id), role: 'student' }).token);
    expect(old.issuedAt).toBeTypeOf('number');
    const stubAccount = (passwordChangedAt: Date | undefined) =>
      vi.spyOn(Student, 'findById').mockReturnValue({ select: () => ({ lean: async () => ({ _id: id, accountStatus: 'ACTIVE', passwordChangedAt }) }) } as never);

    stubAccount(new Date((old.issuedAt! + 5) * 1000));
    await expect(loadActiveAccount(old)).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/password was changed/) });

    stubAccount(new Date((old.issuedAt! - 5) * 1000));
    await expect(loadActiveAccount(old)).resolves.toBeTruthy();

    stubAccount(undefined);
    await expect(loadActiveAccount(old)).resolves.toBeTruthy();
  });
});
