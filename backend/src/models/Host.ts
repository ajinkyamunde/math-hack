import { Schema, model, type InferSchemaType } from 'mongoose';

const hostSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['HOST', 'ADMIN'], default: 'ADMIN' },
    accountStatus: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

hostSchema.index({ email: 1 }, { unique: true });

hostSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export type HostAttrs = InferSchemaType<typeof hostSchema>;
export const Host = model('Host', hostSchema);
