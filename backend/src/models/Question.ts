import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { DIFFICULTIES, OPTION_KEYS, QUESTION_STATUSES } from '../types/domain.js';

const questionSchema = new Schema(
  {
    questionText: { type: String, required: true, trim: true, maxlength: 2000 },
    options: {
      type: [{ type: String, required: true, trim: true, maxlength: 500 }],
      validate: { validator: (value: string[]) => value.length === 4, message: 'A question needs exactly four options.' },
      required: true,
    },
    correctOption: { type: String, enum: OPTION_KEYS, required: true, select: false },
    difficulty: { type: String, enum: DIFFICULTIES, required: true },
    timeLimitSeconds: { type: Number, required: true, min: 1 },
    points: { type: Number, required: true, min: 0 },
    topic: { type: String, trim: true, maxlength: 100, default: '' },
    explanation: { type: String, trim: true, maxlength: 2000, default: '', select: false },
    tags: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
    status: { type: String, enum: QUESTION_STATUSES, default: 'DRAFT' },
    fingerprint: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Host', required: true },
    importBatchId: { type: Schema.Types.ObjectId, ref: 'ImportBatch' },
    importedBy: { type: Schema.Types.ObjectId, ref: 'Host' },
    importedAt: { type: Date },
  },
  { timestamps: true },
);

questionSchema.index({ status: 1, difficulty: 1, createdAt: -1 });
questionSchema.index({ topic: 1 });
questionSchema.index({ fingerprint: 1 });
questionSchema.index({ questionText: 'text', topic: 'text', tags: 'text' });

questionSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    delete ret.fingerprint;
    return ret;
  },
});

export type QuestionAttrs = InferSchemaType<typeof questionSchema>;
export type QuestionDocument = HydratedDocument<QuestionAttrs>;
export const Question = model('Question', questionSchema);
