import { Types, type UpdateQuery } from 'mongoose';
import { Competition, type CompetitionAttrs, type CompetitionLean, type QueueItem } from '../models/Competition.js';
import { Participant } from '../models/Participant.js';
import { Question } from '../models/Question.js';
import { Student } from '../models/Student.js';
import { Attempt } from '../models/Attempt.js';
import { getEnv } from '../config/environment.js';
import { AppError, badRequest, forbidden, invalidState, notFound, isDuplicateKeyError } from '../utils/errors.js';
import type { z } from 'zod';
import type { createCompetitionSchema, updateCompetitionSchema } from '../validation/competitionSchemas.js';
import { canTransition, transitionError, type LifecycleAction } from './competitionLifecycle.js';
import { closedQuestionPayload, hostCompetitionState, liveItem, publicQuestion, studentCompetitionState } from './competitionView.js';
import * as timers from './timerService.js';
import { broadcaster } from '../sockets/broadcaster.js';
import { recordAudit } from './auditService.js';
import { finalizeCompetitionResults, broadcastLeaderboard, recordTimeouts } from './leaderboardService.js';
import { logger } from '../utils/logger.js';

type CreateInput = z.output<typeof createCompetitionSchema>;
type UpdateInput = z.output<typeof updateCompetitionSchema>;
type CloseReason = NonNullable<QueueItem['closeReason']>;

/** Below this much overall time left, publishing a new question is pointless and the competition ends instead. */
const MIN_PUBLISH_WINDOW_MS = 1000;
const MAX_RETRIES = 5;

// ---------------------------------------------------------------------------
// Loading and optimistic concurrency
// ---------------------------------------------------------------------------

export async function loadCompetition(id: string): Promise<CompetitionLean> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Competition');
  const competition = await Competition.findById(id).lean<CompetitionLean>();
  if (!competition) throw notFound('Competition');
  return competition;
}

type Effect =
  | { type: 'closed'; item: QueueItem }
  | { type: 'published'; item: QueueItem }
  | { type: 'status'; event: string }
  | { type: 'completed' };

interface Plan {
  set?: Record<string, unknown>;
  unset?: string[];
  effects: Effect[];
  audit?: { action: string; actorId?: string; details?: Record<string, unknown> };
}

/**
 * Plans a state change from a snapshot of the competition and commits it only if nobody else changed
 * the competition in between (stateVersion match). On conflict it re-reads and re-plans, so two host
 * clicks or a host click racing the timer can never double-publish or double-close.
 */
async function mutate(
  id: string,
  planner: (competition: CompetitionLean, now: Date) => Plan | null,
): Promise<CompetitionLean> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const competition = await loadCompetition(id);
    const now = new Date();
    const plan = planner(competition, now);
    if (!plan) return competition;
    const update: UpdateQuery<CompetitionAttrs> = { $inc: { stateVersion: 1 } };
    if (plan.set && Object.keys(plan.set).length) update.$set = plan.set;
    if (plan.unset?.length) update.$unset = Object.fromEntries(plan.unset.map((field) => [field, 1]));
    const updated = await Competition.findOneAndUpdate({ _id: competition._id, stateVersion: competition.stateVersion }, update, {
      new: true,
    }).lean<CompetitionLean>();
    if (!updated) continue; // Someone else changed the competition first: plan again from fresh state.
    if (plan.audit) {
      await recordAudit({
        actorId: plan.audit.actorId,
        actorRole: plan.audit.actorId ? 'host' : 'system',
        action: plan.audit.action,
        competitionId: id,
        details: plan.audit.details,
      });
    }
    await runEffects(updated, plan.effects);
    return updated;
  }
  throw new AppError(409, 'CONFLICT', 'The competition changed while processing your request. Please try again.');
}

// ---------------------------------------------------------------------------
// Pure planning helpers
// ---------------------------------------------------------------------------

const cloneQueue = (competition: CompetitionLean): QueueItem[] => competition.queue.map((item) => ({ ...item }));

function closeLive(competition: CompetitionLean, queue: QueueItem[], now: Date, reason: CloseReason, plan: Plan): void {
  const live = queue.find((item) => item.status === 'LIVE');
  if (!live) return;
  live.status = reason === 'SKIPPED' ? 'SKIPPED' : 'CLOSED';
  live.closedAt = now;
  live.closeReason = reason;
  plan.effects.push({ type: 'closed', item: live });
  plan.unset = [...(plan.unset ?? []), 'currentQuestionId', 'currentQuestionStartedAt', 'currentQuestionDeadline', 'pausedQuestionRemainingMs'];
  plan.set = { ...plan.set, currentQuestionPausedMs: 0 };
  void competition;
}

function nextPending(queue: QueueItem[], questionId?: string): QueueItem | undefined {
  const pending = queue.filter((item) => item.status === 'PENDING').sort((a, b) => a.order - b.order);
  if (!questionId) return pending[0];
  return pending.find((item) => String(item.questionId) === questionId);
}

function publishInto(competition: CompetitionLean, queue: QueueItem[], item: QueueItem, now: Date, plan: Plan): void {
  const endsAt = competition.endsAt!.getTime();
  const deadline = new Date(Math.min(now.getTime() + item.snapshot!.timeLimitSeconds * 1000, endsAt));
  item.status = 'LIVE';
  item.publishedAt = now;
  item.deadline = deadline;
  plan.unset = (plan.unset ?? []).filter((field) => !['currentQuestionId', 'currentQuestionStartedAt', 'currentQuestionDeadline'].includes(field));
  plan.set = {
    ...plan.set,
    queue,
    currentQuestionId: item.questionId,
    currentQuestionStartedAt: now,
    currentQuestionDeadline: deadline,
    currentQuestionPausedMs: 0,
  };
  plan.effects.push({ type: 'published', item });
}

function completeInto(competition: CompetitionLean, queue: QueueItem[], now: Date, reason: 'TIMER' | 'HOST' | 'QUEUE_EMPTY', plan: Plan): void {
  closeLive(competition, queue, now, 'COMPETITION_ENDED', plan);
  plan.set = { ...plan.set, queue, status: 'COMPLETED', completedAt: now, completionReason: reason };
  plan.unset = [...new Set([...(plan.unset ?? []), 'pausedAt', 'pausedQuestionRemainingMs'])];
  plan.effects.push({ type: 'completed' });
}

function assertAction(competition: CompetitionLean, action: LifecycleAction): void {
  if (!canTransition(action, competition.status)) throw invalidState(transitionError(action, competition.status));
}

const overallExpired = (competition: CompetitionLean, now: Date): boolean =>
  Boolean(competition.endsAt && competition.endsAt.getTime() - now.getTime() < MIN_PUBLISH_WINDOW_MS);

// ---------------------------------------------------------------------------
// Side effects after a successful commit
// ---------------------------------------------------------------------------

async function runEffects(competition: CompetitionLean, effects: Effect[]): Promise<void> {
  const id = String(competition._id);
  const io = broadcaster();
  const now = Date.now();
  timers.schedule(competition);
  try {
    for (const effect of effects) {
      if (effect.type === 'closed') {
        await recordTimeouts(competition, effect.item);
        const payload = closedQuestionPayload(competition, effect.item);
        io.toCompetition(id, 'question:closed', payload);
        io.toHosts(id, 'question:closed', { ...payload, correctOption: effect.item.snapshot?.correctOption });
      } else if (effect.type === 'published') {
        io.toCompetition(id, 'question:published', { competitionId: id, serverNow: new Date(now).toISOString(), question: publicQuestion(effect.item, now) });
      } else if (effect.type === 'status') {
        io.toCompetition(id, effect.event, { competitionId: id, serverNow: new Date(now).toISOString() });
      } else if (effect.type === 'completed') {
        await finalizeCompetitionResults(competition);
        io.toCompetition(id, 'competition:completed', { competitionId: id, completedAt: competition.completedAt?.toISOString() });
      }
    }
    // Every change is followed by the authoritative state so clients never drift.
    io.toCompetition(id, 'competition:state', studentCompetitionState(competition, now, { joined: true }));
    io.toHosts(id, 'competition:state', hostCompetitionState(competition, now));
    if (effects.some((effect) => effect.type === 'closed' || effect.type === 'completed')) await broadcastLeaderboard(competition);
  } catch (error) {
    // The state change is already durable; a failed broadcast is recovered by clients re-fetching state.
    logger.error('Competition side effects failed', { competitionId: id, error });
  }
}

// ---------------------------------------------------------------------------
// Queue construction
// ---------------------------------------------------------------------------

async function snapshotsFor(questionIds: string[], competition: Pick<CompetitionLean, 'settings'>) {
  if (!questionIds.length) return new Map<string, QueueItem['snapshot']>();
  const questions = await Question.find({ _id: { $in: questionIds } }).select('+correctOption +explanation').lean();
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  const missing = questionIds.filter((id) => !byId.has(id));
  if (missing.length) throw badRequest(`${missing.length} selected question(s) no longer exist.`, { missing });
  const drafts = questions.filter((q) => q.status !== 'ACTIVE');
  if (drafts.length) throw badRequest('Only ACTIVE questions can be added to a competition. Publish the draft questions first.', { drafts: drafts.map((q) => String(q._id)) });
  const override = competition.settings?.pointsOverride ?? {};
  return new Map(
    questionIds.map((id) => {
      const q = byId.get(id)!;
      return [
        id,
        {
          questionText: q.questionText,
          options: q.options,
          correctOption: q.correctOption,
          difficulty: q.difficulty,
          timeLimitSeconds: q.timeLimitSeconds,
          points: override[q.difficulty] ?? q.points,
          topic: q.topic ?? '',
          explanation: q.explanation ?? '',
        },
      ];
    }),
  );
}

// ---------------------------------------------------------------------------
// Host commands
// ---------------------------------------------------------------------------

export async function createCompetition(input: CreateInput, hostId: string) {
  const { questionIds, ...rest } = input;
  await snapshotsFor(questionIds, { settings: input.settings as CompetitionLean['settings'] }); // validates the selection
  const competition = await Competition.create({
    ...rest,
    createdBy: hostId,
    queue: questionIds.map((questionId, index) => ({ questionId, order: index })),
  });
  await recordAudit({ actorId: hostId, actorRole: 'host', action: 'competition.create', competitionId: competition.id });
  return hostCompetitionState(competition.toObject() as CompetitionLean, Date.now());
}

export async function updateCompetition(id: string, input: UpdateInput, hostId: string) {
  const updated = await mutate(id, (competition) => {
    if (!['DRAFT', 'WAITING'].includes(competition.status)) throw invalidState('Settings can only be changed before the competition starts.');
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      if (key === 'settings') {
        for (const [settingKey, settingValue] of Object.entries(value as object)) {
          if (settingValue !== undefined) set[`settings.${settingKey}`] = settingValue;
        }
      } else set[key] = value;
    }
    return { set, effects: [], audit: { action: 'competition.update', actorId: hostId } };
  });
  return hostCompetitionState(updated, Date.now());
}

/**
 * Before start the queue is replaced wholesale. While running or paused, published items keep their
 * place and status; the list only reorders, adds or removes PENDING questions (new ones are snapshotted immediately).
 */
export async function setQueue(id: string, questionIds: string[], hostId: string) {
  const current = await loadCompetition(id);
  if (['COMPLETED', 'CANCELLED'].includes(current.status)) throw invalidState('The queue of a finished competition cannot change.');
  const live = ['RUNNING', 'PAUSED'].includes(current.status);
  const lockedIds = new Set(current.queue.filter((item) => item.status !== 'PENDING').map((item) => String(item.questionId)));
  const pendingIds = questionIds.filter((qid) => !lockedIds.has(qid));
  const snapshots = await snapshotsFor(pendingIds, current);

  const updated = await mutate(id, (competition) => {
    if (competition.stateVersion !== current.stateVersion && competition.status !== current.status) {
      throw new AppError(409, 'CONFLICT', 'The competition changed while saving the queue. Please retry.');
    }
    const locked = competition.queue.filter((item) => item.status !== 'PENDING').sort((a, b) => a.order - b.order);
    const queue: QueueItem[] = [
      ...locked.map((item, index) => ({ ...item, order: index })),
      ...pendingIds.map((questionId, index) => ({
        questionId: new Types.ObjectId(questionId),
        order: locked.length + index,
        status: 'PENDING' as const,
        snapshot: live ? snapshots.get(questionId) : undefined,
      })),
    ] as QueueItem[];
    return { set: { queue }, effects: [], audit: { action: 'competition.queue', actorId: hostId, details: { count: queue.length } } };
  });
  return hostCompetitionState(updated, Date.now());
}

export async function openRegistration(id: string, hostId: string) {
  const updated = await mutate(id, (competition) => {
    assertAction(competition, 'openRegistration');
    return { set: { status: 'WAITING' }, effects: [{ type: 'status', event: 'competition:waiting' }], audit: { action: 'competition.open', actorId: hostId } };
  });
  return hostCompetitionState(updated, Date.now());
}

export async function startCompetition(id: string, hostId: string) {
  const current = await loadCompetition(id);
  assertAction(current, 'start');
  const ids = current.queue.slice().sort((a, b) => a.order - b.order).map((item) => String(item.questionId));
  if (!ids.length) throw badRequest('Add at least one question to the queue before starting.');
  const snapshots = await snapshotsFor(ids, current);

  const updated = await mutate(id, (competition, now) => {
    assertAction(competition, 'start');
    const queue = competition.queue
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item, index) => ({ ...item, order: index, status: 'PENDING' as const, snapshot: snapshots.get(String(item.questionId)) })) as QueueItem[];
    if (queue.some((item) => !item.snapshot)) throw new AppError(409, 'CONFLICT', 'The queue changed while starting. Please retry.');
    const endsAt = new Date(now.getTime() + competition.durationSeconds * 1000);
    const plan: Plan = {
      set: { status: 'RUNNING', startedAt: now, endsAt, totalPausedMilliseconds: 0, queue },
      effects: [{ type: 'status', event: 'competition:started' }],
      audit: { action: 'competition.start', actorId: hostId },
    };
    if (competition.questionProgressionMode === 'AUTOMATIC') {
      publishInto({ ...competition, endsAt }, queue, queue[0]!, now, plan);
    }
    return plan;
  });
  return hostCompetitionState(updated, Date.now());
}

export async function pauseCompetition(id: string, hostId: string) {
  const updated = await mutate(id, (competition, now) => {
    assertAction(competition, 'pause');
    const set: Record<string, unknown> = { status: 'PAUSED', pausedAt: now };
    if (competition.currentQuestionDeadline) set.pausedQuestionRemainingMs = Math.max(0, competition.currentQuestionDeadline.getTime() - now.getTime());
    return { set, effects: [{ type: 'status', event: 'competition:paused' }], audit: { action: 'competition.pause', actorId: hostId } };
  });
  return hostCompetitionState(updated, Date.now());
}

/** Shifts every deadline by the paused duration so remaining time is exactly what it was at pause. */
export async function resumeCompetition(id: string, hostId: string) {
  const updated = await mutate(id, (competition, now) => {
    assertAction(competition, 'resume');
    const pausedMs = Math.max(0, now.getTime() - (competition.pausedAt?.getTime() ?? now.getTime()));
    const shift = (date?: Date | null) => (date ? new Date(date.getTime() + pausedMs) : undefined);
    const queue = cloneQueue(competition);
    const live = queue.find((item) => item.status === 'LIVE');
    if (live?.deadline) live.deadline = shift(live.deadline)!;
    const set: Record<string, unknown> = {
      status: 'RUNNING',
      endsAt: shift(competition.endsAt),
      totalPausedMilliseconds: competition.totalPausedMilliseconds + pausedMs,
      queue,
    };
    if (competition.currentQuestionDeadline) {
      set.currentQuestionDeadline = shift(competition.currentQuestionDeadline);
      set.currentQuestionPausedMs = (competition.currentQuestionPausedMs ?? 0) + pausedMs;
    }
    return {
      set,
      unset: ['pausedAt', 'pausedQuestionRemainingMs'],
      effects: [{ type: 'status', event: 'competition:resumed' }],
      audit: { action: 'competition.resume', actorId: hostId, details: { pausedMs } },
    };
  });
  return hostCompetitionState(updated, Date.now());
}

/** Publishes the chosen (or next queued) question, closing any live question first. */
export async function publishQuestion(id: string, hostId: string, questionId?: string) {
  const updated = await mutate(id, (competition, now) => {
    if (competition.status !== 'RUNNING') throw invalidState(transitionError('publish a question', competition.status));
    const queue = cloneQueue(competition);
    const plan: Plan = { effects: [], audit: { action: 'question.publish', actorId: hostId, details: { questionId } } };
    if (overallExpired(competition, now)) {
      completeInto(competition, queue, now, 'TIMER', plan);
      return plan;
    }
    const item = nextPending(queue, questionId);
    if (!item) throw invalidState(questionId ? 'That question is not waiting in the queue.' : 'There are no more queued questions.');
    closeLive(competition, queue, now, 'HOST_NEXT', plan);
    publishInto(competition, queue, item, now, plan);
    return plan;
  });
  return hostCompetitionState(updated, Date.now());
}

/**
 * Skip closes the live question early (answers already received still count) and, in automatic mode,
 * publishes the next one. With a questionId of a PENDING item it removes that item from play instead.
 */
export async function skipQuestion(id: string, hostId: string, questionId?: string) {
  const updated = await mutate(id, (competition, now) => {
    if (!['RUNNING', 'PAUSED'].includes(competition.status)) throw invalidState(transitionError('skip a question', competition.status));
    const queue = cloneQueue(competition);
    const plan: Plan = { effects: [], audit: { action: 'question.skip', actorId: hostId, details: { questionId } } };
    const live = queue.find((item) => item.status === 'LIVE');
    if (questionId && (!live || String(live.questionId) !== questionId)) {
      const pending = nextPending(queue, questionId);
      if (!pending) throw invalidState('That question is not waiting in the queue.');
      pending.status = 'SKIPPED';
      pending.closeReason = 'SKIPPED';
      pending.closedAt = now;
      plan.set = { queue };
      return plan;
    }
    if (!live) throw invalidState('There is no live question to skip.');
    if (competition.status === 'PAUSED') throw invalidState('Resume the competition before skipping the live question.');
    closeLive(competition, queue, now, 'SKIPPED', plan);
    plan.set = { ...plan.set, queue };
    advanceAfterClose(competition, queue, now, plan);
    return plan;
  });
  return hostCompetitionState(updated, Date.now());
}

export async function endCompetition(id: string, hostId: string) {
  const updated = await mutate(id, (competition, now) => {
    assertAction(competition, 'end');
    const plan: Plan = { effects: [], audit: { action: 'competition.end', actorId: hostId } };
    completeInto(competition, cloneQueue(competition), now, 'HOST', plan);
    return plan;
  });
  return hostCompetitionState(updated, Date.now());
}

export async function cancelCompetition(id: string, hostId: string) {
  const updated = await mutate(id, (competition, now) => {
    assertAction(competition, 'cancel');
    const queue = cloneQueue(competition);
    const plan: Plan = { effects: [{ type: 'status', event: 'competition:cancelled' }], audit: { action: 'competition.cancel', actorId: hostId } };
    closeLive(competition, queue, now, 'COMPETITION_ENDED', plan);
    plan.set = { ...plan.set, queue, status: 'CANCELLED', completedAt: now, completionReason: 'CANCELLED' };
    plan.unset = [...(plan.unset ?? []), 'pausedAt'];
    return plan;
  });
  return hostCompetitionState(updated, Date.now());
}

/** After a question closes: automatic mode publishes the next one; an empty queue may complete the competition. */
function advanceAfterClose(competition: CompetitionLean, queue: QueueItem[], now: Date, plan: Plan): void {
  const next = nextPending(queue);
  if (overallExpired(competition, now)) {
    completeInto(competition, queue, now, 'TIMER', plan);
  } else if (next && competition.questionProgressionMode === 'AUTOMATIC') {
    publishInto(competition, queue, next, now, plan);
  } else if (!next && competition.settings?.completeWhenQueueEmpty) {
    completeInto(competition, queue, now, 'QUEUE_EMPTY', plan);
  }
}

// ---------------------------------------------------------------------------
// Timer-driven processing (called by timerService alarms and the watchdog)
// ---------------------------------------------------------------------------

export async function processDueCompetition(id: string): Promise<void> {
  await mutate(id, (competition, now) => {
    if (competition.status !== 'RUNNING') return null;
    const queue = cloneQueue(competition);
    const plan: Plan = { effects: [] };
    if (competition.endsAt && competition.endsAt.getTime() <= now.getTime()) {
      completeInto(competition, queue, now, 'TIMER', plan);
      plan.audit = { action: 'competition.timer-complete' };
      return plan;
    }
    if (competition.currentQuestionDeadline && competition.currentQuestionDeadline.getTime() <= now.getTime()) {
      // Record the close at the deadline itself, not at the (slightly later) moment the alarm fired.
      closeLive(competition, queue, competition.currentQuestionDeadline, 'TIMER', plan);
      plan.set = { ...plan.set, queue };
      advanceAfterClose(competition, queue, now, plan);
      plan.audit = { action: 'question.timer-close' };
      return plan;
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// Queries and student actions
// ---------------------------------------------------------------------------

export async function listCompetitions(role: 'host' | 'student', query: { page: number; pageSize: number; status?: string }, studentId?: string) {
  const filter: Record<string, unknown> = {};
  if (role === 'student') filter.status = query.status && query.status !== 'DRAFT' ? query.status : { $ne: 'DRAFT' };
  else if (query.status) filter.status = query.status;
  const [items, total] = await Promise.all([
    Competition.find(filter)
      .select('name description status durationSeconds startedAt endsAt completedAt createdAt questionProgressionMode queue.status')
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<CompetitionLean[]>(),
    Competition.countDocuments(filter),
  ]);
  const joined = studentId
    ? new Set(
        (await Participant.find({ studentId, competitionId: { $in: items.map((c) => c._id) } }).select('competitionId').lean()).map((p) =>
          String(p.competitionId),
        ),
      )
    : new Set<string>();
  const counts =
    role === 'host'
      ? new Map(
          (
            await Participant.aggregate<{ _id: Types.ObjectId; count: number }>([
              { $match: { competitionId: { $in: items.map((c) => c._id) } } },
              { $group: { _id: '$competitionId', count: { $sum: 1 } } },
            ])
          ).map((row) => [String(row._id), row.count]),
        )
      : new Map<string, number>();
  return {
    items: items.map((c) => ({
      id: String(c._id),
      name: c.name,
      description: c.description,
      status: c.status,
      durationSeconds: c.durationSeconds,
      questionCount: c.queue.length,
      startedAt: c.startedAt ?? null,
      endsAt: c.endsAt ?? null,
      completedAt: c.completedAt ?? null,
      createdAt: (c as { createdAt?: Date }).createdAt,
      ...(role === 'student' ? { joined: joined.has(String(c._id)) } : { participantCount: counts.get(String(c._id)) ?? 0, questionProgressionMode: c.questionProgressionMode }),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function hostState(id: string) {
  return hostCompetitionState(await loadCompetition(id), Date.now());
}

export async function studentState(id: string, studentId: string) {
  const competition = await loadCompetition(id);
  if (competition.status === 'DRAFT') throw notFound('Competition');
  const joined = Boolean(await Participant.exists({ competitionId: competition._id, studentId }));
  let mySubmission = null;
  const live = liveItem(competition);
  if (joined && live) {
    const attempt = await Attempt.findOne({ competitionId: competition._id, questionId: live.questionId, studentId, timedOut: false })
      .select('selectedOption submittedAt')
      .lean();
    if (attempt) mySubmission = { questionId: String(live.questionId), selectedOption: attempt.selectedOption ?? null, submittedAt: attempt.submittedAt };
  }
  return studentCompetitionState(competition, Date.now(), { joined, mySubmission });
}

export async function joinCompetition(id: string, studentId: string) {
  const competition = await loadCompetition(id);
  if (!['WAITING', 'RUNNING', 'PAUSED'].includes(competition.status)) {
    throw invalidState(competition.status === 'DRAFT' ? 'This competition is not open yet.' : 'This competition is no longer accepting participants.');
  }
  if (getEnv().REQUIRE_EMAIL_VERIFICATION) {
    const student = await Student.findById(studentId).select('emailVerified').lean();
    if (!student?.emailVerified) throw forbidden('Verify your college email before joining a competition.');
  }
  try {
    await Participant.create({ competitionId: competition._id, studentId });
    broadcaster().toHosts(id, 'participant:joined', { competitionId: id, participantCount: await Participant.countDocuments({ competitionId: competition._id }) });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error; // Joining twice is idempotent.
  }
  return studentState(id, studentId);
}

export async function assertParticipant(competitionId: string, studentId: string): Promise<void> {
  if (!(await Participant.exists({ competitionId, studentId }))) throw forbidden('Join this competition first.');
}
