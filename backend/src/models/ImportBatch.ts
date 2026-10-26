import { Schema, model, type InferSchemaType } from 'mongoose';

/** Holds a parsed import between preview and confirmation. Expires automatically after one hour. */
const importBatchSchema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: 'Host', required: true },
    originalFilename: { type: String, maxlength: 255 },
    fileType: { type: String, enum: ['csv', 'xlsx'], required: true },
    status: { type: String, enum: ['PREVIEW', 'COMMITTING', 'COMMITTED'], default: 'PREVIEW' },
    totalRows: { type: Number, required: true },
    validRows: { type: [Schema.Types.Mixed], default: [] },
    invalidRows: { type: [Schema.Types.Mixed], default: [] },
    duplicateRows: { type: [Schema.Types.Mixed], default: [] },
    insertedCount: { type: Number, default: 0 },
    committedAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

importBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
importBatchSchema.index({ createdBy: 1, createdAt: -1 });

export type ImportBatchAttrs = InferSchemaType<typeof importBatchSchema>;
export const ImportBatch = model('ImportBatch', importBatchSchema);
