import type { Request, Response } from 'express';
import { Host } from '../models/Host.js';
import { recordAudit } from '../services/auditService.js';
import { buildParticipantView, participantExportFilename, writeParticipantWorkbook } from '../services/participantService.js';
import type { ParticipantQuery } from '../validation/participantSchemas.js';

const id = (req: Request): string => String(req.params.id);

/** Host-only (route-guarded by role and competition ownership). */
export async function list(req: Request, res: Response): Promise<void> {
  const view = await buildParticipantView(id(req), req.query as unknown as ParticipantQuery);
  res.setHeader('Cache-Control', 'no-store');
  res.json(view);
}

/** Host-only Excel export of the same filtered list the host is looking at. */
export async function exportXlsx(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ParticipantQuery;
  const [view, host] = await Promise.all([buildParticipantView(id(req), query), Host.findById(req.auth!.id).select('email').lean()]);
  await recordAudit({
    actorId: req.auth!.id,
    actorRole: 'host',
    action: 'participants.export',
    competitionId: id(req),
    details: { format: 'xlsx', rows: view.rows.length },
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${participantExportFilename(view)}"`);
  res.setHeader('Cache-Control', 'no-store');
  await writeParticipantWorkbook(view, query, host?.email ?? 'host', res);
  res.end();
}
