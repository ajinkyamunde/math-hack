import { Attempt } from '../models/Attempt.js';
import { Participant } from '../models/Participant.js';
import type { OptionKey } from '../types/domain.js';
import { AppError, forbidden, invalidState, isDuplicateKeyError } from '../utils/errors.js';
import { broadcaster } from '../sockets/broadcaster.js';
import { loadCompetition } from './competitionService.js';
import { liveItem } from './competitionView.js';
import { scheduleHostLeaderboardRefresh } from './leaderboardService.js';

export interface SubmissionResult {
  questionId: string;
  selectedOption: OptionKey;
  submittedAt: string;
  alreadySubmitted: boolean;
}

/** Points for an answer. Kept separate so the rule is unit-testable; speed bonuses are intentionally absent. */
export function pointsFor(isCorrect: boolean, questionPoints: number): number {
  return isCorrect ? questionPoints : 0;
}

/**
 * Deadline policy: an answer counts only if the server *receives* it strictly before the question's
 * effective deadline (the earlier of the question deadline and the competition end). Client clocks,
 * flags, points and response times are never trusted.
 */
export async function submitAnswer(input: {
  competitionId: string;
  studentId: string;
  questionId: string;
  selectedOption: OptionKey;
  receivedAt?: Date;
}): Promise<SubmissionResult> {
  const receivedAt = input.receivedAt ?? new Date();
  const competition = await loadCompetition(input.competitionId);

  if (competition.status === 'PAUSED') throw invalidState('The competition is paused. Answers are not accepted until it resumes.');
  if (competition.status !== 'RUNNING') throw invalidState('This competition is not accepting answers.');
  if (!(await Participant.exists({ competitionId: competition._id, studentId: input.studentId }))) {
    throw forbidden('Join this competition before answering.');
  }

  const live = liveItem(competition);
  if (!live || String(live.questionId) !== input.questionId) throw invalidState('This question is no longer accepting answers.');

  const deadline = Math.min(competition.currentQuestionDeadline?.getTime() ?? 0, competition.endsAt?.getTime() ?? 0);
  if (receivedAt.getTime() >= deadline) throw new AppError(409, 'DEADLINE_PASSED', 'Time is up for this question. Your answer was not recorded.');

  const snapshot = live.snapshot!;
  const isCorrect = input.selectedOption === snapshot.correctOption;
  const startedAt = competition.currentQuestionStartedAt?.getTime() ?? receivedAt.getTime();
  const responseTimeMs = Math.max(0, receivedAt.getTime() - startedAt - (competition.currentQuestionPausedMs ?? 0));
  const record = {
    difficulty: snapshot.difficulty,
    selectedOption: input.selectedOption,
    isCorrect,
    responseTimeMs,
    pointsAwarded: pointsFor(isCorrect, snapshot.points),
    submittedAt: receivedAt,
    timedOut: false,
  };
  const key = { competitionId: competition._id, questionId: live.questionId, studentId: input.studentId };

  let alreadySubmitted = false;
  let stored: { selectedOption?: string | null; submittedAt?: Date | null } = record;
  try {
    await Attempt.create({ ...key, ...record });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // The unique index decided: either this student already answered (return the original, award nothing),
    // or the question closed between our checks and the insert and a timeout row was written. An answer
    // received before the deadline wins over that timeout row, exactly once.
    const replaced = await Attempt.findOneAndUpdate({ ...key, timedOut: true }, { $set: record }, { new: true }).lean();
    if (!replaced) {
      const existing = await Attempt.findOne(key).select('selectedOption submittedAt').lean();
      alreadySubmitted = true;
      stored = existing ?? record;
    }
  }

  const result: SubmissionResult = {
    questionId: input.questionId,
    selectedOption: (stored.selectedOption ?? input.selectedOption) as OptionKey,
    submittedAt: (stored.submittedAt ?? receivedAt).toISOString(),
    alreadySubmitted,
  };

  if (!alreadySubmitted) {
    const id = String(competition._id);
    // Only the submitting student's own devices learn about the submission.
    broadcaster().toStudent(input.studentId, 'answer:received', { competitionId: id, ...result });
    const answered = await Attempt.countDocuments({ competitionId: competition._id, questionId: live.questionId, timedOut: false });
    broadcaster().toHosts(id, 'question:answer-count', { competitionId: id, questionId: input.questionId, answered });
    scheduleHostLeaderboardRefresh(id);
  }
  return result;
}
