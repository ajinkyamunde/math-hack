import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';
import { createHostAccount } from '../src/services/authService.js';
import { HOST, ORIGIN, questionPayload, studentPayload } from './helpers.js';
import { Attempt } from '../src/models/Attempt.js';

let server: RunningServer;
let base: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = await startServer({ port: 0 });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await server.stop();
});
beforeEach(async () => {
  sockets.forEach((s) => s.disconnect());
  sockets.length = 0;
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

interface Session {
  cookie: string;
  csrf: string;
  id: string;
  post: (url: string, body?: object) => Promise<request.Response>;
}

function session(res: request.Response): Session {
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  const csrf = res.body.csrfToken as string;
  return {
    cookie,
    csrf,
    id: res.body.user._id,
    post: (url, body = {}) => request(base).post(url).set('Origin', ORIGIN).set('Cookie', cookie).set('X-CSRF-Token', csrf).send(body),
  };
}

async function hostSession(): Promise<Session> {
  await createHostAccount(HOST);
  return session(await request(base).post('/api/auth/login').set('Origin', ORIGIN).send({ role: 'host', email: HOST.email, password: HOST.password }));
}

async function studentSession(): Promise<Session> {
  return session(await request(base).post('/api/auth/register').set('Origin', ORIGIN).send(studentPayload()));
}

function socketFor(s: Session | null, origin = ORIGIN): Socket {
  const socket = connect(base, { transports: ['websocket'], extraHeaders: { Cookie: s?.cookie ?? '', Origin: origin }, reconnection: false, forceNew: true });
  sockets.push(socket);
  return socket;
}

const once = <T>(socket: Socket, event: string, timeout = 4000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ack payloads are asserted structurally in each test
const emit = <T = { ok: boolean; data?: any; error?: { code: string; message: string } }>(socket: Socket, event: string, payload: object) =>
  new Promise<T>((resolve) => socket.emit(event, payload, resolve));

async function connected(socket: Socket): Promise<void> {
  if (socket.connected) return;
  await once(socket, 'connect');
}

async function setupCompetition(host: Session, studentCount: number) {
  const q1 = (await host.post('/api/questions', questionPayload({ correctOption: 'B' }))).body.question._id as string;
  const q2 = (await host.post('/api/questions', questionPayload({ correctOption: 'D' }))).body.question._id as string;
  const created = await host.post('/api/competitions', { name: 'Socket Cup', questionIds: [q1, q2], questionProgressionMode: 'MANUAL' });
  const id = created.body.competition.id as string;
  await host.post(`/api/competitions/${id}/open`);
  const students: Session[] = [];
  for (let i = 0; i < studentCount; i += 1) {
    const s = await studentSession();
    await s.post(`/api/competitions/${id}/join`);
    students.push(s);
  }
  return { id, q1, q2, students };
}

describe('socket authentication', () => {
  it('rejects connections without a session or from a foreign origin', async () => {
    const anonymous = socketFor(null);
    expect((await once<Error>(anonymous, 'connect_error')).message).toBe('UNAUTHENTICATED');
    const student = await studentSession();
    const foreign = socketFor(student, 'https://evil.example');
    expect((await once<Error>(foreign, 'connect_error')).message).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('real-time competition flow', () => {
  it('delivers published questions to every joined student without answers, and scores submissions', async () => {
    const host = await hostSession();
    const { id, q1, students } = await setupCompetition(host, 3);
    const hostSocket = socketFor(host);
    const studentSockets = students.map((s) => socketFor(s));
    await Promise.all([hostSocket, ...studentSockets].map(connected));
    expect((await emit(hostSocket, 'competition:join', { competitionId: id })).ok).toBe(true);
    for (const socket of studentSockets) {
      const ack = await emit(socket, 'competition:join', { competitionId: id });
      expect(ack.ok).toBe(true);
      expect(ack.data.status).toBe('WAITING');
    }

    const started = Promise.all(studentSockets.map((s) => once(s, 'competition:started')));
    await host.post(`/api/competitions/${id}/start`);
    await started;

    const published = Promise.all(studentSockets.map((s) => once<{ question: Record<string, unknown> }>(s, 'question:published')));
    const hostCountUpdate = once<{ answered: number }>(hostSocket, 'question:answer-count');
    const publishAck = await emit(hostSocket, 'host:publish-question', { competitionId: id });
    expect(publishAck.ok).toBe(true);
    const payloads = await published;
    for (const payload of payloads) {
      expect(payload.question.id).toBe(q1);
      expect(payload.question.correctOption).toBeUndefined();
      expect(payload.question.explanation).toBeUndefined();
      expect(payload.question.options).toHaveLength(4);
    }

    // Only the submitting student hears about their submission.
    let leaked = false;
    studentSockets[1]!.on('answer:received', () => (leaked = true));
    const received = once<{ selectedOption: string }>(studentSockets[0]!, 'answer:received');
    const submitAck = await emit(studentSockets[0]!, 'question:submit', { competitionId: id, questionId: q1, selectedOption: 'B' });
    expect(submitAck).toMatchObject({ ok: true, data: { selectedOption: 'B', alreadySubmitted: false } });
    expect((await received).selectedOption).toBe('B');
    expect((await hostCountUpdate).answered).toBe(1);

    const duplicate = await emit(studentSockets[0]!, 'question:submit', { competitionId: id, questionId: q1, selectedOption: 'A' });
    expect(duplicate).toMatchObject({ ok: true, data: { selectedOption: 'B', alreadySubmitted: true } });
    expect(leaked).toBe(false);
    await emit(studentSockets[1]!, 'question:submit', { competitionId: id, questionId: q1, selectedOption: 'A' });

    const closed = once<{ correctOption?: string }>(studentSockets[2]!, 'question:closed');
    const leaderboard = once<{ entries: { name: string; totalPoints: number; prn?: string }[] }>(studentSockets[2]!, 'leaderboard:updated');
    const completed = once(studentSockets[2]!, 'competition:completed');
    expect((await emit(hostSocket, 'host:end', { competitionId: id })).ok).toBe(true);
    expect((await closed).correctOption).toBe('B'); // revealed only after closing
    const board = await leaderboard;
    expect(board.entries[0]!.totalPoints).toBe(10);
    expect(board.entries[0]!.prn).toBeUndefined();
    await completed;
    expect(await Attempt.countDocuments({ timedOut: false })).toBe(2);
    expect(await Attempt.countDocuments({ timedOut: true })).toBe(1);
  });

  it('refuses host events from students and room access to non-participants', async () => {
    const host = await hostSession();
    const { id, students } = await setupCompetition(host, 1);
    const outsider = await studentSession();
    const studentSocket = socketFor(students[0]!);
    const outsiderSocket = socketFor(outsider);
    await Promise.all([studentSocket, outsiderSocket].map(connected));
    for (const event of ['host:publish-question', 'host:pause', 'host:resume', 'host:skip', 'host:end']) {
      const ack = await emit(studentSocket, event, { competitionId: id });
      expect(ack).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(await emit(outsiderSocket, 'competition:join', { competitionId: id })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await emit(studentSocket, 'competition:join', { competitionId: 'not-an-id' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('restores the current question and remaining time for a reconnecting student', async () => {
    const host = await hostSession();
    const { id, q1, students } = await setupCompetition(host, 1);
    await host.post(`/api/competitions/${id}/start`);
    await host.post(`/api/competitions/${id}/publish`);
    const first = socketFor(students[0]!);
    await connected(first);
    await emit(first, 'competition:join', { competitionId: id });
    await emit(first, 'question:submit', { competitionId: id, questionId: q1, selectedOption: 'C' });
    first.disconnect();

    const second = socketFor(students[0]!);
    await connected(second);
    const ack = await emit(second, 'competition:join', { competitionId: id });
    expect(ack.data.currentQuestion.id).toBe(q1);
    expect(ack.data.currentQuestion.remainingMs).toBeGreaterThan(15_000);
    expect(ack.data.currentQuestion.remainingMs).toBeLessThanOrEqual(25_000);
    expect(ack.data.mySubmission).toMatchObject({ questionId: q1, selectedOption: 'C' });
  });

  it('closes a question on its real timer and broadcasts the close', async () => {
    const host = await hostSession();
    const { id, students } = await setupCompetition(host, 1);
    await host.post(`/api/competitions/${id}/start`);
    await host.post(`/api/competitions/${id}/publish`);
    const socket = socketFor(students[0]!);
    await connected(socket);
    await emit(socket, 'competition:join', { competitionId: id });
    // Shorten the live deadline in the database; the timer watchdog must notice and close it.
    const { Competition } = await import('../src/models/Competition.js');
    const soon = new Date(Date.now() + 300);
    await Competition.updateOne({ _id: id }, { $set: { currentQuestionDeadline: soon, 'queue.0.deadline': soon } });
    const closed = await once<{ reason: string }>(socket, 'question:closed', 6000);
    expect(closed.reason).toBe('TIMER');
  });
});
