import { Schema, model } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, required: false },
    actorRole: { type: String, enum: ['host', 'student', 'system'], required: true },
    action: { type: String, required: true, maxlength: 80 },
    competitionId: { type: Schema.Types.ObjectId, ref: 'Competition' },
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ competitionId: 1, createdAt: 1 });
auditLogSchema.index({ createdAt: -1 });

export const AuditLog = model('AuditLog', auditLogSchema);
