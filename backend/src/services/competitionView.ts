import type { CompetitionLean, QueueItem } from '../models/Competition.js';

/** The live question as students see it: never includes the correct option or explanation. */
export function publicQuestion(item: QueueItem, now: number) {
  const snapshot = item.snapshot!;
  return {
    id: String(item.questionId),
    questionText: snapshot.questionText,
    options: snapshot.options,
    difficulty: snapshot.difficulty,
    points: snapshot.points,
    timeLimitSeconds: snapshot.timeLimitSeconds,
    publishedAt: item.publishedAt?.toISOString(),
    deadline: item.deadline?.toISOString(),
    remainingMs: item.deadline ? Math.max(0, item.deadline.getTime() - now) : 0,
  };
}

export function liveItem(competition: CompetitionLean): QueueItem | undefined {
  if (!competition.currentQuestionId) return undefined;
  return competition.queue.find((item) => item.status === 'LIVE' && String(item.questionId) === String(competition.currentQuestionId));
}

/** Remaining overall time. While paused the clock is frozen at the moment of pausing. */
export function remainingCompetitionMs(competition: CompetitionLean, now: number): number | null {
  if (!competition.endsAt) return null;
  const reference = competition.status === 'PAUSED' && competition.pausedAt ? competition.pausedAt.getTime() : now;
  if (competition.status === 'COMPLETED' || competition.status === 'CANCELLED') return 0;
  return Math.max(0, competition.endsAt.getTime() - reference);
}

function remainingQuestionMs(competition: CompetitionLean, item: QueueItem, now: number): number {
  if (competition.status === 'PAUSED') return competition.pausedQuestionRemainingMs ?? 0;
  return item.deadline ? Math.max(0, item.deadline.getTime() - now) : 0;
}

function baseState(competition: CompetitionLean, now: number) {
  const published = competition.queue.filter((item) => item.publishedAt).length;
  const live = liveItem(competition);
  return {
    id: String(competition._id),
    name: competition.name,
    description: competition.description,
    status: competition.status,
    durationSeconds: competition.durationSeconds,
    questionProgressionMode: competition.questionProgressionMode,
    startedAt: competition.startedAt?.toISOString() ?? null,
    endsAt: competition.endsAt?.toISOString() ?? null,
    completedAt: competition.completedAt?.toISOString() ?? null,
    remainingMs: remainingCompetitionMs(competition, now),
    serverNow: new Date(now).toISOString(),
    questionNumber: live ? published : null,
    totalQuestions: competition.queue.filter((item) => item.status !== 'SKIPPED' || item.publishedAt).length,
    settings: {
      revealAnswers: competition.settings?.revealAnswers ?? true,
      showLeaderboardToStudents: competition.settings?.showLeaderboardToStudents ?? true,
    },
  };
}

export function studentCompetitionState(
  competition: CompetitionLean,
  now: number,
  extras: {
    joined: boolean;
    currentQuestion?: ReturnType<typeof publicQuestion> | null;
    questionNumber?: number | null;
    totalQuestions?: number;
    mySubmission?: { questionId: string; selectedOption: string | null; submittedAt?: Date | null } | null;
  },
) {
  const base = baseState(competition, now);
  const live = liveItem(competition);
  const currentQuestion =
    extras.currentQuestion !== undefined
      ? extras.currentQuestion
      : live && extras.joined
        ? { ...publicQuestion(live, now), remainingMs: remainingQuestionMs(competition, live, now) }
        : null;

  return {
    ...base,
    questionNumber: extras.questionNumber !== undefined ? extras.questionNumber : base.questionNumber,
    totalQuestions: extras.totalQuestions !== undefined ? extras.totalQuestions : base.totalQuestions,
    settings: {
      revealAnswers: false,
      showLeaderboardToStudents: false,
    },
    joined: extras.joined,
    currentQuestion,
    mySubmission: extras.mySubmission
      ? { questionId: extras.mySubmission.questionId, selectedOption: extras.mySubmission.selectedOption, submittedAt: extras.mySubmission.submittedAt?.toISOString() ?? null }
      : null,
  };
}

export function hostCompetitionState(competition: CompetitionLean, now: number) {
  const live = liveItem(competition);
  return {
    ...baseState(competition, now),
    settings: competition.settings,
    createdAt: (competition as { createdAt?: Date }).createdAt?.toISOString(),
    pausedAt: competition.pausedAt?.toISOString() ?? null,
    totalPausedMilliseconds: competition.totalPausedMilliseconds,
    stateVersion: competition.stateVersion,
    completionReason: competition.completionReason ?? null,
    currentQuestion: live
      ? {
          ...publicQuestion(live, now),
          remainingMs: remainingQuestionMs(competition, live, now),
          correctOption: live.snapshot!.correctOption,
          explanation: live.snapshot!.explanation,
        }
      : null,
    queue: competition.queue
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        questionId: String(item.questionId),
        order: item.order,
        status: item.status,
        snapshot: item.snapshot ?? null,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        closedAt: item.closedAt?.toISOString() ?? null,
        closeReason: item.closeReason ?? null,
      })),
  };
}

/** Sent when a question closes: reveal fields are included only when the competition allows it. */
export function closedQuestionPayload(competition: CompetitionLean, item: QueueItem) {
  const reveal = competition.settings?.revealAnswers ?? true;
  return {
    competitionId: String(competition._id),
    questionId: String(item.questionId),
    closedAt: item.closedAt?.toISOString(),
    reason: item.closeReason,
    ...(reveal ? { correctOption: item.snapshot?.correctOption, explanation: item.snapshot?.explanation || null } : {}),
  };
}
