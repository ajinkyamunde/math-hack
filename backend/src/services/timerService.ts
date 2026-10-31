import { Competition } from '../models/Competition.js';
import { logger } from '../utils/logger.js';

/**
 * Wakes the competition engine at authoritative deadlines.
 *
 * The clock itself lives in MongoDB as absolute timestamps (endsAt, currentQuestionDeadline), so nothing
 * here is the source of truth: timers are only alarms. A missed alarm (restart, crash, another instance
 * owning the socket) is caught by the watchdog sweep, and every state change is version-guarded, so
 * processing the same deadline twice — even from two backend instances — is harmless.
 */
type DueHandler = (competitionId: string) => Promise<void>;

const timers = new Map<string, NodeJS.Timeout>();
let handler: DueHandler | undefined;
let watchdog: NodeJS.Timeout | undefined;
const WATCHDOG_INTERVAL_MS = 2000;
const ALARM_SLACK_MS = 15;

export function setDueHandler(next: DueHandler): void {
  handler = next;
}

async function fire(competitionId: string): Promise<void> {
  timers.delete(competitionId);
  if (!handler) return;
  try {
    await handler(competitionId);
  } catch (error) {
    logger.error('Competition timer handler failed', { competitionId, error });
  }
}

/** Schedules an alarm for the next deadline of a running competition, replacing any existing alarm. */
export function schedule(competition: { _id: unknown; status: string; endsAt?: Date | null; currentQuestionDeadline?: Date | null }): void {
  const id = String(competition._id);
  cancel(id);
  if (competition.status !== 'RUNNING') return;
  const candidates = [competition.endsAt].filter((d): d is Date => d instanceof Date);
  if (!candidates.length) return;
  const next = Math.min(...candidates.map((d) => d.getTime()));
  const delay = Math.max(0, Math.min(next - Date.now() + ALARM_SLACK_MS, 2_000_000_000));
  const timer = setTimeout(() => void fire(id), delay);
  timer.unref?.();
  timers.set(id, timer);
}

export function cancel(competitionId: string): void {
  const timer = timers.get(competitionId);
  if (timer) clearTimeout(timer);
  timers.delete(competitionId);
}

/** Finds running competitions whose deadlines have passed. Used on startup and by the watchdog. */
export async function sweepDue(now = new Date()): Promise<void> {
  if (!handler) return;
  const due = await Competition.find({
    status: 'RUNNING',
    endsAt: { $lte: now },
  })
    .select('_id')
    .lean();
  for (const competition of due) await fire(String(competition._id));
}

/** Restores alarms for every running competition after a restart and starts the watchdog. */
export async function startTimers(): Promise<void> {
  await sweepDue();
  const running = await Competition.find({ status: 'RUNNING' }).select('_id status endsAt currentQuestionDeadline').lean();
  running.forEach((competition) => schedule(competition));
  watchdog = setInterval(() => {
    sweepDue().catch((error: unknown) => logger.error('Timer watchdog failed', { error }));
  }, WATCHDOG_INTERVAL_MS);
  watchdog.unref?.();
  logger.info('Competition timers restored', { running: running.length });
}

export function stopTimers(): void {
  if (watchdog) clearInterval(watchdog);
  watchdog = undefined;
  for (const id of [...timers.keys()]) cancel(id);
}
