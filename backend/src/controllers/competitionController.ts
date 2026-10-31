import type { Request, Response } from 'express';
import * as competitions from '../services/competitionService.js';
import { submitAnswer } from '../services/scoringService.js';
import type { OptionKey } from '../types/domain.js';

const id = (req: Request): string => String(req.params.id);
const actor = (req: Request): string => req.auth!.id;

export async function create(req: Request, res: Response): Promise<void> {
  res.status(201).json({ competition: await competitions.createCompetition(req.body, actor(req)) });
}

export async function list(req: Request, res: Response): Promise<void> {
  const auth = req.auth!;
  const query = req.query as unknown as { page: number; pageSize: number; status?: string };
  res.json(await competitions.listCompetitions(auth.role, query, auth.role === 'student' ? auth.id : undefined));
}

/** Hosts get the full control view; students get the sanitized live state (also the HTTP fallback for sockets). */
export async function get(req: Request, res: Response): Promise<void> {
  const auth = req.auth!;
  const competition = auth.role === 'host' ? await competitions.hostState(id(req)) : await competitions.studentState(id(req), auth.id);
  res.json({ competition });
}

export async function update(req: Request, res: Response): Promise<void> {
  res.json({ competition: await competitions.updateCompetition(id(req), req.body, actor(req)) });
}

export async function setQueue(req: Request, res: Response): Promise<void> {
  res.json({ competition: await competitions.setQueue(id(req), (req.body as { questionIds: string[] }).questionIds, actor(req)) });
}

export async function setDirectQuestions(req: Request, res: Response): Promise<void> {
  const body = req.body as { questions: any[] };
  res.json({ competition: await competitions.setDirectQuestions(id(req), body.questions, actor(req)) });
}

export async function join(req: Request, res: Response): Promise<void> {
  res.json({ competition: await competitions.joinCompetition(id(req), actor(req)) });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const body = req.body as { questionId: string; selectedOption: OptionKey };
  const result = await submitAnswer({ competitionId: id(req), studentId: actor(req), ...body });
  res.status(result.alreadySubmitted ? 200 : 201).json({ submission: result });
}

const command =
  (action: (competitionId: string, hostId: string, questionId?: string) => Promise<unknown>) =>
  async (req: Request, res: Response): Promise<void> => {
    const questionId = (req.body as { questionId?: string } | undefined)?.questionId;
    res.json({ competition: await action(id(req), actor(req), questionId) });
  };

export const open = command(competitions.openRegistration);
export const start = command(competitions.startCompetition);
export const pause = command(competitions.pauseCompetition);
export const resume = command(competitions.resumeCompetition);
export const publish = command(competitions.publishQuestion);
export const skip = command(competitions.skipQuestion);
export const end = command(competitions.endCompetition);
export const cancel = command(competitions.cancelCompetition);
