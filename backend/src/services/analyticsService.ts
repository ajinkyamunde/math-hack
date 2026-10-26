import { Types } from 'mongoose';
import { Attempt } from '../models/Attempt.js';
import type { CompetitionLean } from '../models/Competition.js';
import { DIFFICULTIES, type Difficulty } from '../types/domain.js';
import { loadCompetition } from './competitionService.js';
import { computeLeaderboard, type LeaderboardEntry } from './leaderboardService.js';

/** Average of a list, or null for an empty list: a missing average is never reported as 0. */
export function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface AttemptRow {
  studentId: string;
  questionId: string;
  difficulty: Difficulty;
  selectedOption: string | null;
  isCorrect: boolean;
  responseTimeMs: number | null;
  pointsAwarded: number;
  submittedAt: Date | null;
  timedOut: boolean;
}

export interface DifficultyStats {
  attempted: number;
  correct: number;
  incorrect: number;
  timedOut: number;
  avgResponseMs: number | null;
  avgCorrectResponseMs: number | null;
}

export interface StudentResult extends LeaderboardEntry {
  attempted: number;
  unanswered: number;
  avgResponseMs: number | null;
  byDifficulty: Record<Difficulty, DifficultyStats>;
}

export interface QuestionStats {
  questionId: string;
  position: number;
  questionText: string;
  difficulty: Difficulty;
  correctOption: string;
  submissions: number;
  correct: number;
  incorrect: number;
  timeouts: number;
  accuracy: number | null;
  avgResponseMs: number | null;
  optionCounts: Record<string, number>;
  closeReason: string | null;
}

/**
 * Accuracy = correct / answered. Timed-out (unanswered) questions are excluded from accuracy and from
 * every response-time average; they are counted separately as "unanswered".
 */
export function difficultyStats(attempts: AttemptRow[]): DifficultyStats {
  const answered = attempts.filter((a) => !a.timedOut);
  const correct = answered.filter((a) => a.isCorrect);
  return {
    attempted: answered.length,
    correct: correct.length,
    incorrect: answered.length - correct.length,
    timedOut: attempts.length - answered.length,
    avgResponseMs: average(answered.map((a) => a.responseTimeMs ?? 0)),
    avgCorrectResponseMs: average(correct.map((a) => a.responseTimeMs ?? 0)),
  };
}

export async function loadAttempts(competitionId: Types.ObjectId): Promise<AttemptRow[]> {
  const rows = await Attempt.find({ competitionId })
    .select('studentId questionId difficulty selectedOption isCorrect responseTimeMs pointsAwarded submittedAt timedOut')
    .sort({ submittedAt: 1, _id: 1 })
    .lean();
  return rows.map((row) => ({
    studentId: String(row.studentId),
    questionId: String(row.questionId),
    difficulty: row.difficulty as Difficulty,
    selectedOption: row.selectedOption ?? null,
    isCorrect: row.isCorrect,
    responseTimeMs: row.responseTimeMs ?? null,
    pointsAwarded: row.pointsAwarded,
    submittedAt: row.submittedAt ?? null,
    timedOut: Boolean(row.timedOut),
  }));
}

export function publishedItems(competition: CompetitionLean) {
  return competition.queue
    .filter((item) => item.publishedAt && item.snapshot)
    .sort((a, b) => a.publishedAt!.getTime() - b.publishedAt!.getTime());
}

export function buildStudentResults(competition: CompetitionLean, leaderboard: LeaderboardEntry[], attempts: AttemptRow[]): StudentResult[] {
  const published = publishedItems(competition);
  const byStudent = new Map<string, AttemptRow[]>();
  attempts.forEach((attempt) => {
    const list = byStudent.get(attempt.studentId) ?? [];
    list.push(attempt);
    byStudent.set(attempt.studentId, list);
  });
  return leaderboard.map((entry) => {
    const mine = byStudent.get(entry.studentId) ?? [];
    const answered = mine.filter((a) => !a.timedOut);
    const byDifficulty = Object.fromEntries(
      DIFFICULTIES.map((difficulty) => [difficulty, difficultyStats(mine.filter((a) => a.difficulty === difficulty))]),
    ) as Record<Difficulty, DifficultyStats>;
    return {
      ...entry,
      attempted: answered.length,
      unanswered: Math.max(0, published.length - answered.length),
      avgResponseMs: average(answered.map((a) => a.responseTimeMs ?? 0)),
      byDifficulty,
    };
  });
}

export function buildQuestionStats(competition: CompetitionLean, attempts: AttemptRow[]): QuestionStats[] {
  return publishedItems(competition).map((item, index) => {
    const mine = attempts.filter((a) => a.questionId === String(item.questionId));
    const stats = difficultyStats(mine);
    const optionCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    mine.forEach((a) => {
      if (a.selectedOption) optionCounts[a.selectedOption] = (optionCounts[a.selectedOption] ?? 0) + 1;
    });
    return {
      questionId: String(item.questionId),
      position: index + 1,
      questionText: item.snapshot!.questionText,
      difficulty: item.snapshot!.difficulty as Difficulty,
      correctOption: item.snapshot!.correctOption,
      submissions: stats.attempted,
      correct: stats.correct,
      incorrect: stats.incorrect,
      timeouts: stats.timedOut,
      accuracy: stats.attempted ? stats.correct / stats.attempted : null,
      avgResponseMs: stats.avgResponseMs,
      optionCounts,
      closeReason: item.closeReason ?? null,
    };
  });
}

export function buildDifficultySummary(attempts: AttemptRow[]) {
  return DIFFICULTIES.map((difficulty) => {
    const stats = difficultyStats(attempts.filter((a) => a.difficulty === difficulty));
    return { difficulty, ...stats, accuracy: stats.attempted ? stats.correct / stats.attempted : null };
  });
}

export interface CompetitionAnalytics {
  competition: CompetitionLean;
  leaderboard: LeaderboardEntry[];
  students: StudentResult[];
  questions: QuestionStats[];
  difficulty: ReturnType<typeof buildDifficultySummary>;
  attempts: AttemptRow[];
}

/** One consistent read of everything results and exports need, derived only from stored records. */
export async function buildCompetitionAnalytics(competitionId: string): Promise<CompetitionAnalytics> {
  const competition = await loadCompetition(competitionId);
  const [leaderboard, attempts] = await Promise.all([computeLeaderboard(competition._id), loadAttempts(competition._id)]);
  return {
    competition,
    leaderboard,
    students: buildStudentResults(competition, leaderboard, attempts),
    questions: buildQuestionStats(competition, attempts),
    difficulty: buildDifficultySummary(attempts),
    attempts,
  };
}

export function summarize(analytics: CompetitionAnalytics) {
  const { competition, students, attempts } = analytics;
  return {
    competitionId: String(competition._id),
    name: competition.name,
    status: competition.status,
    participants: students.length,
    questionsPublished: publishedItems(competition).length,
    totalSubmissions: attempts.filter((a) => !a.timedOut).length,
    averageScore: average(students.map((s) => s.totalPoints)),
    highestScore: students.length ? Math.max(...students.map((s) => s.totalPoints)) : null,
  };
}
