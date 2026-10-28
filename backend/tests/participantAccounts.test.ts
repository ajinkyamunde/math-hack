import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Participant } from '../src/models/Participant.js';
import { Student } from '../src/models/Student.js';
import { createHostAccount, MAX_FAILED_LOGINS } from '../src/services/authService.js';
import { ORIGIN, createOpenCompetition, createQuestions, loginHost, registerStudent, useTestDatabase, type Client } from './helpers.js';

const getApp = useTestDatabase();

const newParticipant = (overrides: Record<string, unknown> = {}) => ({
  name: 'Riya Mehta',
  email: 'riya.mehta03@gmail.com',
  department: 'Computer Engineering',
  academicYear: 'FE',
  password: 'Ab12',
  ...overrides,
});

async function login(identifier: string, password: string) {
  const agent = request.agent(getApp());
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ role: 'student', identifier, password });
  return { res, agent };
}

async function loginOtherHost(): Promise<Client> {
  const other = { name: 'Other Host', email: 'other-host@mathhack.test', password: 'OtherPassw0rd!' };
  await createHostAccount(other);
  const agent = request.agent(getApp());
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ role: 'host', ...other });
  const csrf = res.body.csrfToken as string;
  return {
    agent,
    csrf,
    user: res.body.user,
    get: (url) => agent.get(url).set('Origin', ORIGIN),
    post: (url, body) => agent.post(url).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body ?? {}),
    put: (url, body) => agent.put(url).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body ?? {}),
    patch: (url, body) => agent.patch(url).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body ?? {}),
    del: (url) => agent.delete(url).set('Origin', ORIGIN).set('X-CSRF-Token', csrf),
  };
}

async function setup() {
  const host = await loginHost(getApp());
  const [q] = await createQuestions(host, [{}]);
  const id = await createOpenCompetition(host, [q!], { name: 'Account Cup' });
  return { host, id };
}

describe('host-created participants', () => {
  it('creates an account that can log in at once with its 4-character password and is assigned to the competition', async () => {
    const { host, id } = await setup();
    const res = await host.post('/api/host/participants', newParticipant({ competitionId: id }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ generatedPrn: true, competition: { id, name: 'Account Cup' }, participant: { email: 'riya.mehta03@gmail.com' } });
    expect(JSON.stringify(res.body)).not.toMatch(/Ab12|passwordHash|argon2/);

    const stored = await Student.findOne({ email: 'riya.mehta03@gmail.com' }).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.prn).toMatch(/^MH[A-Z0-9]{8}$/);
    expect(await Participant.exists({ competitionId: id, studentId: stored!._id })).toBeTruthy();

    const byEmail = await login('riya.mehta03@gmail.com', 'Ab12');
    expect(byEmail.res.status).toBe(200);
    expect((await login(stored!.prn, 'Ab12')).res.status).toBe(200);
    expect((await login('riya.mehta03@gmail.com', 'ab12')).res.status).toBe(401);

    const list = await host.get(`/api/competitions/${id}/participants`);
    expect(list.body.rows).toEqual([expect.objectContaining({ email: 'riya.mehta03@gmail.com', status: 'JOINED' })]);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|argon2/);

    // The participant can play straight away: no verification, already joined.
    const state = await byEmail.agent.get(`/api/competitions/${id}/state`).set('Origin', ORIGIN);
    expect(state.body.competition.joined).toBe(true);
  });

  it('accepts a PRN and an unassigned participant', async () => {
    const { host } = await setup();
    const res = await host.post('/api/host/participants', newParticipant({ prn: 'vit 2026 01' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ generatedPrn: false, competition: null, participant: { prn: 'VIT202601' } });
    expect(await Participant.countDocuments()).toBe(0);
  });

  it('prevents duplicate accounts using the existing email and PRN rules', async () => {
    const { host } = await setup();
    await registerStudent(getApp(), { email: 'taken@gmail.com', prn: 'TAKEN00001' });
    const email = await host.post('/api/host/participants', newParticipant({ email: 'TAKEN@gmail.com' }));
    expect(email.status).toBe(409);
    expect(email.body.error.details.field).toBe('email');
    const prn = await host.post('/api/host/participants', newParticipant({ prn: 'taken00001' }));
    expect(prn.status).toBe(409);
    expect(prn.body.error.details.field).toBe('prn');
    expect(await Student.countDocuments()).toBe(1);
  });

  it('rejects passwords that are not exactly 4 letters or digits', async () => {
    const { host } = await setup();
    for (const password of ['abc', 'abcde', 'ab c', 'ab!c', '']) {
      const res = await host.post('/api/host/participants', newParticipant({ password }));
      expect(res.status, password).toBe(400);
    }
    expect(await Student.countDocuments()).toBe(0);
  });

  it('only lets hosts create participants, and only in their own open competitions', async () => {
    const { host, id } = await setup();
    const student = await registerStudent(getApp());
    expect((await student.post('/api/host/participants', newParticipant())).status).toBe(403);
    expect((await request(getApp()).post('/api/host/participants').set('Origin', ORIGIN).send(newParticipant())).status).toBe(401);

    const other = await loginOtherHost();
    expect((await other.post('/api/host/participants', newParticipant({ competitionId: id }))).status).toBe(403);
    expect(await Student.exists({ email: 'riya.mehta03@gmail.com' })).toBeNull();

    await host.post(`/api/competitions/${id}/start`);
    await host.post(`/api/competitions/${id}/end`);
    expect((await host.post('/api/host/participants', newParticipant({ competitionId: id }))).status).toBe(409);
    expect((await host.get('/api/host/assignable-competitions')).body.items).toEqual([]);
  });
});

describe('host password resets', () => {
  async function withParticipant() {
    const { host, id } = await setup();
    await host.post('/api/host/participants', newParticipant({ competitionId: id }));
    const student = await Student.findOne({ email: 'riya.mehta03@gmail.com' }).lean();
    return { host, id, studentId: String(student!._id) };
  }

  it('makes the new password work immediately, the old one fail, and signs out old sessions', async () => {
    const { host, id, studentId } = await withParticipant();
    const before = await login('riya.mehta03@gmail.com', 'Ab12');
    expect((await before.agent.get('/api/auth/me').set('Origin', ORIGIN)).status).toBe(200);

    // JWT issue times have one-second resolution; make sure the reset is strictly later than the old session.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const res = await host.post(`/api/competitions/${id}/participants/${studentId}/password`, { password: 'Zz99' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: true });

    expect((await login('riya.mehta03@gmail.com', 'Ab12')).res.status).toBe(401);
    expect((await login('riya.mehta03@gmail.com', 'Zz99')).res.status).toBe(200);
    const old = await before.agent.get('/api/auth/me').set('Origin', ORIGIN);
    expect(old.status).toBe(401);
    expect(old.body.error.message).toMatch(/password was changed/);
  });

  it('only lets the owning host reset, and only for participants of that competition', async () => {
    const { host, id, studentId } = await withParticipant();
    const url = `/api/competitions/${id}/participants/${studentId}/password`;
    const student = await registerStudent(getApp());
    expect((await student.post(url, { password: 'Zz99' })).status).toBe(403);
    expect((await (await loginOtherHost()).post(url, { password: 'Zz99' })).status).toBe(403);
    expect((await host.post(`/api/competitions/${id}/participants/${student.user._id}/password`, { password: 'Zz99' })).status).toBe(404);
    expect((await host.post(url, { password: 'Zz9!' })).status).toBe(400);
    expect((await login('riya.mehta03@gmail.com', 'Ab12')).res.status).toBe(200);
  });

  it('locks an account after repeated wrong passwords, and a host reset unlocks it', async () => {
    const { host, id, studentId } = await withParticipant();
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) expect((await login('riya.mehta03@gmail.com', 'XXXX')).res.status).toBe(401);
    const locked = await login('riya.mehta03@gmail.com', 'Ab12');
    expect(locked.res.status).toBe(429);
    expect(locked.res.body.error.message).toMatch(/ask the host to reset your password/);

    await host.post(`/api/competitions/${id}/participants/${studentId}/password`, { password: 'Qq77' });
    expect((await login('riya.mehta03@gmail.com', 'Qq77')).res.status).toBe(200);
  });

  it('resets the failure count after a successful sign-in', async () => {
    await withParticipant();
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i += 1) await login('riya.mehta03@gmail.com', 'XXXX');
    expect((await login('riya.mehta03@gmail.com', 'Ab12')).res.status).toBe(200);
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i += 1) await login('riya.mehta03@gmail.com', 'XXXX');
    expect((await login('riya.mehta03@gmail.com', 'Ab12')).res.status).toBe(200);
  });
});
