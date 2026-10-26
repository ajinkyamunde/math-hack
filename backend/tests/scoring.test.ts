import { describe, expect, it } from 'vitest';
import { Attempt } from '../src/models/Attempt.js';
import { processDueCompetition } from '../src/services/competitionService.js';
import { submitAnswer } from '../src/services/scoringService.js';
import { assignRanks } from '../src/services/rankingPolicy.js';
import { createOpenCompetition, createQuestions, elapse, loginHost, registerStudent, useTestDatabase } from './helpers.js';

const getApp = useTestDatabase();
const EASY = { difficulty: 'EASY', timeLimitSeconds: 20, points: 10, correctOption: 'C' };
const MEDIUM = { difficulty: 'MEDIUM', timeLimitSeconds: 300, points: 20, correctOption: 'B' };

async function liveSetup(specs: Record<string, unknown>[] = [EASY, MEDIUM], extra: Record<string, unknown> = {}) {
  const host = await loginHost(getApp());
  const questionIds = await createQuestions(host, specs);
  const id = await createOpenCompetition(host, questionIds, extra);
  const student = await registerStudent(getApp());
  await student.post(`/api/competitions/${id}/join`);
  await host.post(`/api/competitions/${id}/start`);
  return { host, student, id, questionIds };
}

describe('answer submission', () => {
  it('awards points for a correct answer and hides correctness from the student', async () => {
    const { student, id, questionIds } = await liveSetup();
    const state = await student.get(`/api/competitions/${id}/state`);
    expect(state.body.competition.currentQuestion.id).toBe(questionIds[0]);
    expect(state.body.competition.currentQuestion.correctOption).toBeUndefined();
    expect(JSON.stringify(state.body)).not.toContain('explanation');

    const res = await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'C' });
    expect(res.status).toBe(201);
    expect(res.body.submission).toMatchObject({ selectedOption: 'C', alreadySubmitted: false });
    expect(res.body.submission.isCorrect).toBeUndefined();
    const attempt = await Attempt.findOne().lean();
    expect(attempt).toMatchObject({ isCorrect: true, pointsAwarded: 10, timedOut: false });
    expect(attempt!.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(attempt!.responseTimeMs).toBeLessThan(5000);

    const restored = await student.get(`/api/competitions/${id}/state`);
    expect(restored.body.competition.mySubmission).toMatchObject({ questionId: questionIds[0], selectedOption: 'C' });
  });

  it('gives zero points for an incorrect answer', async () => {
    const { student, id, questionIds } = await liveSetup();
    await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'A' });
    expect(await Attempt.findOne().lean()).toMatchObject({ isCorrect: false, pointsAwarded: 0 });
  });

  it('ignores client-supplied correctness, points and timing', async () => {
    const { student, id, questionIds } = await liveSetup();
    await student.post(`/api/competitions/${id}/answers`, {
      questionId: questionIds[0],
      selectedOption: 'A',
      isCorrect: true,
      pointsAwarded: 999,
      responseTimeMs: 1,
      studentId: '000000000000000000000000',
    });
    const attempt = await Attempt.findOne().lean();
    expect(attempt).toMatchObject({ isCorrect: false, pointsAwarded: 0, studentId: expect.anything() });
    expect(String(attempt!.studentId)).toBe(student.user._id);
  });

  it('a repeated submission returns the original and never awards points twice', async () => {
    const { student, id, questionIds } = await liveSetup();
    const first = await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'C' });
    const second = await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'A' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.submission).toMatchObject({ selectedOption: 'C', alreadySubmitted: true });
    expect(await Attempt.countDocuments()).toBe(1);
  });

  it('simultaneous submissions from the same student are scored once', async () => {
    const { student, id, questionIds } = await liveSetup();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: i % 2 ? 'C' : 'A' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(7);
    expect(await Attempt.countDocuments()).toBe(1);
  });

  it('rejects a late submission received at or after the deadline', async () => {
    const { student, id, questionIds } = await liveSetup();
    const state = (await student.get(`/api/competitions/${id}/state`)).body.competition;
    const deadline = new Date(state.currentQuestion.deadline);
    await expect(
      submitAnswer({ competitionId: id, studentId: student.user._id, questionId: questionIds[0]!, selectedOption: 'C', receivedAt: deadline }),
    ).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
    const justInTime = await submitAnswer({
      competitionId: id,
      studentId: student.user._id,
      questionId: questionIds[0]!,
      selectedOption: 'C',
      receivedAt: new Date(deadline.getTime() - 1),
    });
    expect(justInTime.alreadySubmitted).toBe(false);
  });

  it('rejects answers to a closed question, while paused, from non-participants and after completion', async () => {
    const { host, student, id, questionIds } = await liveSetup();
    const outsider = await registerStudent(getApp());
    expect((await outsider.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'C' })).status).toBe(403);
    expect((await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[1], selectedOption: 'B' })).status).toBe(409);

    await host.post(`/api/competitions/${id}/pause`);
    const paused = await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'C' });
    expect(paused.status).toBe(409);
    expect(paused.body.error.message).toMatch(/paused/);
    await host.post(`/api/competitions/${id}/resume`);

    await host.post(`/api/competitions/${id}/end`);
    expect((await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'C' })).status).toBe(409);
    expect(await Attempt.countDocuments({ timedOut: false })).toBe(0);
  });

  it('records timeouts for participants who did not answer, without a response time', async () => {
    const { student, id, questionIds } = await liveSetup();
    const other = await registerStudent(getApp());
    await other.post(`/api/competitions/${id}/join`);
    await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'C' });
    await elapse(id, 21_000);
    await processDueCompetition(id);
    const timeout = await Attempt.findOne({ timedOut: true }).lean();
    expect(String(timeout!.studentId)).toBe(other.user._id);
    expect(timeout!.responseTimeMs).toBeNull();
    expect(timeout!.pointsAwarded).toBe(0);
  });

  it('an answer received before the deadline replaces a timeout row written during the close race', async () => {
    const { student, id, questionIds } = await liveSetup();
    const state = (await student.get(`/api/competitions/${id}/state`)).body.competition;
    const competition = await (await import('../src/models/Competition.js')).Competition.findById(id).lean();
    await Attempt.create({
      competitionId: id,
      questionId: questionIds[0],
      studentId: student.user._id,
      difficulty: 'EASY',
      selectedOption: null,
      isCorrect: false,
      responseTimeMs: null,
      pointsAwarded: 0,
      timedOut: true,
    });
    void competition;
    const receivedAt = new Date(new Date(state.currentQuestion.deadline).getTime() - 1000);
    const result = await submitAnswer({ competitionId: id, studentId: student.user._id, questionId: questionIds[0]!, selectedOption: 'C', receivedAt });
    expect(result.alreadySubmitted).toBe(false);
    expect(await Attempt.findOne().lean()).toMatchObject({ timedOut: false, isCorrect: true, pointsAwarded: 10 });
  });

  it('subtracts paused time from response times', async () => {
    const { host, student, id, questionIds } = await liveSetup([MEDIUM]);
    await elapse(id, 10_000);
    await host.post(`/api/competitions/${id}/pause`);
    await elapse(id, 60_000);
    await host.post(`/api/competitions/${id}/resume`);
    await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'B' });
    const attempt = await Attempt.findOne().lean();
    expect(attempt!.responseTimeMs).toBeGreaterThanOrEqual(10_000);
    expect(attempt!.responseTimeMs).toBeLessThan(15_000);
  });

  it('applies competition point overrides', async () => {
    const { student, id, questionIds } = await liveSetup([EASY], { settings: { pointsOverride: { EASY: 15 } } });
    await student.post(`/api/competitions/${id}/answers`, { questionId: questionIds[0], selectedOption: 'C' });
    expect((await Attempt.findOne().lean())!.pointsAwarded).toBe(15);
  });
});

describe('tie-breaking', () => {
  const entry = (prn: string, totalPoints: number, correct: number, accuracy: number | null, avgCorrectResponseMs: number | null) => ({
    prn,
    totalPoints,
    correct,
    accuracy,
    avgCorrectResponseMs,
  });

  it('orders by points, correct answers, accuracy, then correct-answer speed', () => {
    const ranked = assignRanks([
      entry('E', 20, 2, 1, 9000),
      entry('A', 30, 3, 1, 5000),
      entry('B', 20, 2, 0.5, 1000),
      entry('C', 20, 2, 1, 3000),
      entry('D', 20, 1, 1, 100),
    ]);
    expect(ranked.map((r) => [r.prn, r.rank])).toEqual([
      ['A', 1],
      ['C', 2],
      ['E', 3],
      ['B', 4],
      ['D', 5],
    ]);
  });

  it('gives fully tied entries the same rank, ordered stably by PRN', () => {
    const ranked = assignRanks([entry('Z9', 10, 1, 1, 2000), entry('A1', 10, 1, 1, 2000), entry('M5', 0, 0, null, null)]);
    expect(ranked.map((r) => [r.prn, r.rank])).toEqual([
      ['A1', 1],
      ['Z9', 1],
      ['M5', 3],
    ]);
    expect(assignRanks(ranked.slice().reverse()).map((r) => r.prn)).toEqual(['A1', 'Z9', 'M5']);
  });

  it('never treats missing data as a zero-second response', () => {
    const ranked = assignRanks([entry('NOANS', 0, 0, null, null), entry('WRONG', 0, 0, 0, null)]);
    expect(ranked[0]!.prn).toBe('WRONG'); // answered (0% accuracy) beats never answering
  });
});
