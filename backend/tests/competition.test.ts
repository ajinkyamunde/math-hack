import { describe, expect, it } from 'vitest';
import { Competition } from '../src/models/Competition.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { processDueCompetition } from '../src/services/competitionService.js';
import { createOpenCompetition, createQuestions, elapse, loginHost, registerStudent, useTestDatabase } from './helpers.js';

const getApp = useTestDatabase();

const EASY = { difficulty: 'EASY', timeLimitSeconds: 20, points: 10 };
const HARD = { difficulty: 'HARD', timeLimitSeconds: 900, points: 30 };

describe('competition lifecycle', () => {
  it('creates a draft with the default 30 minute duration and an explicit queue order', async () => {
    const host = await loginHost(getApp());
    const [a, b] = await createQuestions(host, [EASY, EASY]);
    const res = await host.post('/api/competitions', { name: 'Endgame Cup', questionIds: [b, a] });
    expect(res.status).toBe(201);
    expect(res.body.competition).toMatchObject({ status: 'DRAFT', durationSeconds: 1800 });
    expect(res.body.competition.queue.map((q: { questionId: string }) => q.questionId)).toEqual([b, a]);
  });

  it('refuses to queue draft questions', async () => {
    const host = await loginHost(getApp());
    const [draft] = await createQuestions(host, [{ ...EASY, status: 'DRAFT' }]);
    const res = await host.post('/api/competitions', { name: 'Draft Cup', questionIds: [draft] });
    expect(res.status).toBe(400);
  });

  it('starts correctly and auto-publishes the first question in automatic mode', async () => {
    const host = await loginHost(getApp());
    const [q1, q2] = await createQuestions(host, [EASY, EASY]);
    const id = await createOpenCompetition(host, [q1!, q2!]);
    const before = Date.now();
    const res = await host.post(`/api/competitions/${id}/start`);
    expect(res.status).toBe(200);
    const c = res.body.competition;
    expect(c.status).toBe('RUNNING');
    expect(new Date(c.endsAt).getTime() - new Date(c.startedAt).getTime()).toBe(1800 * 1000);
    expect(c.currentQuestion.id).toBe(q1);
    const deadline = new Date(c.currentQuestion.deadline).getTime();
    expect(deadline).toBeGreaterThanOrEqual(before + 20_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 20_000);
    expect(await AuditLog.countDocuments({ action: 'competition.start' })).toBe(1);
  });

  it('rejects invalid lifecycle transitions', async () => {
    const host = await loginHost(getApp());
    const [q] = await createQuestions(host, [EASY]);
    const draft = await host.post('/api/competitions', { name: 'Lifecycle', questionIds: [q] });
    const id = draft.body.competition.id;
    expect((await host.post(`/api/competitions/${id}/start`)).status).toBe(409); // DRAFT -> RUNNING skips WAITING
    expect((await host.post(`/api/competitions/${id}/publish`)).status).toBe(409); // publish before start
    expect((await host.post(`/api/competitions/${id}/resume`)).status).toBe(409);
    await host.post(`/api/competitions/${id}/open`);
    await host.post(`/api/competitions/${id}/start`);
    expect((await host.post(`/api/competitions/${id}/start`)).status).toBe(409);
    expect((await host.post(`/api/competitions/${id}/resume`)).status).toBe(409); // running, not paused
    await host.post(`/api/competitions/${id}/end`);
    const resume = await host.post(`/api/competitions/${id}/resume`);
    expect(resume.status).toBe(409);
    expect(resume.body.error.message).toMatch(/already ended/);
    expect((await host.post(`/api/competitions/${id}/pause`)).status).toBe(409);
    expect((await host.post(`/api/competitions/${id}/cancel`)).status).toBe(409);
  });

  it('refuses to start with an empty queue', async () => {
    const host = await loginHost(getApp());
    const id = await createOpenCompetition(host, []);
    const res = await host.post(`/api/competitions/${id}/start`);
    expect(res.status).toBe(400);
  });

  it('pause and resume preserve the exact remaining time', async () => {
    const host = await loginHost(getApp());
    const [q] = await createQuestions(host, [HARD]);
    const id = await createOpenCompetition(host, [q!]);
    await host.post(`/api/competitions/${id}/start`);
    await elapse(id, 100_000); // 100 s into the question

    const paused = await host.post(`/api/competitions/${id}/pause`);
    expect(paused.body.competition.status).toBe('PAUSED');
    const questionLeft = paused.body.competition.currentQuestion.remainingMs;
    const overallLeft = paused.body.competition.remainingMs;
    expect(questionLeft).toBeGreaterThan(799_000);
    expect(questionLeft).toBeLessThanOrEqual(800_000);

    await elapse(id, 60_000); // a one-minute pause
    const stillPaused = await host.get(`/api/competitions/${id}`);
    expect(Math.abs(stillPaused.body.competition.currentQuestion.remainingMs - questionLeft)).toBeLessThan(5);

    const resumed = await host.post(`/api/competitions/${id}/resume`);
    expect(resumed.body.competition.status).toBe('RUNNING');
    expect(Math.abs(resumed.body.competition.currentQuestion.remainingMs - questionLeft)).toBeLessThan(500);
    expect(Math.abs(resumed.body.competition.remainingMs - overallLeft)).toBeLessThan(500);
    const stored = await Competition.findById(id).lean();
    expect(stored!.totalPausedMilliseconds).toBeGreaterThanOrEqual(60_000);
    expect(stored!.currentQuestionPausedMs).toBeGreaterThanOrEqual(60_000);
  });

  it('closes an expired question and automatically publishes the next one', async () => {
    const host = await loginHost(getApp());
    const [q1, q2] = await createQuestions(host, [EASY, EASY]);
    const id = await createOpenCompetition(host, [q1!, q2!]);
    await host.post(`/api/competitions/${id}/start`);
    await elapse(id, 21_000);
    await processDueCompetition(id);
    const state = (await host.get(`/api/competitions/${id}`)).body.competition;
    expect(state.queue[0]).toMatchObject({ status: 'CLOSED', closeReason: 'TIMER' });
    expect(state.currentQuestion.id).toBe(q2);
    expect(state.currentQuestion.remainingMs).toBeGreaterThan(19_000);
  });

  it('waits for the host in manual mode, and can complete when the queue empties', async () => {
    const host = await loginHost(getApp());
    const [q1] = await createQuestions(host, [EASY]);
    const manual = await createOpenCompetition(host, [q1!], { questionProgressionMode: 'MANUAL', settings: { completeWhenQueueEmpty: true } });
    const started = await host.post(`/api/competitions/${manual}/start`);
    expect(started.body.competition.currentQuestion).toBeNull();
    const published = await host.post(`/api/competitions/${manual}/publish`);
    expect(published.body.competition.currentQuestion.id).toBe(q1);
    await elapse(manual, 21_000);
    await processDueCompetition(manual);
    const done = (await host.get(`/api/competitions/${manual}`)).body.competition;
    expect(done.status).toBe('COMPLETED');
    expect(done.completionReason).toBe('QUEUE_EMPTY');
  });

  it('the overall deadline caps a long question and ends the competition', async () => {
    const host = await loginHost(getApp());
    const [hard] = await createQuestions(host, [HARD]);
    const id = await createOpenCompetition(host, [hard!], { durationSeconds: 300 });
    const started = (await host.post(`/api/competitions/${id}/start`)).body.competition;
    expect(started.currentQuestion.deadline).toBe(started.endsAt); // 15-minute question, 5 minutes left
    await elapse(id, 301_000);
    await processDueCompetition(id);
    const done = (await host.get(`/api/competitions/${id}`)).body.competition;
    expect(done.status).toBe('COMPLETED');
    expect(done.completionReason).toBe('TIMER');
    expect(done.queue[0].closeReason).toBe('COMPETITION_ENDED');
    expect(done.currentQuestion).toBeNull();
  });

  it('manual selection closes the live question before publishing the chosen one', async () => {
    const host = await loginHost(getApp());
    const [q1, q2, q3] = await createQuestions(host, [EASY, EASY, EASY]);
    const id = await createOpenCompetition(host, [q1!, q2!, q3!]);
    await host.post(`/api/competitions/${id}/start`);
    const res = await host.post(`/api/competitions/${id}/publish`, { questionId: q3 });
    expect(res.body.competition.currentQuestion.id).toBe(q3);
    expect(res.body.competition.queue.map((q: { status: string }) => q.status)).toEqual(['CLOSED', 'PENDING', 'LIVE']);
    expect(res.body.competition.queue[0].closeReason).toBe('HOST_NEXT');
    expect((await host.post(`/api/competitions/${id}/publish`, { questionId: q1 })).status).toBe(409);
  });

  it('skip closes the live question and advances; skipping a pending question removes it', async () => {
    const host = await loginHost(getApp());
    const [q1, q2, q3] = await createQuestions(host, [EASY, EASY, EASY]);
    const id = await createOpenCompetition(host, [q1!, q2!, q3!]);
    await host.post(`/api/competitions/${id}/start`);
    const removed = await host.post(`/api/competitions/${id}/skip`, { questionId: q2 });
    expect(removed.body.competition.queue[1].status).toBe('SKIPPED');
    const skipped = await host.post(`/api/competitions/${id}/skip`);
    expect(skipped.body.competition.queue[0]).toMatchObject({ status: 'SKIPPED', closeReason: 'SKIPPED' });
    expect(skipped.body.competition.currentQuestion.id).toBe(q3);
  });

  it('two simultaneous publish commands never publish twice', async () => {
    const host = await loginHost(getApp());
    const ids = await createQuestions(host, [EASY, EASY, EASY, EASY]);
    const id = await createOpenCompetition(host, ids, { questionProgressionMode: 'MANUAL' });
    await host.post(`/api/competitions/${id}/start`);
    const results = await Promise.all([host.post(`/api/competitions/${id}/publish`), host.post(`/api/competitions/${id}/publish`)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const stored = await Competition.findById(id).lean();
    expect(stored!.queue.filter((q) => q.status === 'LIVE')).toHaveLength(1);
    expect(stored!.queue.filter((q) => q.publishedAt)).toHaveLength(2); // second command advanced once more, consistently
  });

  it('host-only actions require host authorization', async () => {
    const host = await loginHost(getApp());
    const [q] = await createQuestions(host, [EASY]);
    const id = await createOpenCompetition(host, [q!]);
    const student = await registerStudent(getApp());
    for (const action of ['start', 'pause', 'resume', 'publish', 'skip', 'end', 'cancel']) {
      expect((await student.post(`/api/competitions/${id}/${action}`)).status).toBe(403);
    }
    expect((await student.put(`/api/competitions/${id}/queue`, { questionIds: [] })).status).toBe(403);
    expect((await student.get(`/api/competitions/${id}/export.xlsx`)).status).toBe(403);
  });

  it('reorders pending questions while running without touching published ones', async () => {
    const host = await loginHost(getApp());
    const [q1, q2, q3] = await createQuestions(host, [EASY, EASY, EASY]);
    const id = await createOpenCompetition(host, [q1!, q2!, q3!]);
    await host.post(`/api/competitions/${id}/start`);
    const res = await host.put(`/api/competitions/${id}/queue`, { questionIds: [q3, q2] });
    expect(res.status).toBe(200);
    expect(res.body.competition.queue.map((q: { questionId: string }) => q.questionId)).toEqual([q1, q3, q2]);
    expect(res.body.competition.queue[1].snapshot).not.toBeNull();
  });

  it('students see waiting/live competitions but not drafts', async () => {
    const host = await loginHost(getApp());
    const [q] = await createQuestions(host, [EASY]);
    await host.post('/api/competitions', { name: 'Hidden draft', questionIds: [q] });
    const open = await createOpenCompetition(host, [q!]);
    const student = await registerStudent(getApp());
    const list = await student.get('/api/competitions');
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([open]);
    expect(list.body.items[0].joined).toBe(false);
  });
});
