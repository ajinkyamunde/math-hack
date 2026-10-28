import type { Server, Socket } from 'socket.io';
import { z, type ZodTypeAny } from 'zod';
import { Participant } from '../models/Participant.js';
import { assertCompetitionOwner } from '../services/competitionAccess.js';
import * as competitions from '../services/competitionService.js';
import { submitAnswer } from '../services/scoringService.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { objectId } from '../validation/common.js';
import { submitAnswerSchema } from '../validation/competitionSchemas.js';
import { broadcaster, rooms } from './broadcaster.js';
import type { SocketData } from './socketAuth.js';

type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string } }) => void;

const competitionRef = z.object({ competitionId: objectId });
const hostCommand = competitionRef.extend({ questionId: objectId.optional() });

/** Tiny per-socket token bucket so one client cannot flood the engine. */
function rateLimiter(capacity: number, refillPerSecond: number) {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

function toAckError(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  logger.error('Socket handler error', { error });
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };
}

export function registerCompetitionEvents(io: Server, socket: Socket): void {
  const data = socket.data as SocketData;
  const user = data.user;
  const allow = rateLimiter(10, 5);

  /** Wraps a handler with payload validation, rate limiting, role checks and a uniform ack. */
  function on<S extends ZodTypeAny>(event: string, schema: S, role: 'host' | 'student' | 'any', handler: (payload: z.output<S>) => Promise<unknown>) {
    socket.on(event, async (payload: unknown, maybeAck?: unknown) => {
      const ack: Ack = typeof maybeAck === 'function' ? (maybeAck as Ack) : () => undefined;
      try {
        if (!allow()) throw new AppError(429, 'RATE_LIMITED', 'Too many actions. Please slow down.');
        if (role !== 'any' && user.role !== role) throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do that.');
        const parsed = schema.safeParse(payload ?? {});
        if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.');
        ack({ ok: true, data: await handler(parsed.data) });
      } catch (error) {
        const body = toAckError(error);
        ack({ ok: false, error: body });
        socket.emit('error', body);
      }
    });
  }

  on('competition:join', competitionRef, 'any', async ({ competitionId }) => {
    if (user.role === 'host') {
      // The host room streams the full leaderboard (names, PRNs), so only the owning host may join it.
      await assertCompetitionOwner(competitionId, user.id);
      const state = await competitions.hostState(competitionId);
      await socket.join(rooms.hosts(competitionId));
      data.joined.add(competitionId);
      return state;
    }
    // Room membership is granted only after the server confirms the participant record.
    await competitions.assertParticipant(competitionId, user.id);
    await socket.join(rooms.competition(competitionId));
    if (!data.joined.has(competitionId)) {
      data.joined.add(competitionId);
      await Participant.updateOne(
        { competitionId, studentId: user.id },
        { $inc: { activeConnections: 1 }, $set: { connectionStatus: 'ONLINE', lastSeenAt: new Date() } },
      );
      await notifyConnections(competitionId);
    }
    return competitions.studentState(competitionId, user.id);
  });

  on('competition:leave', competitionRef, 'any', async ({ competitionId }) => {
    await leave(competitionId);
    return null;
  });

  on('question:submit', submitAnswerSchema.extend({ competitionId: objectId }), 'student', async ({ competitionId, questionId, selectedOption }) =>
    submitAnswer({ competitionId, studentId: user.id, questionId, selectedOption }),
  );

  on('host:publish-question', hostCommand, 'host', ({ competitionId, questionId }) => competitions.publishQuestion(competitionId, user.id, questionId));
  on('host:pause', competitionRef, 'host', ({ competitionId }) => competitions.pauseCompetition(competitionId, user.id));
  on('host:resume', competitionRef, 'host', ({ competitionId }) => competitions.resumeCompetition(competitionId, user.id));
  on('host:skip', hostCommand, 'host', ({ competitionId, questionId }) => competitions.skipQuestion(competitionId, user.id, questionId));
  on('host:end', competitionRef, 'host', ({ competitionId }) => competitions.endCompetition(competitionId, user.id));

  async function leave(competitionId: string): Promise<void> {
    if (!data.joined.delete(competitionId)) return;
    await socket.leave(rooms.competition(competitionId));
    await socket.leave(rooms.hosts(competitionId));
    if (user.role !== 'student') return;
    await Participant.updateOne({ competitionId, studentId: user.id }, { $inc: { activeConnections: -1 }, $set: { lastSeenAt: new Date() } });
    await Participant.updateOne({ competitionId, studentId: user.id, activeConnections: { $lte: 0 } }, { $set: { connectionStatus: 'OFFLINE', activeConnections: 0 } });
    await notifyConnections(competitionId);
  }

  socket.on('disconnect', () => {
    for (const competitionId of [...data.joined]) {
      leave(competitionId).catch((error: unknown) => logger.warn('Failed to record disconnect', { competitionId, error }));
    }
  });

  async function notifyConnections(competitionId: string): Promise<void> {
    const connected = await broadcaster().connectedStudentIds(competitionId);
    io.to(rooms.hosts(competitionId)).emit('participant:connection', { competitionId, connected: connected.length });
  }
}
