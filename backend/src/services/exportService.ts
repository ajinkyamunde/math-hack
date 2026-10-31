import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { DIFFICULTIES, type Difficulty } from '../types/domain.js';
import { safeCell, toCsv, type CellValue } from '../utils/spreadsheetSafety.js';
import { safeFilenamePart } from '../utils/text.js';
import type { CompetitionAnalytics, StudentResult } from './analyticsService.js';
import { badRequest, notFound } from '../utils/errors.js';

export const CSV_EXPORT_TYPES = ['results', 'students', 'questions', 'difficulty', 'attempts'] as const;
export type CsvExportType = (typeof CSV_EXPORT_TYPES)[number];

const NA = 'N/A';
/** Milliseconds to seconds with two decimals; missing averages become N/A, never 0. */
const seconds = (ms: number | null | undefined): number | string => (ms === null || ms === undefined ? NA : Math.round(ms / 10) / 100);
const percent = (ratio: number | null): number | string => (ratio === null ? NA : Math.round(ratio * 10000) / 100);
const titleCase = (d: Difficulty) => d.charAt(0) + d.slice(1).toLowerCase();

export function exportFilename(analytics: CompetitionAnalytics, kind: string, extension: 'xlsx' | 'csv', date = new Date()): string {
  const { competition } = analytics;
  return `mathhack-${safeFilenamePart(competition.name)}-${String(competition._id).slice(-6)}-${kind}-${date.toISOString().slice(0, 10)}.${extension}`;
}

interface Table {
  headers: string[];
  rows: CellValue[][];
}

export function leaderboardTable(a: CompetitionAnalytics): Table {
  return {
    headers: ['Rank', 'PRN', 'Student Name', 'Department', 'Total Score', 'Correct Answers', 'Incorrect Answers', 'Accuracy (%)', 'Average Response Time (s)'],
    rows: a.students.map((s) => [s.rank, s.prn, s.name, s.department, s.totalPoints, s.correct, s.incorrect, percent(s.accuracy), seconds(s.avgResponseMs)]),
  };
}

export function studentsTable(a: CompetitionAnalytics): Table {
  return {
    headers: [
      'Rank', 'PRN', 'Student Name', 'Department', 'Total Score', 'Questions Attempted', 'Correct Answers', 'Incorrect Answers',
      'Unanswered Questions', 'Accuracy (%)', 'Avg Easy Response (s)', 'Avg Medium Response (s)', 'Avg Hard Response (s)', 'Avg Correct Response (s)',
    ],
    rows: a.students.map((s) => [
      s.rank, s.prn, s.name, s.department, s.totalPoints, s.attempted, s.correct, s.incorrect, s.unanswered, percent(s.accuracy),
      seconds(s.byDifficulty.EASY.avgResponseMs), seconds(s.byDifficulty.MEDIUM.avgResponseMs), seconds(s.byDifficulty.HARD.avgResponseMs),
      seconds(s.avgCorrectResponseMs),
    ]),
  };
}

const DIFFICULTY_HEADERS = ['PRN', 'Student Name', 'Questions Attempted', 'Correct Answers', 'Incorrect Answers', 'Average Response Time (s)', 'Average Correct Response Time (s)'];

export function difficultySheetTable(a: CompetitionAnalytics, difficulty: Difficulty): Table {
  return {
    headers: DIFFICULTY_HEADERS,
    rows: a.students.map((s) => {
      const d = s.byDifficulty[difficulty];
      return [s.prn, s.name, d.attempted, d.correct, d.incorrect, seconds(d.avgResponseMs), seconds(d.avgCorrectResponseMs)];
    }),
  };
}

export function difficultyCsvTable(a: CompetitionAnalytics): Table {
  return {
    headers: ['Difficulty', ...DIFFICULTY_HEADERS],
    rows: DIFFICULTIES.flatMap((difficulty) => difficultySheetTable(a, difficulty).rows.map((row) => [difficulty, ...row])),
  };
}

export function questionsTable(a: CompetitionAnalytics): Table {
  return {
    headers: ['Question ID', 'Position', 'Question', 'Difficulty', 'Correct Option', 'Submissions', 'Correct Responses', 'Incorrect Responses', 'Timeout Count', 'Accuracy (%)', 'Average Response Time (s)'],
    rows: a.questions.map((q) => [q.questionId, q.position, q.questionText, q.difficulty, q.correctOption, q.submissions, q.correct, q.incorrect, q.timeouts, percent(q.accuracy), seconds(q.avgResponseMs)]),
  };
}

export function attemptsTable(a: CompetitionAnalytics): Table {
  const prnById = new Map(a.students.map((s) => [s.studentId, s.prn]));
  return {
    headers: ['PRN', 'Question ID', 'Difficulty', 'Selected Option', 'Correctness', 'Response Time (s)', 'Points Awarded', 'Submission Timestamp'],
    rows: a.attempts
      .filter((attempt) => prnById.has(attempt.studentId))
      .map((attempt) => [
        prnById.get(attempt.studentId),
        attempt.questionId,
        attempt.difficulty,
        attempt.selectedOption ?? (attempt.timedOut ? 'TIMED OUT' : NA),
        attempt.timedOut ? 'UNANSWERED' : attempt.isCorrect ? 'CORRECT' : 'INCORRECT',
        seconds(attempt.responseTimeMs),
        attempt.pointsAwarded,
        attempt.submittedAt ? attempt.submittedAt.toISOString() : NA,
      ]),
  };
}

export function csvExport(a: CompetitionAnalytics, type: CsvExportType): string {
  const table = {
    results: leaderboardTable,
    students: studentsTable,
    questions: questionsTable,
    difficulty: difficultyCsvTable,
    attempts: attemptsTable,
  }[type](a);
  return toCsv(table.headers, table.rows);
}

export function studentReportCsv(a: CompetitionAnalytics, studentId: string, hideRank = false): string {
  const student = a.students.find((s) => s.studentId === studentId);
  if (!student) throw notFound('Participant');
  return toCsv(['Field', 'Value'], studentReportRows(a, student, hideRank));
}

function studentReportRows(a: CompetitionAnalytics, s: StudentResult, hideRank = false): CellValue[][] {
  const rows: CellValue[][] = [
    ['Competition', a.competition.name],
    ['PRN', s.prn],
    ['Student Name', s.name],
    ['Department', s.department],
    ...(hideRank ? [] : [['Final Rank', s.rank]]),
    ['Total Score', s.totalPoints],
    ['Questions Attempted', s.attempted],
    ['Correct Answers', s.correct],
    ['Incorrect Answers', s.incorrect],
    ['Unanswered Questions', s.unanswered],
    ['Accuracy (%)', percent(s.accuracy)],
    ['Average Correct Response (s)', seconds(s.avgCorrectResponseMs)],
  ];
  for (const d of DIFFICULTIES) {
    const stats = s.byDifficulty[d];
    rows.push([`${titleCase(d)}: attempted / correct`, `${stats.attempted} / ${stats.correct}`]);
    rows.push([`${titleCase(d)}: average response (s)`, seconds(stats.avgResponseMs)]);
  }
  const questionText = new Map(a.questions.map((q) => [q.questionId, q]));
  a.attempts
    .filter((attempt) => attempt.studentId === s.studentId)
    .forEach((attempt) => {
      const q = questionText.get(attempt.questionId);
      rows.push([
        `Q${q?.position ?? '?'} (${attempt.difficulty})`,
        attempt.timedOut ? 'Unanswered' : `${attempt.selectedOption} — ${attempt.isCorrect ? 'correct' : 'incorrect'} — ${seconds(attempt.responseTimeMs)} s — ${attempt.pointsAwarded} pts`,
      ]);
    });
  return rows;
}

function addSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, name: string, table: Table): void {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = table.headers.map((header) => ({ header, key: header, width: Math.max(12, Math.min(48, header.length + 4)) }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).commit();
  for (const row of table.rows) sheet.addRow(row.map((cell) => safeCell(cell))).commit();
  sheet.commit();
}

export const WORKBOOK_SHEETS = ['Leaderboard', 'Easy Analytics', 'Medium Analytics', 'Hard Analytics', 'Question Statistics', 'All Attempts'] as const;

/** Streams the six-sheet results workbook straight to the response; rows are committed as written to bound memory. */
export async function writeResultsWorkbook(a: CompetitionAnalytics, stream: Writable): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  workbook.creator = 'MathHack';
  workbook.created = new Date();
  addSheet(workbook, 'Leaderboard', leaderboardTable(a));
  for (const d of DIFFICULTIES) addSheet(workbook, `${titleCase(d)} Analytics`, difficultySheetTable(a, d));
  addSheet(workbook, 'Question Statistics', questionsTable(a));
  addSheet(workbook, 'All Attempts', attemptsTable(a));
  await workbook.commit();
}

export function parseCsvType(value: unknown): CsvExportType {
  const type = (value ?? 'results') as CsvExportType;
  if (!CSV_EXPORT_TYPES.includes(type)) throw badRequest(`Export type must be one of: ${CSV_EXPORT_TYPES.join(', ')}.`);
  return type;
}
