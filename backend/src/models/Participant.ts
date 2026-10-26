import { Schema, model, type InferSchemaType } from 'mongoose';

const participantSchema = new Schema(
  {
    competitionId: { type: Schema.Types.ObjectId, ref: 'Competition', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    joinedAt: { type: Date, default: () => new Date() },
    connectionStatus: { type: String, enum: ['ONLINE', 'OFFLINE'], default: 'OFFLINE' },
    activeConnections: { type: Number, default: 0, min: 0 },
    lastSeenAt: { type: Date },
    finalScore: { type: Number },
    finalRank: { type: Number },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

participantSchema.index({ competitionId: 1, studentId: 1 }, { unique: true });
participantSchema.index({ competitionId: 1, connectionStatus: 1 });
participantSchema.index({ studentId: 1, joinedAt: -1 });
participantSchema.index({ competitionId: 1, finalRank: 1 });

export type ParticipantAttrs = InferSchemaType<typeof participantSchema>;
export const Participant = model('Participant', participantSchema);
