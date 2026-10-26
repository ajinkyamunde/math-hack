import type { Request, Response } from 'express';
import * as questions from '../services/questionService.js';
import type { QuestionInput } from '../validation/questionSchemas.js';

const hostId = (req: Request): string => req.auth!.id;
const idParam = (req: Request): string => String(req.params.id);

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await questions.listQuestions(req.query as unknown as questions.QuestionListQuery));
}

export async function topics(_req: Request, res: Response): Promise<void> {
  res.json({ topics: await questions.listTopics() });
}

export async function get(req: Request, res: Response): Promise<void> {
  res.json({ question: await questions.getQuestion(idParam(req)) });
}

export async function create(req: Request, res: Response): Promise<void> {
  res.status(201).json({ question: await questions.createQuestion(req.body as QuestionInput, hostId(req)) });
}

export async function update(req: Request, res: Response): Promise<void> {
  res.json({ question: await questions.updateQuestion(idParam(req), req.body as QuestionInput) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await questions.deleteQuestion(idParam(req));
  res.status(204).end();
}

export async function duplicate(req: Request, res: Response): Promise<void> {
  res.status(201).json({ question: await questions.duplicateQuestion(idParam(req), hostId(req)) });
}
