/**
 * Host-created participants and password resets, without a database: the real routes, session, CSRF, role,
 * ownership and validation checks run; account writes are stubbed. DB-backed versions are in participantAccounts.test.ts.
 */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';

vi.mock('../src/services/authService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/authService.js')>();
  return {
    ...actual,
    loadActiveAccount: vi.fn(async () => ({ accountStatus: 'ACTIVE' })),
    createStudentAccount: vi.fn(),
    setStudentPassword: vi.fn(async () => true),
  };
});
vi.mock('../src/services/auditService.js', () => ({ recordAudit: vi.fn(async () => undefined) }));

const { createApp } = await import('../src/app.js');
const auth = await import('../src/services/authService.js');
const { recordAudit } = await import('../src/services/auditService.js');
const { Competition } = await import('../src/models/Competition.js');
const { Participant } = await import('../src/models/Participant.js');
const { Student } = await import('../src/models/Student.js');
const { participantPasswordSchema } = await import('../src/validation/authSchemas.js');
const { createParticipantSchema } = await import('../src/validation/participantSchemas.js');

const ORIGIN = 'http://localhost:5173';
const competitionId = new Types.ObjectId().toHexString();
const ownerId = new Types.ObjectId().toHexString();
const otherHostId = new Types.ObjectId().toHexString();
const studentId = new Types.ObjectId().toHexString();

function sessionFor(id: string, role: 'host' | 'student') {
  const { token, csrfToken } = auth.issueSession({ id, role });
  return { cookie: `${auth.SESSION_COOKIE}=${token}`, csrf: csrfToken };
}

const post = (app: Express, url: string, who: { cookie: string; csrf: string } | null, body: object) => {
  const test = request(app).post(url).set('Origin', ORIGIN);
  if (who) test.set('Cookie', who.cookie).set('X-CSRF-Token', who.csrf);
  return test.send(body);
};

/** Competition.findById(...).select(...).lean() as used by the ownership checks. */
function stubCompetition(doc: { createdBy: string; status?: string; name?: string } | null) {
  vi.spyOn(Competition, 'findById').mockReturnValue({
    select: () => ({
      lean: async () =>
        doc && { _id: new Types.ObjectId(competitionId), createdBy: new Types.ObjectId(doc.createdBy), status: doc.status ?? 'WAITING', name: doc.name ?? 'Cup' },
    }),
  } as never);
}

const validParticipant = {
  name: 'Riya Mehta',
  email: 'riya.mehta03@gmail.com',
  department: 'Computer Engineering',
  academicYear: 'FE',
  password: 'Ab12',
};

describe('participant password rule', () => {
  it('accepts exactly 4 letters or digits', () => {
    for (const ok of ['Ab12', '1234', 'ABCD', 'abcd', 'z9Z0']) expect(participantPasswordSchema.safeParse(ok).success, ok).toBe(true);
  });

  it('rejects other lengths, spaces, symbols and non-ASCII letters', () => {
    for (const bad of ['', 'abc', 'abcde', 'ab c', ' abc', 'abc ', 'ab!c', 'ab-c', 'äbcd', 'ab\tc', '12345678']) {
      expect(participantPasswordSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('treats a blank PRN or competition as not provided', () => {
    const parsed = createParticipantSchema.parse({ ...validParticipant, prn: '  ', competitionId: '' });
    expect(parsed.prn).toBeUndefined();
    expect(parsed.competitionId).toBeUndefined();
    expect(createParticipantSchema.parse({ ...validParticipant, prn: 'abc 123456' }).prn).toBe('ABC123456');
  });
});

describe('participant management routes', () => {
  let app: Express;
  beforeAll(() => {
    app = createApp();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(auth.createStudentAccount).mockReset();
    vi.mocked(auth.setStudentPassword).mockReset().mockResolvedValue(true);
    vi.mocked(recordAudit).mockClear();
  });

  const createUrl = '/api/host/participants';
  const resetUrl = `/api/competitions/${competitionId}/participants/${studentId}/password`;

  it('requires a host session to create participants', async () => {
    expect((await post(app, createUrl, null, validParticipant)).status).toBe(401);
    const student = await post(app, createUrl, sessionFor(studentId, 'student'), validParticipant);
    expect(student.status).toBe(403);
    expect(auth.createStudentAccount).not.toHaveBeenCalled();
  });

  it('rejects a create request without the CSRF token', async () => {
    const host = sessionFor(ownerId, 'host');
    const res = await request(app).post(createUrl).set('Origin', ORIGIN).set('Cookie', host.cookie).send(validParticipant);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('validates every field and reports the 4-character rule on the password field', async () => {
    const host = sessionFor(ownerId, 'host');
    const res = await post(app, createUrl, host, { name: 'R', email: 'nope', department: '', academicYear: 'XX', password: 'abc!' });
    expect(res.status).toBe(400);
    const fields = (res.body.error.details as { field: string; message: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual(['academicYear', 'department', 'email', 'name', 'password']);
    expect(JSON.stringify(res.body)).not.toContain('abc!');
    expect(auth.createStudentAccount).not.toHaveBeenCalled();
  });

  it("refuses to assign a participant to another host's competition, before creating any account", async () => {
    stubCompetition({ createdBy: otherHostId });
    const res = await post(app, createUrl, sessionFor(ownerId, 'host'), { ...validParticipant, competitionId });
    expect(res.status).toBe(403);
    expect(auth.createStudentAccount).not.toHaveBeenCalled();
  });

  it('refuses to assign to a finished competition', async () => {
    stubCompetition({ createdBy: ownerId, status: 'COMPLETED' });
    const res = await post(app, createUrl, sessionFor(ownerId, 'host'), { ...validParticipant, competitionId });
    expect(res.status).toBe(409);
    expect(auth.createStudentAccount).not.toHaveBeenCalled();
  });

  it('creates the account through the shared account code, assigns it, and never returns secrets', async () => {
    stubCompetition({ createdBy: ownerId, name: 'Avengers Maths Sprint' });
    vi.spyOn(Student, 'exists').mockResolvedValue(null);
    const created = new Student({ name: 'Riya Mehta', prn: 'MHABCDEFGH', email: 'riya.mehta03@gmail.com', department: 'Computer Engineering', academicYear: 'FE', passwordHash: '$argon2id$fake' });
    vi.mocked(auth.createStudentAccount).mockResolvedValue(created as never);
    const participantCreate = vi.spyOn(Participant, 'create').mockResolvedValue({} as never);
    vi.spyOn(Participant, 'countDocuments').mockResolvedValue(1 as never);

    const res = await post(app, createUrl, sessionFor(ownerId, 'host'), { ...validParticipant, email: ' Riya.Mehta03@Gmail.com ', competitionId });
    expect(res.status).toBe(201);
    expect(auth.createStudentAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Riya Mehta', email: 'riya.mehta03@gmail.com', prn: expect.stringMatching(/^MH[A-Z0-9]{8}$/) }),
      'Ab12',
    );
    expect(participantCreate).toHaveBeenCalledWith({ competitionId: expect.anything(), studentId: created._id });
    expect(res.body).toMatchObject({ generatedPrn: true, competition: { id: competitionId, name: 'Avengers Maths Sprint' } });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Ab12');
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('argon2');
    expect(JSON.stringify(vi.mocked(recordAudit).mock.calls)).not.toContain('Ab12');
  });

  it('only lets the owning host reset a participant password', async () => {
    stubCompetition({ createdBy: ownerId });
    const body = { password: 'Zz99' };
    expect((await post(app, resetUrl, null, body)).status).toBe(401);
    expect((await post(app, resetUrl, sessionFor(studentId, 'student'), body)).status).toBe(403);
    expect((await post(app, resetUrl, sessionFor(otherHostId, 'host'), body)).status).toBe(403);
    expect(auth.setStudentPassword).not.toHaveBeenCalled();
  });

  it('validates the new password', async () => {
    stubCompetition({ createdBy: ownerId });
    for (const password of ['Zz9', 'Zz999', 'Zz 9', 'Zz9!']) {
      const res = await post(app, resetUrl, sessionFor(ownerId, 'host'), { password });
      expect(res.status, password).toBe(400);
      expect(res.body.error.details[0].field).toBe('password');
    }
    expect(auth.setStudentPassword).not.toHaveBeenCalled();
  });

  it('refuses to reset someone who is not in this competition', async () => {
    stubCompetition({ createdBy: ownerId });
    vi.spyOn(Participant, 'exists').mockResolvedValue(null);
    expect((await post(app, resetUrl, sessionFor(ownerId, 'host'), { password: 'Zz99' })).status).toBe(404);
    expect(auth.setStudentPassword).not.toHaveBeenCalled();
  });

  it('resets the password for the owning host without echoing it', async () => {
    stubCompetition({ createdBy: ownerId });
    vi.spyOn(Participant, 'exists').mockResolvedValue({ _id: new Types.ObjectId() } as never);
    const res = await post(app, resetUrl, sessionFor(ownerId, 'host'), { password: 'Zz99' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: true });
    expect(auth.setStudentPassword).toHaveBeenCalledWith(studentId, 'Zz99');
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'participant.password_reset', details: { studentId } }));
  });

  it('lists only the host\'s own open competitions for assignment', async () => {
    const find = vi.spyOn(Competition, 'find').mockReturnValue({
      select: () => ({ sort: () => ({ lean: async () => [{ _id: new Types.ObjectId(competitionId), name: 'Cup', status: 'WAITING' }] }) }),
    } as never);
    const res = await request(app).get('/api/host/assignable-competitions').set('Origin', ORIGIN).set('Cookie', sessionFor(ownerId, 'host').cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ id: competitionId, name: 'Cup', status: 'WAITING' }]);
    expect(find).toHaveBeenCalledWith({ createdBy: ownerId, status: { $in: ['DRAFT', 'WAITING', 'RUNNING', 'PAUSED'] } });
    const student = await request(app).get('/api/host/assignable-competitions').set('Origin', ORIGIN).set('Cookie', sessionFor(studentId, 'student').cookie);
    expect(student.status).toBe(403);
  });
});
