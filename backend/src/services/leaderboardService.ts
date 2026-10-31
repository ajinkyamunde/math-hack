import { Types } from 'mongoose';
import type { CompetitionLean, QueueItem } from '../models/Competition.js';
import { Attempt } from '../models/Attempt.js';
import { Participant } from '../models/Participant.js';
import { broadcaster } from '../sockets/broadcaster.js';
import { isDuplicateKeyError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { assignRanks } from './rankingPolicy.js';

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  prn: string;
  name: string;
  department: string;
  totalPoints: number;
  correct: number;
  incorrect: number;
  answered: number;
  accuracy: number | null;
  avgCorrectResponseMs: number | null;
}

/**
 * Writes an explicit timed-out attempt for every participant who had joined by the time the question
 * closed but never answered. Unique indexes make this idempotent; a real answer that was received before
 * the deadline but committed a moment later replaces its timeout record (see scoringService).
 */
export async function recordTimeouts(competition: CompetitionLean, item: QueueItem): Promise<void> {
  if (!item.publishedAt || !item.snapshot) return;
  const closedAt = item.closedAt ?? new Date();
  const [participants, answered] = await Promise.all([
    Participant.find({ competitionId: competition._id, joinedAt: { $lte: closedAt } }).select('studentId').lean(),
    Attempt.find({ competitionId: competition._id, questionId: item.questionId }).select('studentId').lean(),
  ]);
  const done = new Set(answered.map((attempt) => String(attempt.studentId)));
  const docs = participants
    .filter((participant) => !done.has(String(participant.studentId)))
    .map((participant) => ({
      competitionId: competition._id,
      questionId: item.questionId,
      studentId: participant.studentId,
      difficulty: item.snapshot!.difficulty,
      selectedOption: null,
      isCorrect: false,
      responseTimeMs: null,
      pointsAwarded: 0,
      submittedAt: null,
      timedOut: true,
    }));
  if (!docs.length) return;
  try {
    await Attempt.insertMany(docs, { ordered: false });
  } catch (error) {
    const writeErrors = (error as { writeErrors?: { code?: number; err?: { code?: number } }[] }).writeErrors ?? [];
    const onlyDuplicates = writeErrors.length > 0 && writeErrors.every((e) => (e.code ?? e.err?.code) === 11000);
    if (!onlyDuplicates && !isDuplicateKeyError(error)) throw error;
  }
}

export async function computeLeaderboard(competitionId: string | Types.ObjectId): Promise<LeaderboardEntry[]> {
  const id = new Types.ObjectId(String(competitionId));
  const [participants, totals] = await Promise.all([
    Participant.find({ competitionId: id }).populate<{ studentId: { _id: Types.ObjectId; prn: string; name: string; department: string } }>('studentId', 'prn name department').lean(),
    Attempt.aggregate<{ _id: Types.ObjectId; points: number; correct: number; answered: number; correctTimeSum: number }>([
      { $match: { competitionId: id } },
      {
        $group: {
          _id: '$studentId',
          points: { $sum: '$pointsAwarded' },
          correct: { $sum: { $cond: ['$isCorrect', 1, 0] } },
          answered: { $sum: { $cond: ['$timedOut', 0, 1] } },
          correctTimeSum: { $sum: { $cond: ['$isCorrect', '$responseTimeMs', 0] } },
        },
      },
    ]),
  ]);
  const byStudent = new Map(totals.map((row) => [String(row._id), row]));
  const entries = participants
    .filter((p) => p.studentId) // a deleted student account drops out of rankings
    .map((p) => {
      const student = p.studentId;
      const row = byStudent.get(String(student._id));
      const correct = row?.correct ?? 0;
      const answered = row?.answered ?? 0;
      return {
        studentId: String(student._id),
        prn: student.prn,
        name: student.name,
        department: student.department,
        totalPoints: row?.points ?? 0,
        correct,
        incorrect: answered - correct,
        answered,
        accuracy: answered ? correct / answered : null,
        avgCorrectResponseMs: correct ? Math.round((row?.correctTimeSum ?? 0) / correct) : null,
      };
    });
  return assignRanks(entries);
}

/** Students get a compact top list without PRNs or other account details; hosts get the full table. */
export function publicLeaderboard(entries: LeaderboardEntry[], limit = 10) {
  return entries.slice(0, limit).map((entry) => ({
    rank: entry.rank,
    studentId: entry.studentId,
    name: entry.name,
    department: entry.department,
    totalPoints: entry.totalPoints,
    correct: entry.correct,
  }));
}

export async function broadcastLeaderboard(competition: CompetitionLean): Promise<void> {
  const id = String(competition._id);
  const entries = await computeLeaderboard(competition._id);
  // Leaderboard is only sent to hosts; participants never receive leaderboard updates
  broadcaster().toHosts(id, 'leaderboard:updated', { competitionId: id, entries, total: entries.length });
}

const pendingHostRefresh = new Map<string, NodeJS.Timeout>();

/** Coalesces bursts of submissions into at most one host leaderboard refresh per second per competition. */
export function scheduleHostLeaderboardRefresh(competitionId: string): void {
  if (pendingHostRefresh.has(competitionId)) return;
  const timer = setTimeout(() => {
    pendingHostRefresh.delete(competitionId);
    computeLeaderboard(competitionId)
      .then((entries) => broadcaster().toHosts(competitionId, 'leaderboard:updated', { competitionId, entries, total: entries.length }))
      .catch((error: unknown) => logger.error('Host leaderboard refresh failed', { competitionId, error }));
  }, 1000);
  timer.unref?.();
  pendingHostRefresh.set(competitionId, timer);
}

/** Persists final score and rank on each participant once the competition ends. */
export async function finalizeCompetitionResults(competition: CompetitionLean): Promise<void> {
  const entries = await computeLeaderboard(competition._id);
  const completedAt = competition.completedAt ?? new Date();
  if (!entries.length) return;
  await Participant.bulkWrite(
    entries.map((entry) => ({
      updateOne: {
        filter: { competitionId: competition._id, studentId: new Types.ObjectId(entry.studentId) },
        update: { $set: { finalScore: entry.totalPoints, finalRank: entry.rank, completedAt } },
      },
    })),
  );
}
