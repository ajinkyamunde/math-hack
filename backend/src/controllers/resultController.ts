import type { Request, Response } from 'express';
import { buildCompetitionAnalytics, summarize } from '../services/analyticsService.js';
import { assertParticipant, loadCompetition } from '../services/competitionService.js';
import { computeLeaderboard, publicLeaderboard } from '../services/leaderboardService.js';
import * as exporter from '../services/exportService.js';
import { invalidState, notFound } from '../utils/errors.js';
import { recordAudit } from '../services/auditService.js';

const id = (req: Request): string => String(req.params.id);

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

export async function leaderboard(req: Request, res: Response): Promise<void> {
  const auth = req.auth!;
  const competition = await loadCompetition(id(req));
  const entries = await computeLeaderboard(competition._id);
  if (auth.role === 'host') {
    res.json({ entries, total: entries.length });
    return;
  }
  // Participants must not see rankings, leaderboard, or other participants' scores
  res.json({
    entries: [],
    total: 0,
    me: null,
  });
}

/** Hosts see every participant; a student sees only their own 4 metrics once the competition is over. */
export async function results(req: Request, res: Response): Promise<void> {
  const auth = req.auth!;
  const analytics = await buildCompetitionAnalytics(id(req));
  if (auth.role === 'host') {
    res.json({ summary: summarize(analytics), students: analytics.students });
    return;
  }
  await assertParticipant(id(req), auth.id);
  if (analytics.competition.status !== 'COMPLETED') throw invalidState('Results are available after the competition ends.');
  const me = analytics.students.find((student) => student.studentId === auth.id);
  if (!me) throw notFound('Your result');
  // Requirement 1: Participants only see total attempted, correct, incorrect, and unanswered.
  res.json({
    summary: { name: analytics.competition.name },
    me: {
      attempted: me.attempted,
      correct: me.correct,
      incorrect: me.incorrect,
      unanswered: me.unanswered,
    },
  });
}

export async function analytics(req: Request, res: Response): Promise<void> {
  const data = await buildCompetitionAnalytics(id(req));
  res.json({ summary: summarize(data), questions: data.questions, difficulty: data.difficulty });
}

export async function exportXlsx(req: Request, res: Response): Promise<void> {
  const data = await buildCompetitionAnalytics(id(req));
  await recordAudit({ actorId: req.auth!.id, actorRole: 'host', action: 'results.export', competitionId: id(req), details: { format: 'xlsx' } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${exporter.exportFilename(data, 'results', 'xlsx')}"`);
  res.setHeader('Cache-Control', 'no-store');
  await exporter.writeResultsWorkbook(data, res);
  res.end();
}

export async function exportCsv(req: Request, res: Response): Promise<void> {
  const type = exporter.parseCsvType(req.query.type);
  const data = await buildCompetitionAnalytics(id(req));
  await recordAudit({ actorId: req.auth!.id, actorRole: 'host', action: 'results.export', competitionId: id(req), details: { format: 'csv', type } });
  sendCsv(res, exporter.exportFilename(data, type, 'csv'), exporter.csvExport(data, type));
}

/** Individual report: hosts may fetch any participant's; a student only their own, after completion. */
export async function studentReport(req: Request, res: Response): Promise<void> {
  const auth = req.auth!;
  const studentId = auth.role === 'host' ? String(req.params.studentId) : auth.id;
  const data = await buildCompetitionAnalytics(id(req));
  if (auth.role === 'student') {
    await assertParticipant(id(req), auth.id);
    if (data.competition.status !== 'COMPLETED') throw invalidState('Your report is available after the competition ends.');
  }
  const prn = data.students.find((s) => s.studentId === studentId)?.prn ?? 'student';
  sendCsv(res, exporter.exportFilename(data, `report-${prn}`, 'csv'), exporter.studentReportCsv(data, studentId, auth.role === 'student'));
}
