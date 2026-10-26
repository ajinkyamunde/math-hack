import type { Request, Response } from 'express';
import * as students from '../services/studentService.js';
import { badRequest } from '../utils/errors.js';
import { getEnv } from '../config/environment.js';
import { recordAudit } from '../services/auditService.js';

type PageQuery = { page: number; pageSize: number; search?: string };

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await students.listStudents(req.query as unknown as PageQuery));
}

export async function history(req: Request, res: Response): Promise<void> {
  res.json(await students.studentHistory(req.auth!.id, req.query as unknown as PageQuery));
}

export async function uploadRoster(req: Request, res: Response): Promise<void> {
  if (!req.file) throw badRequest('Attach the roster CSV in the "file" field.');
  if (!req.file.originalname.toLowerCase().endsWith('.csv')) throw badRequest('The roster must be a .csv file.');
  const result = await students.importRoster(req.file.buffer, req.auth!.id);
  await recordAudit({ actorId: req.auth!.id, actorRole: 'host', action: 'roster.import', details: { imported: result.imported } });
  res.status(201).json(result);
}

export async function rosterStatus(_req: Request, res: Response): Promise<void> {
  res.json({ entries: await students.rosterSize(), enforced: getEnv().ROSTER_ENFORCED });
}
