import { Schema, model } from 'mongoose';

/** Optional official roster. When ROSTER_ENFORCED=true, registration must match a PRN + email pair here. */
const rosterEntrySchema = new Schema(
  {
    prn: { type: String, required: true, uppercase: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, trim: true, default: '' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'Host', required: true },
  },
  { timestamps: true },
);

rosterEntrySchema.index({ prn: 1 }, { unique: true });

export const RosterEntry = model('RosterEntry', rosterEntrySchema);
