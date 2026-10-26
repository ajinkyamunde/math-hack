import type { Request, Response } from 'express';
import * as importer from '../services/questionImportService.js';
import { buildCsvTemplate, buildXlsxTemplate } from '../services/templateService.js';
import { badRequest } from '../utils/errors.js';
import type { z } from 'zod';
import type { importConfirmSchema } from '../validation/questionSchemas.js';
import { recordAudit } from '../services/auditService.js';

export async function preview(req: Request, res: Response): Promise<void> {
  if (!req.file) throw badRequest('Attach a .xlsx or .csv file in the "file" field.');
  res.json(await importer.previewImport(req.file, req.auth!.id));
}

export async function confirm(req: Request, res: Response): Promise<void> {
  const body = req.body as z.output<typeof importConfirmSchema>;
  const result = await importer.confirmImport(body.batchId, req.auth!.id, body);
  await recordAudit({ actorId: req.auth!.id, actorRole: 'host', action: 'questions.import', details: { batchId: body.batchId, ...result } });
  res.status(201).json(result);
}

export async function errorReport(req: Request, res: Response): Promise<void> {
  const csv = await importer.errorReportCsv(String(req.params.batchId), req.auth!.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mathhack-import-errors.csv"');
  res.send(csv);
}

export function csvTemplate(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mathhack-question-template.csv"');
  res.send(buildCsvTemplate());
}

export async function xlsxTemplate(_req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="mathhack-question-template.xlsx"');
  res.send(await buildXlsxTemplate());
}
