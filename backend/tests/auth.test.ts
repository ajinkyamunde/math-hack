import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Student } from '../src/models/Student.js';
import { HOST, ORIGIN, loginHost, registerStudent, studentPayload, useTestDatabase } from './helpers.js';
import { createHostAccount } from '../src/services/authService.js';
import { Host } from '../src/models/Host.js';

const getApp = useTestDatabase();

describe('student registration', () => {
  it('registers a student, hashes the password and never returns the hash', async () => {
    const res = await request(getApp()).post('/api/auth/register').set('Origin', ORIGIN).send(studentPayload({ prn: 'abc 123456', email: 'Mixed@College.Test' }));
    expect(res.status).toBe(201);
    expect(res.body.user.prn).toBe('ABC123456');
    expect(res.body.user.email).toBe('mixed@college.test');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.role).toBe('student');
    expect(res.headers['set-cookie']?.[0]).toMatch(/mh_session=.*HttpOnly/i);
    const stored = await Student.findOne({ prn: 'ABC123456' }).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.emailVerified).toBe(false);
  });

  it('rejects a duplicate PRN', async () => {
    await registerStudent(getApp(), { prn: 'DUP000001', email: 'one@college.test' });
    const res = await request(getApp()).post('/api/auth/register').set('Origin', ORIGIN).send(studentPayload({ prn: 'dup000001', email: 'two@college.test' }));
    expect(res.status).toBe(409);
    expect(res.body.error.details.field).toBe('prn');
  });

  it('rejects a duplicate email', async () => {
    await registerStudent(getApp(), { prn: 'UNIQUE0001', email: 'same@college.test' });
    const res = await request(getApp()).post('/api/auth/register').set('Origin', ORIGIN).send(studentPayload({ prn: 'UNIQUE0002', email: 'SAME@college.test' }));
    expect(res.status).toBe(409);
    expect(res.body.error.details.field).toBe('email');
  });

  it('rejects weak and mismatched passwords', async () => {
    const weak = await request(getApp()).post('/api/auth/register').set('Origin', ORIGIN).send(studentPayload({ password: 'short', confirmPassword: 'short' }));
    expect(weak.status).toBe(400);
    expect(weak.body.error.details.some((d: { field: string }) => d.field === 'password')).toBe(true);
    const mismatch = await request(getApp()).post('/api/auth/register').set('Origin', ORIGIN).send(studentPayload({ confirmPassword: 'Different1234' }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.details[0].field).toBe('confirmPassword');
  });

  it('ignores attempts to self-assign a host role during registration', async () => {
    const res = await request(getApp()).post('/api/auth/register').set('Origin', ORIGIN).send({ ...studentPayload(), role: 'host' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('student');
  });
});

describe('login, session and logout', () => {
  it('logs a student in by PRN or email and rejects bad passwords', async () => {
    const payload = studentPayload();
    await request(getApp()).post('/api/auth/register').set('Origin', ORIGIN).send(payload);
    const byPrn = await request(getApp()).post('/api/auth/login').set('Origin', ORIGIN).send({ role: 'student', identifier: payload.prn.toLowerCase(), password: payload.password });
    expect(byPrn.status).toBe(200);
    const byEmail = await request(getApp()).post('/api/auth/login').set('Origin', ORIGIN).send({ role: 'student', identifier: payload.email, password: payload.password });
    expect(byEmail.status).toBe(200);
    const bad = await request(getApp()).post('/api/auth/login').set('Origin', ORIGIN).send({ role: 'student', identifier: payload.prn, password: 'WrongPass123' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe('Invalid credentials.');
  });

  it('a student cannot log in through the host login', async () => {
    const payload = studentPayload();
    await request(getApp()).post('/api/auth/register').set('Origin', ORIGIN).send(payload);
    const res = await request(getApp()).post('/api/auth/login').set('Origin', ORIGIN).send({ role: 'host', email: payload.email, password: payload.password });
    expect(res.status).toBe(401);
  });

  it('returns the current user from /me and clears the session on logout', async () => {
    const student = await registerStudent(getApp());
    const me = await student.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user._id).toBe(student.user._id);
    expect(me.body.csrfToken).toBe(student.csrf);
    const out = await student.post('/api/auth/logout');
    expect(out.status).toBe(204);
    expect((await student.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects unauthenticated requests', async () => {
    expect((await request(getApp()).get('/api/auth/me')).status).toBe(401);
    expect((await request(getApp()).get('/api/questions')).status).toBe(401);
    expect((await request(getApp()).get('/api/competitions')).status).toBe(401);
  });

  it('rejects forged or tampered session cookies', async () => {
    const res = await request(getApp()).get('/api/auth/me').set('Cookie', 'mh_session=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiaG9zdCJ9.forged');
    expect(res.status).toBe(401);
  });
});

describe('host access boundaries', () => {
  it('blocks students from every host endpoint', async () => {
    const student = await registerStudent(getApp());
    const checks = [
      student.get('/api/questions'),
      student.post('/api/questions', {}),
      student.get('/api/questions/template.csv'),
      student.post('/api/competitions', { name: 'Hack' }),
      student.get('/api/students'),
      student.get('/api/host/overview'),
    ];
    for (const res of await Promise.all(checks)) expect(res.status).toBe(403);
  });

  it('has no public host registration route', async () => {
    const res = await request(getApp()).post('/api/auth/host/register').set('Origin', ORIGIN).send({ email: 'x@y.z', password: 'Whatever123' });
    expect(res.status).toBe(404);
  });

  it('createHostAccount is idempotent and hashes the password', async () => {
    expect((await createHostAccount(HOST)).created).toBe(true);
    expect((await createHostAccount(HOST)).created).toBe(false);
    expect(await Host.countDocuments()).toBe(1);
    const host = await Host.findOne().select('+passwordHash').lean();
    expect(host?.passwordHash).not.toContain(HOST.password);
  });

  it('lets an authenticated host reach host endpoints', async () => {
    const host = await loginHost(getApp());
    expect((await host.get('/api/questions')).status).toBe(200);
    expect((await host.get('/api/host/overview')).status).toBe(200);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the session CSRF token', async () => {
    const host = await loginHost(getApp());
    const res = await host.agent.post('/api/questions').set('Origin', ORIGIN).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('rejects requests from a foreign origin', async () => {
    const res = await request(getApp()).post('/api/auth/login').set('Origin', 'https://evil.example').send({ role: 'host', email: HOST.email, password: 'x' });
    expect(res.status).toBe(403);
  });
});
