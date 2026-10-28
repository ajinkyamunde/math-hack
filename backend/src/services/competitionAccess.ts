import { Types } from 'mongoose';
import { Competition } from '../models/Competition.js';
import { forbidden, notFound } from '../utils/errors.js';

/**
 * Confirms that a host created the competition. Participant names, emails, scores and exports are visible only
 * to that host; being signed in as some other host is not enough.
 */
export async function assertCompetitionOwner(competitionId: string, hostId: string): Promise<void> {
  if (!Types.ObjectId.isValid(competitionId)) throw notFound('Competition');
  const competition = await Competition.findById(competitionId).select('createdBy').lean<{ createdBy?: Types.ObjectId }>();
  if (!competition) throw notFound('Competition');
  if (!competition.createdBy || String(competition.createdBy) !== hostId) {
    throw forbidden('Only the host who created this competition can view its participants.');
  }
}
