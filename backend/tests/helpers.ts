import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/config/database.js';
import { createHostAccount } from '../src/services/authService.js';

export const ORIGIN = 'http://localhost:5173';
export const HOST = { name: 'Test Host', email: 'host@mathhack.test', password: 'HostPassw0rd!' };

let app: Express;

/** Connects once per file and wipes every collection before each test. */
export function useTestDatabase(): () => Express {
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) await connectDatabase();
    app = createApp();
  });
  beforeEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
  return () => app;
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  user: { _id: string; role: string };
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
}

function wrap(agent: ReturnType<typeof request.agent>, csrf: string, user: Client['user']): Client {
  const withHeaders = (test: request.Test) => test.set('Origin', ORIGIN).set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    user,
    get: (url) => agent.get(url).set('Origin', ORIGIN),
    post: (url, body) => withHeaders(agent.post(url)).send(body ?? {}),
    put: (url, body) => withHeaders(agent.put(url)).send(body ?? {}),
    patch: (url, body) => withHeaders(agent.patch(url)).send(body ?? {}),
    del: (url) => withHeaders(agent.delete(url)),
  };
}

export async function loginHost(app: Express): Promise<Client> {
  await createHostAccount(HOST);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ role: 'host', email: HOST.email, password: HOST.password });
  if (res.status !== 200) throw new Error(`host login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return wrap(agent, res.body.csrfToken, res.body.user);
}

let studentCounter = 0;

export function studentPayload(overrides: Partial<Record<string, string>> = {}) {
  studentCounter += 1;
  const n = String(studentCounter).padStart(4, '0');
  return {
    name: `Student ${n}`,
    prn: `PRN2026${n}`,
    email: `student${n}@college.test`,
    department: 'Computer Engineering',
    academicYear: 'SE',
    password: 'Passw0rdStrong',
    confirmPassword: 'Passw0rdStrong',
    ...overrides,
  };
}

export async function registerStudent(app: Express, overrides: Partial<Record<string, string>> = {}): Promise<Client> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').set('Origin', ORIGIN).send(studentPayload(overrides));
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return wrap(agent, res.body.csrfToken, res.body.user);
}

export function questionPayload(overrides: Record<string, unknown> = {}) {
  return {
    questionText: `What is ${Math.floor(Math.random() * 1e9)} + 0?`,
    options: ['1', '2', '3', '4'],
    correctOption: 'C',
    difficulty: 'EASY',
    timeLimitSeconds: 25,
    points: 10,
    topic: 'Arithmetic',
    explanation: 'Because.',
    status: 'ACTIVE',
    ...overrides,
  };
}

export async function createQuestions(host: Client, specs: Record<string, unknown>[]): Promise<string[]> {
  const ids: string[] = [];
  for (const spec of specs) {
    const res = await host.post('/api/questions', questionPayload(spec));
    if (res.status !== 201) throw new Error(`question create failed: ${JSON.stringify(res.body)}`);
    ids.push(res.body.question._id);
  }
  return ids;
}

/** Creates a competition with the given questions and moves it to WAITING. */
export async function createOpenCompetition(host: Client, questionIds: string[], extra: Record<string, unknown> = {}): Promise<string> {
  const res = await host.post('/api/competitions', { name: 'Test Cup', questionIds, ...extra });
  if (res.status !== 201) throw new Error(`competition create failed: ${JSON.stringify(res.body)}`);
  const id = res.body.competition.id as string;
  const open = await host.post(`/api/competitions/${id}/open`);
  if (open.status !== 200) throw new Error(`open failed: ${JSON.stringify(open.body)}`);
  return id;
}

/**
 * Simulates the passage of time for one competition by moving every stored timestamp back by `ms`.
 * Because the engine derives all timing from stored timestamps, this is equivalent to waiting.
 */
export async function elapse(competitionId: string, ms: number): Promise<void> {
  const { Competition } = await import('../src/models/Competition.js');
  const doc = await Competition.findById(competitionId);
  if (!doc) throw new Error('competition not found');
  const back = (d?: Date | null) => (d ? new Date(d.getTime() - ms) : d);
  for (const field of ['startedAt', 'endsAt', 'pausedAt', 'currentQuestionStartedAt', 'currentQuestionDeadline'] as const) {
    if (doc[field]) doc.set(field, back(doc[field]));
  }
  doc.queue.forEach((item) => {
    if (item.publishedAt) item.publishedAt = back(item.publishedAt)!;
    if (item.deadline) item.deadline = back(item.deadline)!;
    if (item.closedAt) item.closedAt = back(item.closedAt)!;
  });
  await doc.save();
  const { Participant } = await import('../src/models/Participant.js');
  const { Attempt } = await import('../src/models/Attempt.js');
  await Participant.updateMany({ competitionId }, [{ $set: { joinedAt: { $subtract: ['$joinedAt', ms] } } }]);
  await Attempt.updateMany({ competitionId, submittedAt: { $ne: null } }, [{ $set: { submittedAt: { $subtract: ['$submittedAt', ms] } } }]);
}
