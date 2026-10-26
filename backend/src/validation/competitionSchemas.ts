import { z } from 'zod';
import { DEFAULT_COMPETITION_SECONDS, MAX_COMPETITION_SECONDS, MAX_POINTS, MIN_COMPETITION_SECONDS, OPTION_KEYS, PROGRESSION_MODES } from '../types/domain.js';
import { objectId, pagination } from './common.js';

const pointsValue = z.coerce.number().int().min(0).max(MAX_POINTS);

export const competitionSettingsSchema = z.object({
  revealAnswers: z.boolean().optional(),
  showLeaderboardToStudents: z.boolean().optional(),
  completeWhenQueueEmpty: z.boolean().optional(),
  pointsOverride: z.object({ EASY: pointsValue.optional(), MEDIUM: pointsValue.optional(), HARD: pointsValue.optional() }).optional(),
});

export const createCompetitionSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters.').max(120),
  description: z.string().trim().max(1000).optional().default(''),
  durationSeconds: z.coerce
    .number()
    .int()
    .min(MIN_COMPETITION_SECONDS, `Duration must be at least ${MIN_COMPETITION_SECONDS / 60} minute.`)
    .max(MAX_COMPETITION_SECONDS, `Duration must be at most ${MAX_COMPETITION_SECONDS / 3600} hours.`)
    .default(DEFAULT_COMPETITION_SECONDS),
  questionProgressionMode: z.enum(PROGRESSION_MODES).default('AUTOMATIC'),
  settings: competitionSettingsSchema.optional().default({}),
  questionIds: z.array(objectId).max(500).optional().default([]),
});

export const updateCompetitionSchema = createCompetitionSchema
  .omit({ questionIds: true })
  .partial()
  .extend({ settings: competitionSettingsSchema.optional() });

export const setQueueSchema = z.object({
  questionIds: z
    .array(objectId)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'A question can appear only once in the queue.'),
});

export const publishSchema = z.object({ questionId: objectId.optional() });

export const submitAnswerSchema = z.object({
  questionId: objectId,
  selectedOption: z.enum(OPTION_KEYS, { errorMap: () => ({ message: 'Choose option A, B, C or D.' }) }),
});

export const competitionListQuerySchema = pagination.extend({
  status: z.enum(['DRAFT', 'WAITING', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED']).optional(),
});
