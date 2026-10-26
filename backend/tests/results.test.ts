import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Competition } from '../src/models/Competition.js';
import { Participant } from '../src/models/Participant.js';
import { submitAnswer } from '../src/services/scoringService.js';
import { average } from '../src/services/analyticsService.js';
import { WORKBOOK_SHEETS } from '../src/services/exportService.js';
import { neutralizeFormula } from '../src/utils/spreadsheetSafety.js';
import { ORIGIN, createOpenCompetition, createQuestions, loginHost, registerStudent, useTestDatabase, type Client } from './helpers.js';

const getApp = useTestDatabase();

const binary = (test: request.Test) =>
  test.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

async function answerAt(id: string, student: Client, questionId: string, option: 'A' | 'B' | 'C' | 'D', afterMs: number) {
  const c = await Competition.findById(id).lean();
  const receivedAt = new Date(c!.currentQuestionStartedAt!.getTime() + afterMs);
  return submitAnswer({ competitionId: id, studentId: student.user._id, questionId, selectedOption: option, receivedAt });
}

/** Three students, three questions, deterministic response times (see expectations below). */
async function playScenario() {
  const host = await loginHost(getApp());
  const [easy, medium, hard] = await createQuestions(host, [
    { difficulty: 'EASY', timeLimitSeconds: 25, points: 10, correctOption: 'C', questionText: '=SUM(A1:A9) trick question?' },
    { difficulty: 'MEDIUM', timeLimitSeconds: 300, points: 20, correctOption: 'B' },
    { difficulty: 'HARD', timeLimitSeconds: 900, points: 30, correctOption: 'D' },
  ]);
  const id = await createOpenCompetition(host, [easy!, medium!, hard!], { questionProgressionMode: 'MANUAL', name: 'Results Cup' });
  const s1 = await registerStudent(getApp(), { prn: 'RES000001', name: '=cmd|calc' });
  const s2 = await registerStudent(getApp(), { prn: 'RES000002' });
  const s3 = await registerStudent(getApp(), { prn: 'RES000003' });
  for (const s of [s1, s2, s3]) await s.post(`/api/competitions/${id}/join`);
  await host.post(`/api/competitions/${id}/start`);

  await host.post(`/api/competitions/${id}/publish`);
  await answerAt(id, s1, easy!, 'C', 2000);
  await answerAt(id, s2, easy!, 'A', 4000);

  await host.post(`/api/competitions/${id}/publish`);
  await answerAt(id, s1, medium!, 'B', 10000);
  await answerAt(id, s2, medium!, 'B', 20000);
  await answerAt(id, s3, medium!, 'B', 30000);

  await host.post(`/api/competitions/${id}/publish`);
  await answerAt(id, s2, hard!, 'D', 100000);
  await answerAt(id, s3, hard!, 'A', 50000);

  await host.post(`/api/competitions/${id}/end`);
  return { host, id, s1, s2, s3, easy: easy!, medium: medium!, hard: hard! };
}

describe('result analytics', () => {
  it('computes scores, ranks, accuracy and averages from stored attempts', async () => {
    const { host, id, s1, s2, s3, easy } = await playScenario();
    const res = await host.get(`/api/competitions/${id}/results`);
    expect(res.status).toBe(200);
    const byPrn = Object.fromEntries(res.body.students.map((s: { prn: string }) => [s.prn, s]));

    expect(byPrn.RES000002).toMatchObject({ rank: 1, totalPoints: 50, correct: 2, incorrect: 1, attempted: 3, unanswered: 0, avgCorrectResponseMs: 60000 });
    expect(byPrn.RES000002.accuracy).toBeCloseTo(2 / 3);
    expect(byPrn.RES000001).toMatchObject({ rank: 2, totalPoints: 30, correct: 2, incorrect: 0, attempted: 2, unanswered: 1, accuracy: 1, avgCorrectResponseMs: 6000 });
    expect(byPrn.RES000001.byDifficulty.EASY.avgResponseMs).toBe(2000);
    expect(byPrn.RES000001.byDifficulty.MEDIUM.avgResponseMs).toBe(10000);
    expect(byPrn.RES000001.byDifficulty.HARD).toMatchObject({ attempted: 0, timedOut: 1, avgResponseMs: null, avgCorrectResponseMs: null });
    expect(byPrn.RES000003).toMatchObject({ rank: 3, totalPoints: 20, correct: 1, attempted: 2, unanswered: 1, accuracy: 0.5, avgCorrectResponseMs: 30000 });
    // Overall average excludes the unanswered EASY question rather than counting it as 0 s.
    expect(byPrn.RES000003.avgResponseMs).toBe(40000);

    const analytics = await host.get(`/api/competitions/${id}/analytics`);
    const q1 = analytics.body.questions.find((q: { questionId: string }) => q.questionId === easy);
    expect(q1).toMatchObject({ submissions: 2, correct: 1, incorrect: 1, timeouts: 1, accuracy: 0.5, avgResponseMs: 3000 });
    const hardSummary = analytics.body.difficulty.find((d: { difficulty: string }) => d.difficulty === 'HARD');
    expect(hardSummary).toMatchObject({ attempted: 2, correct: 1, timedOut: 1 });

    const participants = await Participant.find({ competitionId: id }).lean();
    expect(participants.map((p) => [p.finalScore, p.finalRank]).sort()).toEqual([[20, 3], [30, 2], [50, 1]].sort());
    void s1; void s2; void s3;
  });

  it('students see only their own result, after completion', async () => {
    const { id, s1 } = await playScenario();
    const res = await s1.get(`/api/competitions/${id}/results`);
    expect(res.status).toBe(200);
    expect(res.body.me.prn).toBe('RES000001');
    expect(res.body.students).toBeUndefined();
    expect(JSON.stringify(res.body.leaderboard)).not.toMatch(/RES00000[23]/); // no other PRNs
    expect(JSON.stringify(res.body.leaderboard)).not.toContain('@');
    const report = await s1.get(`/api/competitions/${id}/my-report.csv`);
    expect(report.status).toBe(200);
    expect(report.text).toContain('RES000001');
    expect(report.text).not.toContain('RES000002');
  });

  it('average() returns null for empty input instead of zero', () => {
    expect(average([])).toBeNull();
    expect(average([1000, 3000])).toBe(2000);
  });
});

describe('exports', () => {
  it('produces the six-sheet Excel workbook with the expected columns and formula protection', async () => {
    const { host, id } = await playScenario();
    const res = await binary(host.get(`/api/competitions/${id}/export.xlsx`));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/mathhack-Results-Cup-[a-f0-9]{6}-results-\d{4}-\d{2}-\d{2}\.xlsx/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as ArrayBuffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual([...WORKBOOK_SHEETS]);
    const headers = (name: string) => (workbook.getWorksheet(name)!.getRow(1).values as string[]).slice(1);
    expect(headers('Leaderboard')).toEqual(['Rank', 'PRN', 'Student Name', 'Department', 'Total Score', 'Correct Answers', 'Incorrect Answers', 'Accuracy (%)', 'Average Response Time (s)']);
    expect(headers('Easy Analytics')).toEqual(['PRN', 'Student Name', 'Questions Attempted', 'Correct Answers', 'Incorrect Answers', 'Average Response Time (s)', 'Average Correct Response Time (s)']);
    expect(headers('Question Statistics')).toContain('Timeout Count');
    expect(headers('All Attempts')).toEqual(['PRN', 'Question ID', 'Difficulty', 'Selected Option', 'Correctness', 'Response Time (s)', 'Points Awarded', 'Submission Timestamp']);

    const leaderboard = workbook.getWorksheet('Leaderboard')!;
    expect(leaderboard.getRow(2).getCell(2).value).toBe('RES000002');
    expect(leaderboard.getRow(2).getCell(5).value).toBe(50);
    const s1Row = [2, 3, 4].map((r) => leaderboard.getRow(r)).find((row) => row.getCell(2).value === 'RES000001')!;
    expect(s1Row.getCell(3).value).toBe("'=cmd|calc"); // neutralized, never a formula
    expect(workbook.getWorksheet('All Attempts')!.actualRowCount).toBe(1 + 9);
    const hardRow = [2, 3, 4].map((r) => workbook.getWorksheet('Hard Analytics')!.getRow(r)).find((row) => row.getCell(1).value === 'RES000001')!;
    expect(hardRow.getCell(6).value).toBe('N/A');
  });

  it('exports each CSV report type with formula-injection protection', async () => {
    const { host, id, s1 } = await playScenario();
    for (const type of ['results', 'students', 'questions', 'difficulty', 'attempts']) {
      const res = await host.get(`/api/competitions/${id}/export.csv?type=${type}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toContain(`-${type}-`);
    }
    const students = await host.get(`/api/competitions/${id}/export.csv?type=students`);
    expect(students.text).toContain("'=cmd|calc");
    expect(students.text).toContain('Unanswered Questions');
    const questions = await host.get(`/api/competitions/${id}/export.csv?type=questions`);
    expect(questions.text).toContain("'=SUM(A1:A9) trick question?");
    expect((await host.get(`/api/competitions/${id}/export.csv?type=bogus`)).status).toBe(400);
    const report = await host.get(`/api/competitions/${id}/students/${s1.user._id}/report.csv`);
    expect(report.status).toBe(200);
    expect(report.text).toContain('Final Rank,2');
  });

  it('rejects unauthorized exports', async () => {
    const { id, s1 } = await playScenario();
    expect((await s1.get(`/api/competitions/${id}/export.xlsx`)).status).toBe(403);
    expect((await s1.get(`/api/competitions/${id}/export.csv`)).status).toBe(403);
    expect((await s1.get(`/api/competitions/${id}/analytics`)).status).toBe(403);
    expect((await s1.get(`/api/competitions/${id}/students/${s1.user._id}/report.csv`)).status).toBe(403);
    expect((await request(getApp()).get(`/api/competitions/${id}/export.xlsx`).set('Origin', ORIGIN)).status).toBe(401);
  });

  it('produces valid reports for an empty competition', async () => {
    const host = await loginHost(getApp());
    const [q] = await createQuestions(host, [{}]);
    const id = await createOpenCompetition(host, [q!]);
    const results = await host.get(`/api/competitions/${id}/results`);
    expect(results.body.students).toEqual([]);
    expect(results.body.summary).toMatchObject({ participants: 0, averageScore: null, highestScore: null });
    const xlsx = await binary(host.get(`/api/competitions/${id}/export.xlsx`));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body as ArrayBuffer);
    expect(workbook.worksheets).toHaveLength(6);
    expect(workbook.getWorksheet('Leaderboard')!.actualRowCount).toBe(1);
    const csv = await host.get(`/api/competitions/${id}/export.csv`);
    expect(csv.text.trim().split('\r\n')).toHaveLength(1);
  });
});

describe('spreadsheet safety', () => {
  it.each(['=1+1', '+1', '-1+2', '@SUM(A1)', '\tx', '\rx'])('neutralizes %j', (value) => {
    expect(neutralizeFormula(value).startsWith("'")).toBe(true);
  });
  it('leaves normal text alone', () => {
    expect(neutralizeFormula('Algebra')).toBe('Algebra');
  });
});
