import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { getEnv } from '../config/environment.js';
import { Competition } from '../models/Competition.js';
import { Participant } from '../models/Participant.js';
import { RosterEntry } from '../models/RosterEntry.js';
import { Student } from '../models/Student.js';
import { broadcaster } from '../sockets/broadcaster.js';
import type { CompetitionStatus } from '../types/domain.js';
import { badRequest, forbidden, invalidState, isDuplicateKeyError, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { normalizeEmail } from '../utils/text.js';
import type { createParticipantSchema } from '../validation/participantSchemas.js';
import { recordAudit } from './auditService.js';
import { createStudentAccount, setStudentPassword } from './authService.js';

type CreateParticipantInput = z.output<typeof createParticipantSchema>;

/** Competitions a host may still add people to. Finished or cancelled ones are closed. */
export const ASSIGNABLE_STATUSES: CompetitionStatus[] = ['DRAFT', 'WAITING', 'RUNNING', 'PAUSED'];

/** The host's own competitions that can take new participants, for the "Competition" dropdown. */
export async function assignableCompetitions(hostId: string) {
  const items = await Competition.find({ createdBy: hostId, status: { $in: ASSIGNABLE_STATUSES } })
    .select('name status createdAt')
    .sort({ createdAt: -1 })
    .lean<{ _id: Types.ObjectId; name: string; status: CompetitionStatus }[]>();
  return items.map((c) => ({ id: String(c._id), name: c.name, status: c.status }));
}

/** Uses the existing ALLOWED_EMAIL_DOMAINS setting when it is configured; empty means any domain. */
export function assertAllowedEmailDomain(email: string): void {
  const allowed = getEnv().ALLOWED_EMAIL_DOMAINS;
  if (!allowed.length) return;
  const domain = normalizeEmail(email).split('@')[1] ?? '';
  if (!allowed.includes(domain)) {
    const message = `Use an email address from ${allowed.map((d) => `@${d}`).join(' or ')}.`;
    throw badRequest(message, [{ field: 'email', message }]);
  }
}

const PRN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A unique placeholder PRN (e.g. MH7Q2K9XPA) for participants added without one. */
async function generatePrn(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const prn = `MH${[...randomBytes(8)].map((b) => PRN_ALPHABET[b % PRN_ALPHABET.length]).join('')}`;
    if (!(await Student.exists({ prn }))) return prn;
  }
  throw new Error('Could not generate a unique PRN');
}

async function loadAssignableCompetition(competitionId: string, hostId: string) {
  const competition = await Competition.findById(competitionId).select('createdBy status name').lean<{
    _id: Types.ObjectId;
    createdBy?: Types.ObjectId;
    status: CompetitionStatus;
    name: string;
  }>();
  if (!competition) throw notFound('Competition');
  if (!competition.createdBy || String(competition.createdBy) !== hostId) {
    throw forbidden('You can only add participants to competitions you created.');
  }
  if (!ASSIGNABLE_STATUSES.includes(competition.status)) {
    throw invalidState('This competition has ended, so participants can no longer be added to it.');
  }
  return competition;
}

/**
 * Creates a student account on the participant's behalf (no email verification) through the same code path as
 * self-registration, and optionally adds them to one of the host's competitions.
 */
export async function createParticipant(input: CreateParticipantInput, hostId: string) {
  assertAllowedEmailDomain(input.email);
  // Check the competition before creating anything, so a bad assignment leaves no stray account.
  const competition = input.competitionId ? await loadAssignableCompetition(input.competitionId, hostId) : null;

  const generatedPrn = !input.prn;
  const prn = input.prn ?? (await generatePrn());
  const email = normalizeEmail(input.email);
  const roster = getEnv().ROSTER_ENFORCED ? await RosterEntry.findOne({ prn }).lean() : null;

  const student = await createStudentAccount(
    {
      name: input.name,
      prn,
      email,
      department: input.department,
      academicYear: input.academicYear,
      rosterVerified: Boolean(roster && roster.email === email),
    },
    input.password,
  );

  if (competition) {
    try {
      await Participant.create({ competitionId: competition._id, studentId: student._id });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        // Undo the account so the host can simply try again.
        await Student.deleteOne({ _id: student._id }).catch((cleanupError: unknown) =>
          logger.error('Failed to roll back participant account', { studentId: student.id, error: cleanupError }),
        );
        throw error;
      }
    }
    const id = String(competition._id);
    broadcaster().toHosts(id, 'participant:joined', { competitionId: id, participantCount: await Participant.countDocuments({ competitionId: competition._id }) });
  }

  await recordAudit({
    actorId: hostId,
    actorRole: 'host',
    action: 'participant.create',
    competitionId: competition ? String(competition._id) : undefined,
    details: { studentId: student.id, generatedPrn },
  });

  return {
    participant: student.toJSON(),
    competition: competition ? { id: String(competition._id), name: competition.name } : null,
    generatedPrn,
  };
}

/**
 * Host password reset for a participant of a competition the host owns (ownership is checked by the route).
 * The host never sees the old password; they can only set a new one.
 */
export async function resetParticipantPassword(competitionId: string, studentId: string, password: string, hostId: string): Promise<void> {
  if (!(await Participant.exists({ competitionId, studentId }))) throw notFound('Participant');
  if (!(await setStudentPassword(studentId, password))) throw notFound('Participant');
  await recordAudit({ actorId: hostId, actorRole: 'host', action: 'participant.password_reset', competitionId, details: { studentId } });
}
