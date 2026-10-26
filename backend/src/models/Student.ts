import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const studentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    prn: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    department: { type: String, required: true, trim: true, maxlength: 100 },
    academicYear: { type: String, required: true, enum: ['FE', 'SE', 'TE', 'BE', 'PG1', 'PG2'] },
    passwordHash: { type: String, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
    rosterVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpiresAt: { type: Date, select: false },
    accountStatus: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

studentSchema.index({ prn: 1 }, { unique: true });
studentSchema.index({ email: 1 }, { unique: true });
studentSchema.index({ department: 1, academicYear: 1 });

studentSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    delete ret.emailVerificationTokenHash;
    delete ret.emailVerificationExpiresAt;
    delete ret.__v;
    return ret;
  },
});

export type StudentAttrs = InferSchemaType<typeof studentSchema>;
export type StudentDocument = HydratedDocument<StudentAttrs>;
export const Student = model('Student', studentSchema);
