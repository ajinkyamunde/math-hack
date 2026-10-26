import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from 'mongoose';
import {
  COMPETITION_STATUSES,
  DIFFICULTIES,
  OPTION_KEYS,
  PROGRESSION_MODES,
  QUEUE_ITEM_STATUSES,
  type CompetitionStatus,
  type Difficulty,
  type OptionKey,
  type ProgressionMode,
  type QueueItemStatus,
} from '../types/domain.js';

/**
 * A queue item freezes a copy of the question when the competition starts, so later edits
 * in the question bank never change the meaning or scoring of recorded attempts.
 */
const snapshotSchema = new Schema(
  {
    questionText: { type: String, required: true },
    options: { type: [String], required: true },
    correctOption: { type: String, enum: OPTION_KEYS, required: true },
    difficulty: { type: String, enum: DIFFICULTIES, required: true },
    timeLimitSeconds: { type: Number, required: true },
    points: { type: Number, required: true },
    topic: { type: String, default: '' },
    explanation: { type: String, default: '' },
  },
  { _id: false },
);

const queueItemSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    order: { type: Number, required: true },
    status: { type: String, enum: QUEUE_ITEM_STATUSES, default: 'PENDING' },
    snapshot: { type: snapshotSchema },
    publishedAt: { type: Date },
    deadline: { type: Date },
    closedAt: { type: Date },
    closeReason: { type: String, enum: ['TIMER', 'SKIPPED', 'HOST_NEXT', 'COMPETITION_ENDED'] },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    revealAnswers: { type: Boolean, default: true },
    showLeaderboardToStudents: { type: Boolean, default: true },
    completeWhenQueueEmpty: { type: Boolean, default: false },
    pointsOverride: {
      EASY: { type: Number, min: 0 },
      MEDIUM: { type: Number, min: 0 },
      HARD: { type: Number, min: 0 },
    },
  },
  { _id: false },
);

const competitionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Host', required: true },
    durationSeconds: { type: Number, required: true },
    status: { type: String, enum: COMPETITION_STATUSES, default: 'DRAFT' },
    questionProgressionMode: { type: String, enum: PROGRESSION_MODES, default: 'AUTOMATIC' },
    settings: { type: settingsSchema, default: () => ({}) },
    queue: { type: [queueItemSchema], default: [] },
    startedAt: { type: Date },
    pausedAt: { type: Date },
    totalPausedMilliseconds: { type: Number, default: 0 },
    endsAt: { type: Date },
    completedAt: { type: Date },
    completionReason: { type: String, enum: ['TIMER', 'HOST', 'QUEUE_EMPTY', 'CANCELLED'] },
    currentQuestionId: { type: Schema.Types.ObjectId, ref: 'Question' },
    currentQuestionStartedAt: { type: Date },
    currentQuestionDeadline: { type: Date },
    /** Paused time accumulated while the current question was live; subtracted from response times. */
    currentQuestionPausedMs: { type: Number, default: 0 },
    /** Remaining question time captured at pause, for display while paused. */
    pausedQuestionRemainingMs: { type: Number },
    /** Optimistic-concurrency counter: every state transition must match and increment it. */
    stateVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

competitionSchema.index({ status: 1, createdAt: -1 });
competitionSchema.index({ createdBy: 1, createdAt: -1 });
competitionSchema.index({ status: 1, endsAt: 1 });

competitionSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type CompetitionAttrs = InferSchemaType<typeof competitionSchema>;
export type CompetitionDocument = HydratedDocument<CompetitionAttrs>;

/** Plain-object shapes used with .lean() reads. */
export interface QuestionSnapshot {
  questionText: string;
  options: string[];
  correctOption: OptionKey;
  difficulty: Difficulty;
  timeLimitSeconds: number;
  points: number;
  topic: string;
  explanation: string;
}

export interface QueueItem {
  questionId: Types.ObjectId;
  order: number;
  status: QueueItemStatus;
  snapshot?: QuestionSnapshot | null;
  publishedAt?: Date | null;
  deadline?: Date | null;
  closedAt?: Date | null;
  closeReason?: 'TIMER' | 'SKIPPED' | 'HOST_NEXT' | 'COMPETITION_ENDED' | null;
}

export interface CompetitionSettings {
  revealAnswers?: boolean;
  showLeaderboardToStudents?: boolean;
  completeWhenQueueEmpty?: boolean;
  pointsOverride?: Partial<Record<Difficulty, number | null>> | null;
}

export interface CompetitionLean {
  _id: Types.ObjectId;
  name: string;
  description: string;
  createdBy: Types.ObjectId;
  durationSeconds: number;
  status: CompetitionStatus;
  questionProgressionMode: ProgressionMode;
  settings?: CompetitionSettings | null;
  queue: QueueItem[];
  startedAt?: Date | null;
  pausedAt?: Date | null;
  totalPausedMilliseconds: number;
  endsAt?: Date | null;
  completedAt?: Date | null;
  completionReason?: 'TIMER' | 'HOST' | 'QUEUE_EMPTY' | 'CANCELLED' | null;
  currentQuestionId?: Types.ObjectId | null;
  currentQuestionStartedAt?: Date | null;
  currentQuestionDeadline?: Date | null;
  currentQuestionPausedMs?: number | null;
  pausedQuestionRemainingMs?: number | null;
  stateVersion: number;
  createdAt?: Date;
  updatedAt?: Date;
}
export const Competition = model('Competition', competitionSchema);
