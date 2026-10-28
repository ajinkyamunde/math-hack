/**
 * Participant dashboard tests that need no database: the status mapping, the real Excel workbook, and the HTTP
 * routes with only the data layer stubbed, so the real session, origin, role and competition-ownership checks run.
 * The database-backed end-to-end versions live in participants.test.ts.
 */
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { ParticipantView } from '../src/services/participantService.js';

vi.mock('../src/services/authService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/authService.js')>();
  // Sessions are still issued and verified for real; only the "account still exists" lookup is stubbed.
  return { ...actual, loadActiveAccount: vi.fn(async () => ({ accountStatus: 'ACTIVE' })) };
});

vi.mock('../src/services/participantService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/participantService.js')>();
  return { ...actual, buildParticipantView: vi.fn() };
});

vi.mock('../src/services/auditService.js', () => ({ recordAudit: vi.fn(async () => undefined) }));

const { createApp } = await import('../src/app.js');
const { recordAudit } = await import('../src/services/auditService.js');
const { issueSession, SESSION_COOKIE } = await import('../src/services/authService.js');
const participantService = await import('../src/services/participantService.js');
const { Competition } = await import('../src/models/Competition.js');
const { Host } = await import('../src/models/Host.js');
const { participantStatus, buildParticipantWorkbook, inTimeZone, PARTICIPANT_EXPORT_HEADERS } = participantService;

const ORIGIN = 'http://localhost:5173';
const competitionId = new Types.ObjectId().toHexString();
const ownerId = new Types.ObjectId().toHexString();
const otherHostId = new Types.ObjectId().toHexString();
const studentId = new Types.ObjectId().toHexString();

const view: ParticipantView = {
  competition: {
    id: competitionId,
    name: 'Endgame Cup',
    status: 'COMPLETED',
    durationSeconds: 1800,
    questionCount: 3,
    startedAt: new Date('2026-10-28T09:00:00Z'),
    endsAt: new Date('2026-10-28T09:30:00Z'),
    completedAt: new Date('2026-10-28T09:28:00Z'),
  },
  rows: [
    {
      studentId,
      name: '=HYPERLINK("http://evil")',
      email: 'aaiman@gmail.com',
      prn: 'PRN0001',
      department: 'Computer Engineering',
      academicYear: 'SE',
      status: 'COMPLETED',
      online: false,
      registeredAt: new Date('2026-10-20T10:00:00Z'),
      joinedAt: new Date('2026-10-28T08:55:00Z'),
      lastSeenAt: new Date('2026-10-28T09:28:00Z'),
      rank: 1,
      totalPoints: 60,
      correct: 3,
      answered: 3,
      accuracy: 1,
      avgCorrectResponseMs: 12345,
      completedAt: new Date('2026-10-28T09:28:00Z'),
    },
    {
      studentId: new Types.ObjectId().toHexString(),
      name: 'Riya Patil',
      email: 'riya@gmail.com',
      prn: 'PRN0002',
      department: 'Mechanical',
      academicYear: 'TE',
      status: 'REGISTERED',
      online: false,
      registeredAt: new Date('2026-10-21T10:00:00Z'),
      joinedAt: null,
      lastSeenAt: null,
      rank: null,
      totalPoints: null,
      correct: null,
      answered: null,
      accuracy: null,
      avgCorrectResponseMs: null,
      completedAt: null,
    },
  ],
  counts: { REGISTERED: 1, JOINED: 0, PLAYING: 0, DISCONNECTED: 0, COMPLETED: 1, CANCELLED: 0, total: 2 },
  departments: ['Computer Engineering', 'Mechanical'],
  generatedAt: new Date('2026-10-28T10:00:00Z'),
};

async function readWorkbook(buffer: Buffer | ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  return workbook;
}

const cookieFor = (id: string, role: 'host' | 'student') => `${SESSION_COOKIE}=${issueSession({ id, role }).token}`;

const binary = (test: request.Test) =>
  test.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('participantStatus', () => {
  it('maps the existing game state onto participant statuses', () => {
    const seen = { lastSeenAt: new Date() };
    const neverConnected = { lastSeenAt: null };
    expect(participantStatus('RUNNING', null, false)).toBe('REGISTERED');
    expect(participantStatus('WAITING', neverConnected, false)).toBe('JOINED');
    expect(participantStatus('WAITING', seen, true)).toBe('JOINED');
    expect(participantStatus('WAITING', seen, false)).toBe('DISCONNECTED');
    expect(participantStatus('RUNNING', seen, true)).toBe('PLAYING');
    expect(participantStatus('PAUSED', seen, true)).toBe('PLAYING');
    expect(participantStatus('RUNNING', seen, false)).toBe('DISCONNECTED');
    expect(participantStatus('RUNNING', neverConnected, false)).toBe('JOINED');
    expect(participantStatus('COMPLETED', seen, false)).toBe('COMPLETED');
    expect(participantStatus('CANCELLED', seen, false)).toBe('CANCELLED');
  });
});

describe('participant Excel workbook', () => {
  it('writes times as wall-clock time in the requested zone and says which zone', async () => {
    expect(inTimeZone(new Date('2026-10-28T07:29:50Z'), 'Asia/Kolkata')).toEqual(new Date('2026-10-28T12:59:50Z'));
    expect(inTimeZone(new Date('2026-10-28T07:29:50Z'))).toEqual(new Date('2026-10-28T07:29:50Z'));
    expect(inTimeZone(null, 'Asia/Kolkata')).toBeNull();

    const buffer = await buildParticipantWorkbook(view, { includeRegistered: false, tz: 'Asia/Kolkata' }, 'host@college.edu').xlsx.writeBuffer();
    const workbook = await readWorkbook(buffer);
    const col = PARTICIPANT_EXPORT_HEADERS.indexOf('Completed At') + 1;
    // 09:28 UTC is 14:58 in India.
    expect(workbook.getWorksheet('Participants')!.getRow(2).getCell(col).value).toEqual(new Date('2026-10-28T14:58:00Z'));
    const details = new Map<string, unknown>();
    workbook.getWorksheet('Competition')!.eachRow((row) => details.set(String(row.getCell(1).value), row.getCell(2).value));
    expect(details.get('Time zone of all times')).toBe('Asia/Kolkata');
  });


  it('is a genuine, editable .xlsx with every requested column and formula-safe text', async () => {
    const buffer = await buildParticipantWorkbook(view, { includeRegistered: true }, 'host@college.edu').xlsx.writeBuffer();
    const workbook = await readWorkbook(buffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Participants', 'Competition']);

    const sheet = workbook.getWorksheet('Participants')!;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual([...PARTICIPANT_EXPORT_HEADERS]);
    for (const required of ['Name', 'Email', 'Department', 'Year of Study', 'Status', 'Score', 'Completed At', 'Competition', 'Competition Status']) {
      expect(headers).toContain(required);
    }
    expect(sheet.rowCount).toBe(3);

    const col = (name: string) => PARTICIPANT_EXPORT_HEADERS.indexOf(name as (typeof PARTICIPANT_EXPORT_HEADERS)[number]) + 1;
    const first = sheet.getRow(2);
    expect(first.getCell(col('Name')).value).toBe('\'=HYPERLINK("http://evil")');
    expect(first.getCell(col('Email')).value).toBe('aaiman@gmail.com');
    expect(first.getCell(col('Year of Study')).value).toBe('SE');
    expect(first.getCell(col('Score')).value).toBe(60);
    expect(first.getCell(col('Accuracy (%)')).value).toBe(100);
    expect(first.getCell(col('Avg Correct Response (s)')).value).toBe(12.35);
    expect(first.getCell(col('Completed At')).value).toEqual(new Date('2026-10-28T09:28:00Z'));
    expect(first.getCell(col('Competition')).value).toBe('Endgame Cup');
    expect(first.getCell(col('Competition Status')).value).toBe('COMPLETED');

    const second = sheet.getRow(3);
    expect(second.getCell(col('Status')).value).toBe('REGISTERED');
    expect(second.getCell(col('Score')).value).toBeNull();

    // No sheet protection: the host can edit the file freely.
    expect((sheet as unknown as { sheetProtection?: unknown }).sheetProtection).toBeFalsy();

    const details = workbook.getWorksheet('Competition')!;
    const detailValues = new Map<string, unknown>();
    details.eachRow((row, n) => n > 1 && detailValues.set(String(row.getCell(1).value), row.getCell(2).value));
    expect(detailValues.get('Competition')).toBe('Endgame Cup');
    expect(detailValues.get('Exported By')).toBe('host@college.edu');
    expect(String(detailValues.get('Filters applied'))).toContain('including registered');
  });
});

describe('participant routes (data layer stubbed)', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubCompetitionOwner(createdBy: string | null) {
    vi.spyOn(Competition, 'findById').mockReturnValue({
      select: () => ({ lean: async () => (createdBy === null ? null : { createdBy: new Types.ObjectId(createdBy) }) }),
    } as never);
  }

  function stubData() {
    vi.mocked(participantService.buildParticipantView).mockResolvedValue(view);
    vi.spyOn(Host, 'findById').mockReturnValue({ select: () => ({ lean: async () => ({ email: 'owner@college.edu' }) }) } as never);
  }

  const list = `/api/competitions/${competitionId}/participants`;
  const exportUrl = `/api/competitions/${competitionId}/participants/export.xlsx`;

  it('rejects requests without a session', async () => {
    stubData();
    for (const url of [list, exportUrl]) {
      const res = await request(app).get(url).set('Origin', ORIGIN);
      expect(res.status).toBe(401);
    }
    expect(participantService.buildParticipantView).not.toHaveBeenCalled();
  });

  it('denies students, even with a valid session', async () => {
    stubCompetitionOwner(ownerId);
    stubData();
    for (const url of [list, exportUrl]) {
      const res = await request(app).get(url).set('Origin', ORIGIN).set('Cookie', cookieFor(studentId, 'student'));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(participantService.buildParticipantView).not.toHaveBeenCalled();
  });

  it('denies a host who did not create the competition', async () => {
    stubCompetitionOwner(ownerId);
    stubData();
    for (const url of [list, exportUrl]) {
      const res = await request(app).get(url).set('Origin', ORIGIN).set('Cookie', cookieFor(otherHostId, 'host'));
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/created this competition/);
    }
    expect(participantService.buildParticipantView).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown competition and 400 for a malformed id or filter', async () => {
    stubCompetitionOwner(null);
    stubData();
    const host = cookieFor(ownerId, 'host');
    expect((await request(app).get(list).set('Origin', ORIGIN).set('Cookie', host)).status).toBe(404);
    expect((await request(app).get('/api/competitions/not-an-id/participants').set('Origin', ORIGIN).set('Cookie', host)).status).toBe(400);
    expect((await request(app).get(`${list}?status=HACKED`).set('Origin', ORIGIN).set('Cookie', host)).status).toBe(400);
    expect((await request(app).get(`${exportUrl}?tz=Not/AZone`).set('Origin', ORIGIN).set('Cookie', host)).status).toBe(400);
  });

  it('lets the owning host list participants with validated filters', async () => {
    stubCompetitionOwner(ownerId);
    stubData();
    const res = await request(app)
      .get(`${list}?search=%20aaiman%20&status=COMPLETED&academicYear=SE&includeRegistered=true`)
      .set('Origin', ORIGIN)
      .set('Cookie', cookieFor(ownerId, 'host'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows[0].email).toBe('aaiman@gmail.com');
    expect(participantService.buildParticipantView).toHaveBeenCalledWith(competitionId, {
      search: 'aaiman',
      status: 'COMPLETED',
      academicYear: 'SE',
      department: undefined,
      includeRegistered: true,
    });
  });

  it('lets the owning host download a real .xlsx file', async () => {
    stubCompetitionOwner(ownerId);
    stubData();
    const res = await binary(request(app).get(exportUrl).set('Origin', ORIGIN).set('Cookie', cookieFor(ownerId, 'host')));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="mathhack-Endgame-Cup-.*-participants-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const workbook = await readWorkbook(res.body as Buffer);
    const sheet = workbook.getWorksheet('Participants')!;
    expect(sheet.getRow(2).getCell(2).value).toBe('aaiman@gmail.com');
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ actorId: ownerId, action: 'participants.export', competitionId }));
  });

  it('applies the same ownership rule to the existing results exports and host leaderboard', async () => {
    stubCompetitionOwner(ownerId);
    const other = cookieFor(otherHostId, 'host');
    for (const path of ['leaderboard', 'results', 'analytics', 'export.xlsx', 'export.csv', `students/${studentId}/report.csv`]) {
      const res = await request(app).get(`/api/competitions/${competitionId}/${path}`).set('Origin', ORIGIN).set('Cookie', other);
      expect(res.status, path).toBe(403);
    }
  });

  it('rejects state-changing requests from other *.vercel.app sites even with a valid session and CSRF token', async () => {
    const session = issueSession({ id: ownerId, role: 'host' });
    const res = await request(app)
      .post(`/api/competitions/${competitionId}/end`)
      .set('Origin', 'https://attacker.vercel.app')
      .set('Cookie', `${SESSION_COOKIE}=${session.token}`)
      .set('X-CSRF-Token', session.csrfToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('blocks other origins, including other *.vercel.app sites, from reading participant data', async () => {
    stubCompetitionOwner(ownerId);
    stubData();
    for (const origin of ['https://evil.example', 'https://attacker.vercel.app']) {
      const res = await request(app).get(list).set('Origin', origin).set('Cookie', cookieFor(ownerId, 'host'));
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
    const ok = await request(app).get(list).set('Origin', ORIGIN).set('Cookie', cookieFor(ownerId, 'host'));
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
  });
});
