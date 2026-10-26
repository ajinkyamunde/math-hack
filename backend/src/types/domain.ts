export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export const QUESTION_STATUSES = ['DRAFT', 'ACTIVE'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const COMPETITION_STATUSES = ['DRAFT', 'WAITING', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

export const PROGRESSION_MODES = ['AUTOMATIC', 'MANUAL'] as const;
export type ProgressionMode = (typeof PROGRESSION_MODES)[number];

export const QUEUE_ITEM_STATUSES = ['PENDING', 'LIVE', 'CLOSED', 'SKIPPED'] as const;
export type QueueItemStatus = (typeof QUEUE_ITEM_STATUSES)[number];

export type Role = 'student' | 'host';

export interface AuthUser {
  id: string;
  role: Role;
}

/** Per-difficulty timing rules (section 10 of the specification). */
export const DIFFICULTY_RULES: Record<Difficulty, { defaultSeconds: number; minSeconds: number; maxSeconds: number; defaultPoints: number }> = {
  EASY: { defaultSeconds: 25, minSeconds: 20, maxSeconds: 30, defaultPoints: 10 },
  MEDIUM: { defaultSeconds: 300, minSeconds: 300, maxSeconds: 360, defaultPoints: 20 },
  HARD: { defaultSeconds: 900, minSeconds: 720, maxSeconds: 900, defaultPoints: 30 },
};

export const MAX_POINTS = 1000;
export const DEFAULT_COMPETITION_SECONDS = 30 * 60;
export const MIN_COMPETITION_SECONDS = 60;
export const MAX_COMPETITION_SECONDS = 6 * 60 * 60;
