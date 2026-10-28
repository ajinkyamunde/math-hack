import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Attempt } from '../src/models/Attempt.js';
import { Competition } from '../src/models/Competition.js';
import { Participant } from '../src/models/Participant.js';
import { Student } from '../src/models/Student.js';
import { createHostAccount } from '../src/services/authService.js';
import { submitAnswer } from '../src/services/scoringService.js';
import { ORIGIN, createOpenCompetition, createQuestions, loginHost, registerStudent, useTestDatabase, type Client } from './helpers.js';

const getApp = useTestDatabase();

const binary = (test: request.Test) =>
  test.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

async function loginOtherHost(): Promise<Client> {
  const other = { name: 'Other Host', email: 'other-host@mathhack.test', password: 'OtherPassw0rd!' };
  await createHostAccount(other);
  const agent = request.agent(getApp());
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ role: 'host', ...other });
  expect(res.status).toBe(200);
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

interface Row {
  studentId: string;
  name: string;
  email: string;
  prn: string;
  department: string;
  academicYear: string;
  status: string;
  rank: number | null;
  totalPoints: number | null;
  completedAt: string | null;
}

/** Owner host, a two-question competition, two joined students and one who only registered. */
async function scenario() {
  const host = await loginHost(getApp());
  const [q1, q2] = await createQuestions(host, [{ correctOption: 'C', points: 10 }, { correctOption: 'A', points: 10 }]);
  const id = await createOpenCompetition(host, [q1!, q2!], { name: 'Participant Cup', questionProgressionMode: 'MANUAL' });
  const alice = await registerStudent(getApp(), { name: 'Alice Kale', email: 'alice@gmail.com', prn: 'PART000001', department: 'Computer Engineering', academicYear: 'SE' });
  const bob = await registerStudent(getApp(), { name: 'Bob Shah', email: 'bob@gmail.com', prn: 'PART000002', department: 'Mechanical', academicYear: 'TE' });
  const carol = await registerStudent(getApp(), { name: 'Carol Rao', email: 'carol@gmail.com', prn: 'PART000003', department: 'Civil', academicYear: 'FE' });
  await alice.post(`/api/competitions/${id}/join`).expect(200);
  await bob.post(`/api/competitions/${id}/join`).expect(200);
  return { host, id, q1: q1!, q2: q2!, alice, bob, carol };
}

const rowsOf = (res: request.Response) => res.body.rows as Row[];

describe('participant dashboard access control', () => {
  it('requires a session', async () => {
    const { id } = await scenario();
    expect((await request(getApp()).get(`/api/competitions/${id}/participants`).set('Origin', ORIGIN)).status).toBe(401);
    expect((await request(getApp()).get(`/api/competitions/${id}/participants/export.xlsx`).set('Origin', ORIGIN)).status).toBe(401);
  });

  it('denies students, including participants of that competition', async () => {
    const { id, alice, carol } = await scenario();
    for (const student of [alice, carol]) {
      expect((await student.get(`/api/competitions/${id}/participants`)).status).toBe(403);
      expect((await student.get(`/api/competitions/${id}/participants/export.xlsx`)).status).toBe(403);
      expect((await student.get(`/api/competitions/${id}/export.xlsx`)).status).toBe(403);
      expect((await student.get('/api/students')).status).toBe(403);
    }
  });

  it('denies a host who did not create the competition, on new and existing participant endpoints', async () => {
    const { id, alice } = await scenario();
    const other = await loginOtherHost();
    for (const path of [
      'participants',
      'participants/export.xlsx',
      'leaderboard',
      'results',
      'analytics',
      'export.xlsx',
      'export.csv',
      `students/${alice.user._id}/report.csv`,
    ]) {
      const res = await other.get(`/api/competitions/${id}/${path}`);
      expect(res.status, path).toBe(403);
    }
  });

  it('lets a second host see only the competitions they created', async () => {
    const { id: ownersCompetition } = await scenario();
    const other = await loginOtherHost();
    const [q] = await createQuestions(other, [{}]);
    const created = await other.post('/api/competitions', { name: 'Other Cup', questionIds: [q] });
    const otherCompetition = created.body.competition.id as string;
    expect((await other.get(`/api/competitions/${otherCompetition}/participants`)).status).toBe(200);
    expect((await other.get(`/api/competitions/${ownersCompetition}/participants`)).status).toBe(403);
  });

  it('keeps the existing student views free of other participants\' private details', async () => {
    const { host, id, alice } = await scenario();
    await host.post(`/api/competitions/${id}/start`);
    await host.post(`/api/competitions/${id}/end`);
    for (const path of ['leaderboard', 'results']) {
      const res = await alice.get(`/api/competitions/${id}/${path}`);
      expect(res.status, path).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('bob@gmail.com');
      expect(body).not.toContain('PART000002');
    }
  });
});

describe('participant dashboard data', () => {
  it('lists real joined participants with details and statuses', async () => {
    const { host, id } = await scenario();
    const res = await host.get(`/api/competitions/${id}/participants`);
    expect(res.status).toBe(200);
    expect(res.body.competition).toMatchObject({ id, name: 'Participant Cup', status: 'WAITING', questionCount: 2 });
    const rows = rowsOf(res);
    expect(rows.map((r) => r.email).sort()).toEqual(['alice@gmail.com', 'bob@gmail.com']);
    expect(rows.find((r) => r.email === 'bob@gmail.com')).toMatchObject({
      name: 'Bob Shah',
      prn: 'PART000002',
      department: 'Mechanical',
      academicYear: 'TE',
      status: 'JOINED',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|emailVerificationTokenHash/);
    expect(res.body.counts).toMatchObject({ JOINED: 2, total: 2 });
  });

  it('can include registered students who have not joined', async () => {
    const { host, id } = await scenario();
    const all = rowsOf(await host.get(`/api/competitions/${id}/participants?includeRegistered=true`));
    expect(all).toHaveLength(3);
    expect(all.find((r) => r.email === 'carol@gmail.com')?.status).toBe('REGISTERED');
    const onlyRegistered = rowsOf(await host.get(`/api/competitions/${id}/participants?status=REGISTERED`));
    expect(onlyRegistered.map((r) => r.email)).toEqual(['carol@gmail.com']);
  });

  it('filters by search, department and year', async () => {
    const { host, id } = await scenario();
    const get = async (qs: string) => rowsOf(await host.get(`/api/competitions/${id}/participants?${qs}`)).map((r) => r.email);
    expect(await get('search=ALICE')).toEqual(['alice@gmail.com']);
    expect(await get('search=PART000002')).toEqual(['bob@gmail.com']);
    expect(await get('department=mechanical')).toEqual(['bob@gmail.com']);
    expect(await get('academicYear=SE')).toEqual(['alice@gmail.com']);
    expect(await get('search=nobody-here')).toEqual([]);
    expect((await host.get(`/api/competitions/${id}/participants?academicYear=XX`)).status).toBe(400);
  });

  it('shows scores, ranks, disconnects and completion times from the game', async () => {
    const { host, id, q1, alice, bob } = await scenario();
    await host.post(`/api/competitions/${id}/start`);
    await host.post(`/api/competitions/${id}/publish`);
    const c = await Competition.findById(id).lean();
    await submitAnswer({ competitionId: id, studentId: alice.user._id, questionId: q1, selectedOption: 'C', receivedAt: new Date(c!.currentQuestionStartedAt!.getTime() + 3000) });
    // Bob opened the arena earlier and has since dropped off.
    await Participant.updateOne({ competitionId: id, studentId: bob.user._id }, { $set: { lastSeenAt: new Date(), connectionStatus: 'OFFLINE' } });

    let rows = rowsOf(await host.get(`/api/competitions/${id}/participants`));
    expect(rows.find((r) => r.email === 'bob@gmail.com')?.status).toBe('DISCONNECTED');
    expect(rows[0]).toMatchObject({ email: 'alice@gmail.com', rank: 1, totalPoints: 10 });

    await host.post(`/api/competitions/${id}/end`);
    rows = rowsOf(await host.get(`/api/competitions/${id}/participants`));
    expect(rows.every((r) => r.status === 'COMPLETED')).toBe(true);
    expect(rows.every((r) => r.completedAt)).toBe(true);
    expect(rows.find((r) => r.email === 'bob@gmail.com')).toMatchObject({ totalPoints: 0, rank: 2 });
  });

  it('drops participants whose student account was deleted', async () => {
    const { host, id, bob } = await scenario();
    await Student.deleteOne({ _id: bob.user._id });
    const rows = rowsOf(await host.get(`/api/competitions/${id}/participants`));
    expect(rows.map((r) => r.email)).toEqual(['alice@gmail.com']);
  });
});

describe('participant Excel export', () => {
  it('exports the authorized, filtered participant list as a real .xlsx and changes nothing in the database', async () => {
    const { host, id, q1, alice } = await scenario();
    await host.post(`/api/competitions/${id}/start`);
    await host.post(`/api/competitions/${id}/publish`);
    const c = await Competition.findById(id).lean();
    await submitAnswer({ competitionId: id, studentId: alice.user._id, questionId: q1, selectedOption: 'C', receivedAt: new Date(c!.currentQuestionStartedAt!.getTime() + 2000) });
    await host.post(`/api/competitions/${id}/end`);
    const before = { students: await Student.countDocuments(), participants: await Participant.find().lean(), attempts: await Attempt.countDocuments() };

    const res = await binary(host.get(`/api/competitions/${id}/participants/export.xlsx?includeRegistered=true`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/participants-\d{4}-\d{2}-\d{2}\.xlsx"$/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as ArrayBuffer);
    const sheet = workbook.getWorksheet('Participants')!;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1) as string[];
    const records = [] as Record<string, unknown>[];
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      records.push(Object.fromEntries(headers.map((h, i) => [h, row.getCell(i + 1).value])));
    });
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      Name: 'Alice Kale',
      Email: 'alice@gmail.com',
      Department: 'Computer Engineering',
      'Year of Study': 'SE',
      Status: 'COMPLETED',
      Rank: 1,
      Score: 10,
      Competition: 'Participant Cup',
      'Competition Status': 'COMPLETED',
    });
    expect(records[0]!['Completed At']).toBeInstanceOf(Date);
    expect(records.find((r) => r.Email === 'carol@gmail.com')?.Status).toBe('REGISTERED');

    // Filters apply to the export exactly as to the list.
    const filtered = await binary(host.get(`/api/competitions/${id}/participants/export.xlsx?search=bob`));
    const filteredBook = new ExcelJS.Workbook();
    await filteredBook.xlsx.load(filtered.body as ArrayBuffer);
    expect(filteredBook.getWorksheet('Participants')!.rowCount).toBe(2);

    // Exporting is read-only.
    expect(await Student.countDocuments()).toBe(before.students);
    expect(await Attempt.countDocuments()).toBe(before.attempts);
    expect(await Participant.find().lean()).toEqual(before.participants);
  });
});
