import type { NextFunction, Request, Response } from 'express';
import { assertCompetitionOwner } from '../services/competitionAccess.js';
import { unauthenticated } from '../utils/errors.js';

/**
 * Route guard for `/:id` competition routes that expose participant data.
 * Hosts must own the competition. Students fall through unchanged, because the shared routes
 * (leaderboard, results) already limit students to their own data in the controller.
 */
export async function authorizeCompetitionOwner(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) throw unauthenticated();
  if (req.auth.role === 'host') await assertCompetitionOwner(String(req.params.id), req.auth.id);
  next();
}
