import type { Request, Response } from 'express';
import type { z } from 'zod';
import * as accounts from '../services/participantAccountService.js';
import type { createParticipantSchema } from '../validation/participantSchemas.js';

/** Host-only (route-guarded). Responses never include passwords or hashes. */
export async function assignableCompetitions(req: Request, res: Response): Promise<void> {
  res.json({ items: await accounts.assignableCompetitions(req.auth!.id) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const result = await accounts.createParticipant(req.body as z.output<typeof createParticipantSchema>, req.auth!.id);
  res.status(201).json(result);
}

/** Route-guarded by host role and ownership of :id. */
export async function resetPassword(req: Request, res: Response): Promise<void> {
  await accounts.resetParticipantPassword(String(req.params.id), String(req.params.studentId), (req.body as { password: string }).password, req.auth!.id);
  res.json({ reset: true });
}
