import { Schema, model, type InferSchemaType } from 'mongoose';
import { DIFFICULTIES, OPTION_KEYS } from '../types/domain.js';

const attemptSchema = new Schema(
  {
    competitionId: { type: Schema.Types.ObjectId, ref: 'Competition', required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    difficulty: { type: String, enum: DIFFICULTIES, required: true },
    selectedOption: { type: String, enum: [...OPTION_KEYS, null], default: null },
    isCorrect: { type: Boolean, required: true },
    /** Server-measured; null for timeouts so unanswered questions never count as 0 ms responses. */
    responseTimeMs: { type: Number, default: null },
    pointsAwarded: { type: Number, required: true, min: 0 },
    submittedAt: { type: Date },
    timedOut: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One scored record per student per question per competition: the database rejects duplicates.
attemptSchema.index({ competitionId: 1, questionId: 1, studentId: 1 }, { unique: true });
attemptSchema.index({ competitionId: 1, studentId: 1 });
attemptSchema.index({ competitionId: 1, questionId: 1, timedOut: 1 });
attemptSchema.index({ studentId: 1, createdAt: -1 });

export type AttemptAttrs = InferSchemaType<typeof attemptSchema>;
export const Attempt = model('Attempt', attemptSchema);
