import { z } from 'zod';
import { ACADEMIC_YEARS, participantPasswordSchema, prnSchema } from './authSchemas.js';
import { objectId } from './common.js';

export const PARTICIPANT_STATUSES = ['REGISTERED', 'JOINED', 'PLAYING', 'DISCONNECTED', 'COMPLETED', 'CANCELLED'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const optionalText = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => value || undefined);

/** Filters shared by the participant list and its Excel export, so the export matches what the host sees. */
export const participantQuerySchema = z.object({
  search: optionalText,
  status: z.enum(PARTICIPANT_STATUSES).optional(),
  department: optionalText,
  academicYear: z.enum(ACADEMIC_YEARS).optional(),
  /** Also list registered students who have not joined this competition (status REGISTERED). */
  includeRegistered: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  /** IANA time zone for the times written into the Excel export (Excel cells have no zone). Defaults to UTC. */
  tz: z
    .string()
    .max(64)
    .optional()
    .refine((value) => value === undefined || isTimeZone(value), 'Unknown time zone.'),
});

export type ParticipantQuery = z.output<typeof participantQuerySchema>;

/** Host-created participant. PRN is optional: a unique placeholder is generated when it is left blank. */
export const createParticipantSchema = z.object({
  name: z.string().trim().min(2, 'Enter the participant\'s full name.').max(100),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  prn: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), prnSchema.optional()),
  department: z.string().trim().min(2, 'Enter a department or branch.').max(100),
  academicYear: z.enum(ACADEMIC_YEARS, { errorMap: () => ({ message: 'Choose a year of study.' }) }),
  competitionId: z.preprocess((value) => (value === '' || value === null ? undefined : value), objectId.optional()),
  password: participantPasswordSchema,
});

export const resetParticipantPasswordSchema = z.object({ password: participantPasswordSchema });

export const participantParams = z.object({ id: objectId, studentId: objectId });
