import { z } from 'zod';
import { DIFFICULTIES, DIFFICULTY_RULES, MAX_POINTS, OPTION_KEYS, QUESTION_STATUSES } from '../types/domain.js';
import { pagination } from './common.js';

const optionText = z.string().trim().min(1, 'Every option needs text.').max(500, 'Options must be at most 500 characters.');

/** Shared by manual creation and spreadsheet import, so both paths enforce identical rules. */
export const questionInputSchema = z
  .object({
    questionText: z.string().trim().min(3, 'Question text is required.').max(2000, 'Question text must be at most 2000 characters.'),
    options: z.array(optionText).length(4, 'A question needs exactly four options (A, B, C, D).'),
    correctOption: z.enum(OPTION_KEYS, { errorMap: () => ({ message: 'Correct answer must be A, B, C or D.' }) }),
    difficulty: z.enum(DIFFICULTIES, { errorMap: () => ({ message: 'Difficulty must be EASY, MEDIUM or HARD.' }) }),
    timeLimitSeconds: z.coerce.number().int('Time limit must be a whole number of seconds.').optional(),
    points: z.coerce.number().int('Points must be a whole number.').min(1, 'Points must be positive.').max(MAX_POINTS).optional(),
    topic: z.string().trim().max(100).optional().default(''),
    explanation: z.string().trim().max(2000).optional().default(''),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional().default([]),
    status: z.enum(QUESTION_STATUSES).optional().default('DRAFT'),
  })
  .superRefine((data, ctx) => {
    const rule = DIFFICULTY_RULES[data.difficulty];
    if (data.timeLimitSeconds !== undefined && (data.timeLimitSeconds < rule.minSeconds || data.timeLimitSeconds > rule.maxSeconds)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeLimitSeconds'],
        message: `${data.difficulty} questions need a time limit between ${rule.minSeconds} and ${rule.maxSeconds} seconds.`,
      });
    }
    const normalized = data.options.map((option) => option.trim().toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Options must all be different.' });
    }
  })
  .transform((data) => ({
    ...data,
    timeLimitSeconds: data.timeLimitSeconds ?? DIFFICULTY_RULES[data.difficulty].defaultSeconds,
    points: data.points ?? DIFFICULTY_RULES[data.difficulty].defaultPoints,
  }));

export type QuestionInput = z.output<typeof questionInputSchema>;

export const questionListQuerySchema = pagination.extend({
  search: z.string().trim().max(200).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  status: z.enum(QUESTION_STATUSES).optional(),
  topic: z.string().trim().max(100).optional(),
  sort: z.enum(['newest', 'oldest', 'difficulty']).default('newest'),
});

export const importConfirmSchema = z.object({
  batchId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid import batch.'),
  includeDuplicates: z.boolean().optional().default(false),
  status: z.enum(QUESTION_STATUSES).optional().default('ACTIVE'),
});
