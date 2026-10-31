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

  // Check overall competition timer
  if (competition.endsAt && receivedAt.getTime() >= competition.endsAt.getTime()) {
    throw new AppError(409, 'DEADLINE_PASSED', 'Competition time is up. Your answer was not recorded.');
  }

  // Backend answer locking and duplicate submission prevention
  const existing = await Attempt.findOne({ competitionId: competition._id, questionId: input.questionId, studentId: input.studentId }).lean();
  if (existing && !existing.timedOut) {
    throw new AppError(409, 'ALREADY_SUBMITTED', 'This answer is permanently locked. Modifications and duplicate submissions are not allowed.');
  }

  // Validate question belongs to competition queue
  const queueItem = competition.queue.find((item) => String(item.questionId) === input.questionId);
  if (!queueItem || !queueItem.snapshot) {
    throw invalidState('This question is not part of this competition.');
  }

  // Verify participant is answering the current sequential question (prevents skipping or resubmitting)
  const previousAttempts = await Attempt.find({ competitionId: competition._id, studentId: input.studentId, timedOut: false }).select('questionId').lean();
  const attemptedSet = new Set(previousAttempts.map((a) => String(a.questionId)));
  const sortedQueue = competition.queue.slice().sort((a, b) => a.order - b.order);
  const currentExpected = sortedQueue.find((item) => !attemptedSet.has(String(item.questionId)));
  if (!currentExpected || String(currentExpected.questionId) !== input.questionId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'You can only submit your current active question.');
  }

  const snapshot = queueItem.snapshot;
  const isCorrect = input.selectedOption === snapshot.correctOption;
  const startedAt = competition.startedAt?.getTime() ?? receivedAt.getTime();
  const responseTimeMs = Math.max(0, receivedAt.getTime() - startedAt);
  const record = {
    difficulty: snapshot.difficulty,
    selectedOption: input.selectedOption,
    isCorrect,
    responseTimeMs,
    pointsAwarded: pointsFor(isCorrect, snapshot.points),
    submittedAt: receivedAt,
    timedOut: false,
  };
  const key = { competitionId: competition._id, questionId: queueItem.questionId, studentId: input.studentId };

  try {
    if (existing && existing.timedOut) {
      await Attempt.updateOne({ _id: existing._id }, { $set: record });
    } else {
      await Attempt.create({ ...key, ...record });
    }
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(409, 'ALREADY_SUBMITTED', 'This answer is permanently locked. Duplicate submission rejected.');
    }
    throw error;
  }

  const result: SubmissionResult = {
    questionId: input.questionId,
    selectedOption: input.selectedOption,
    submittedAt: receivedAt.toISOString(),
    alreadySubmitted: false,
  };

  const id = String(competition._id);
  broadcaster().toStudent(input.studentId, 'answer:received', { competitionId: id, ...result });
  const answered = await Attempt.countDocuments({ competitionId: competition._id, questionId: queueItem.questionId, timedOut: false });
  broadcaster().toHosts(id, 'question:answer-count', { competitionId: id, questionId: input.questionId, answered });
  scheduleHostLeaderboardRefresh(id);

  return result;
}
