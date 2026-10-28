import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { Types } from 'mongoose';
import { Competition, type CompetitionLean } from '../models/Competition.js';
import { Participant } from '../models/Participant.js';
import { Student } from '../models/Student.js';
import { broadcaster } from '../sockets/broadcaster.js';
import type { CompetitionStatus } from '../types/domain.js';
import { notFound } from '../utils/errors.js';
import { safeCell, type CellValue } from '../utils/spreadsheetSafety.js';
import { safeFilenamePart } from '../utils/text.js';
import { PARTICIPANT_STATUSES, type ParticipantQuery, type ParticipantStatus } from '../validation/participantSchemas.js';
import { computeLeaderboard } from './leaderboardService.js';

export interface ParticipantRow {
  studentId: string;
  name: string;
  email: string;
  prn: string;
  department: string;
  academicYear: string;
  status: ParticipantStatus;
  /** Has at least one live socket in this competition right now (only meaningful while it is open or running). */
  online: boolean;
  registeredAt: Date | null;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
  rank: number | null;
  totalPoints: number | null;
  correct: number | null;
  answered: number | null;
  accuracy: number | null;
  avgCorrectResponseMs: number | null;
  completedAt: Date | null;
}

export interface CompetitionDetails {
  id: string;
  name: string;
  status: CompetitionStatus;
  durationSeconds: number;
  questionCount: number;
  startedAt: Date | null;
  endsAt: Date | null;
  completedAt: Date | null;
}

export interface ParticipantView {
  competition: CompetitionDetails;
  rows: ParticipantRow[];
  /** Counts by status before search and filters, for the summary cards. */
  counts: Record<ParticipantStatus, number> & { total: number };
  departments: string[];
  generatedAt: Date;
}

const LIVE_STATUSES: CompetitionStatus[] = ['WAITING', 'RUNNING', 'PAUSED'];

/**
 * Maps the existing game state onto a participant status. A student who joined from the dashboard but never opened
 * the arena has no socket history (no lastSeenAt), so they are JOINED rather than DISCONNECTED.
 */
export function participantStatus(
  competitionStatus: CompetitionStatus,
  participant: { lastSeenAt?: Date | null } | null,
  online: boolean,
): ParticipantStatus {
  if (!participant) return 'REGISTERED';
  if (competitionStatus === 'COMPLETED') return 'COMPLETED';
  if (competitionStatus === 'CANCELLED') return 'CANCELLED';
  const wasConnected = Boolean(participant.lastSeenAt);
  if (competitionStatus === 'RUNNING' || competitionStatus === 'PAUSED') {
    if (online) return 'PLAYING';
    return wasConnected ? 'DISCONNECTED' : 'JOINED';
  }
  // WAITING (a DRAFT competition cannot have participants).
  if (!online && wasConnected) return 'DISCONNECTED';
  return 'JOINED';
}

function competitionDetails(c: CompetitionLean): CompetitionDetails {
  return {
    id: String(c._id),
    name: c.name,
    status: c.status,
    durationSeconds: c.durationSeconds,
    questionCount: c.queue.length,
    startedAt: c.startedAt ?? null,
    endsAt: c.endsAt ?? null,
    completedAt: c.completedAt ?? null,
  };
}

function matches(row: ParticipantRow, query: ParticipantQuery): boolean {
  if (query.status && row.status !== query.status) return false;
  if (query.academicYear && row.academicYear !== query.academicYear) return false;
  if (query.department && row.department.toLowerCase() !== query.department.toLowerCase()) return false;
  if (query.search) {
    const needle = query.search.toLowerCase();
    const haystack = [row.name, row.email, row.prn, row.department].join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * Builds the host's participant list from real records: Participant rows for this competition, the students behind
 * them, live socket presence, and scores from the same leaderboard computation the game uses.
 * Callers must already have checked that the requesting host owns the competition.
 */
export async function buildParticipantView(competitionId: string, query: ParticipantQuery): Promise<ParticipantView> {
  if (!Types.ObjectId.isValid(competitionId)) throw notFound('Competition');
  const competition = await Competition.findById(competitionId).lean<CompetitionLean>();
  if (!competition) throw notFound('Competition');
  const id = competition._id;
  const includeRegistered = query.includeRegistered || query.status === 'REGISTERED';

  const [participants, leaderboard, connected] = await Promise.all([
    Participant.find({ competitionId: id }).lean(),
    computeLeaderboard(id),
    LIVE_STATUSES.includes(competition.status) ? broadcaster().connectedStudentIds(String(id)) : Promise.resolve([] as string[]),
  ]);
  const joinedIds = participants.map((p) => p.studentId);
  const students = await Student.find(includeRegistered ? {} : { _id: { $in: joinedIds } })
    .select('name email prn department academicYear createdAt')
    .lean<{ _id: Types.ObjectId; name: string; email: string; prn: string; department: string; academicYear: string; createdAt?: Date }[]>();

  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const scoreById = new Map(leaderboard.map((entry) => [entry.studentId, entry]));
  const online = new Set(connected);
  const rows: ParticipantRow[] = [];

  for (const participant of participants) {
    const studentId = String(participant.studentId);
    const student = studentById.get(studentId);
    if (!student) continue; // The account was deleted; there is nothing to show.
    const isOnline = online.has(studentId);
    const score = scoreById.get(studentId);
    const status = participantStatus(competition.status, participant, isOnline);
    rows.push({
      studentId,
      name: student.name,
      email: student.email,
      prn: student.prn,
      department: student.department,
      academicYear: student.academicYear,
      status,
      online: isOnline,
      registeredAt: student.createdAt ?? null,
      joinedAt: participant.joinedAt ?? null,
      lastSeenAt: participant.lastSeenAt ?? null,
      rank: score?.rank ?? participant.finalRank ?? null,
      totalPoints: score?.totalPoints ?? participant.finalScore ?? null,
      correct: score?.correct ?? null,
      answered: score?.answered ?? null,
      accuracy: score?.accuracy ?? null,
      avgCorrectResponseMs: score?.avgCorrectResponseMs ?? null,
      completedAt: status === 'COMPLETED' ? (participant.completedAt ?? competition.completedAt ?? null) : null,
    });
  }

  if (includeRegistered) {
    const joined = new Set(joinedIds.map(String));
    for (const student of students) {
      if (joined.has(String(student._id))) continue;
      rows.push({
        studentId: String(student._id),
        name: student.name,
        email: student.email,
        prn: student.prn,
        department: student.department,
        academicYear: student.academicYear,
        status: 'REGISTERED',
        online: false,
        registeredAt: student.createdAt ?? null,
        joinedAt: null,
        lastSeenAt: null,
        rank: null,
        totalPoints: null,
        correct: null,
        answered: null,
        accuracy: null,
        avgCorrectResponseMs: null,
        completedAt: null,
      });
    }
  }

  // Ranked participants first (by rank), then everyone else by name.
  rows.sort((a, b) => {
    if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
    if (a.rank !== null && b.rank === null) return -1;
    if (a.rank === null && b.rank !== null) return 1;
    return a.name.localeCompare(b.name) || a.prn.localeCompare(b.prn);
  });

  const counts = Object.fromEntries(PARTICIPANT_STATUSES.map((s) => [s, 0])) as ParticipantView['counts'];
  for (const row of rows) counts[row.status] += 1;
  counts.total = rows.length;
  const departments = [...new Set(rows.map((row) => row.department))].sort((a, b) => a.localeCompare(b));

  return {
    competition: competitionDetails(competition),
    rows: rows.filter((row) => matches(row, query)),
    counts,
    departments,
    generatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------

export const PARTICIPANT_EXPORT_HEADERS = [
  'Name',
  'Email',
  'PRN',
  'Department',
  'Year of Study',
  'Status',
  'Connected Now',
  'Joined At',
  'Rank',
  'Score',
  'Correct Answers',
  'Questions Answered',
  'Accuracy (%)',
  'Avg Correct Response (s)',
  'Completed At',
  'Competition',
  'Competition Status',
] as const;

const DATE_FORMAT = 'yyyy-mm-dd hh:mm:ss';

/**
 * Excel dates carry no time zone, so a UTC instant would show 5.5 hours off for a host in India.
 * Convert to the wall-clock time in the host's zone and write that instead.
 */
export function inTimeZone(date: Date | null, timeZone = 'UTC'): Date | null {
  if (!date) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return new Date(Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!));
}
const DATE_COLUMNS = new Set(['Joined At', 'Completed At']);

export function participantExportRows(view: ParticipantView, timeZone = 'UTC'): CellValue[][] {
  return view.rows.map((row) => [
    row.name,
    row.email,
    row.prn,
    row.department,
    row.academicYear,
    row.status,
    row.online ? 'Yes' : 'No',
    inTimeZone(row.joinedAt, timeZone),
    row.rank,
    row.totalPoints,
    row.correct,
    row.answered,
    row.accuracy === null ? null : Math.round(row.accuracy * 10000) / 100,
    row.avgCorrectResponseMs === null ? null : Math.round(row.avgCorrectResponseMs / 10) / 100,
    inTimeZone(row.completedAt, timeZone),
    view.competition.name,
    view.competition.status,
  ]);
}

export function participantExportFilename(view: ParticipantView, date = new Date()): string {
  const { competition } = view;
  return `mathhack-${safeFilenamePart(competition.name)}-${competition.id.slice(-6)}-participants-${date.toISOString().slice(0, 10)}.xlsx`;
}

function describeFilters(query: ParticipantQuery): string {
  const parts = [
    query.search && `search "${query.search}"`,
    query.status && `status ${query.status}`,
    query.department && `department ${query.department}`,
    query.academicYear && `year ${query.academicYear}`,
    query.includeRegistered && 'including registered students who have not joined',
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : 'None (all joined participants)';
}

/**
 * Builds an ordinary, editable .xlsx workbook. It is a one-way snapshot: nothing reads it back, so editing the
 * downloaded file can never change the database.
 */
export function buildParticipantWorkbook(view: ParticipantView, query: ParticipantQuery, exportedBy: string): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MathHack';
  workbook.created = view.generatedAt;

  const sheet = workbook.addWorksheet('Participants', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = PARTICIPANT_EXPORT_HEADERS.map((header) => ({
    header,
    key: header,
    width: header === 'Email' ? 32 : header === 'Name' || header === 'Competition' ? 26 : Math.max(12, header.length + 4),
    style: DATE_COLUMNS.has(header) ? { numFmt: DATE_FORMAT } : {},
  }));
  sheet.getRow(1).font = { bold: true };
  const timeZone = query.tz ?? 'UTC';
  for (const row of participantExportRows(view, timeZone)) sheet.addRow(row.map((cell) => safeCell(cell)));
  if (view.rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: PARTICIPANT_EXPORT_HEADERS.length } };

  const details = workbook.addWorksheet('Competition');
  details.columns = [
    { header: 'Field', key: 'field', width: 26 },
    { header: 'Value', key: 'value', width: 48 },
  ];
  details.getRow(1).font = { bold: true };
  const { competition } = view;
  const detailRows: [string, CellValue][] = [
    ['Competition', competition.name],
    ['Competition ID', competition.id],
    ['Status', competition.status],
    ['Questions', competition.questionCount],
    ['Duration (minutes)', Math.round(competition.durationSeconds / 6) / 10],
    ['Started At', inTimeZone(competition.startedAt, timeZone)],
    ['Ends At', inTimeZone(competition.endsAt, timeZone)],
    ['Completed At', inTimeZone(competition.completedAt, timeZone)],
    ['Participants in this export', view.rows.length],
    ['Filters applied', describeFilters(query)],
    ['Exported At', inTimeZone(view.generatedAt, timeZone)],
    ['Time zone of all times', timeZone],
    ['Exported By', exportedBy],
    ['Note', 'Snapshot only. Editing this file does not change MathHack records.'],
  ];
  for (const [field, value] of detailRows) {
    const added = details.addRow([safeCell(field), safeCell(value)]);
    if (value instanceof Date) added.getCell(2).numFmt = DATE_FORMAT;
  }
  return workbook;
}

export async function writeParticipantWorkbook(view: ParticipantView, query: ParticipantQuery, exportedBy: string, stream: Writable): Promise<void> {
  await buildParticipantWorkbook(view, query, exportedBy).xlsx.write(stream);
}
