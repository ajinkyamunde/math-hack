import { Types, type FilterQuery } from 'mongoose';
import { Competition } from '../models/Competition.js';
import { Question, type QuestionAttrs } from '../models/Question.js';
import { conflict, notFound } from '../utils/errors.js';
import { escapeRegex, questionFingerprint } from '../utils/text.js';
import type { QuestionInput } from '../validation/questionSchemas.js';
import type { z } from 'zod';
import type { questionListQuerySchema } from '../validation/questionSchemas.js';

const HOST_FIELDS = '+correctOption +explanation';
const DIFFICULTY_ORDER = { EASY: 1, MEDIUM: 2, HARD: 3 } as const;

export type QuestionListQuery = z.output<typeof questionListQuerySchema>;

export async function listQuestions(query: QuestionListQuery) {
  const filter: FilterQuery<QuestionAttrs> = {};
  if (query.difficulty) filter.difficulty = query.difficulty;
  if (query.status) filter.status = query.status;
  if (query.topic) filter.topic = new RegExp(`^${escapeRegex(query.topic)}$`, 'i');
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ questionText: pattern }, { topic: pattern }, { tags: pattern }];
  }

  const skip = (query.page - 1) * query.pageSize;
  const baseSort: Record<string, 1 | -1> = query.sort === 'oldest' ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 };

  const [items, total] = await Promise.all([
    query.sort === 'difficulty'
      ? Question.aggregate([
          { $match: filter },
          { $addFields: { _difficultyRank: { $switch: { branches: Object.entries(DIFFICULTY_ORDER).map(([k, v]) => ({ case: { $eq: ['$difficulty', k] }, then: v })), default: 9 } } } },
          { $sort: { _difficultyRank: 1, createdAt: -1, _id: 1 } },
          { $skip: skip },
          { $limit: query.pageSize },
          { $project: { _difficultyRank: 0, fingerprint: 0, __v: 0 } },
        ])
      : Question.find(filter).select(HOST_FIELDS).sort(baseSort).skip(skip).limit(query.pageSize).lean(),
    Question.countDocuments(filter),
  ]);

  return { items: items.map(stripInternal), total, page: query.page, pageSize: query.pageSize };
}

function stripInternal<T extends object>(doc: T): Omit<T, 'fingerprint' | '__v'> {
  const copy = { ...doc } as T & { fingerprint?: string; __v?: number };
  delete copy.fingerprint;
  delete copy.__v;
  return copy;
}

export async function listTopics(): Promise<string[]> {
  const topics = (await Question.distinct('topic')) as string[];
  return topics.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export async function getQuestion(id: string) {
  const question = await Question.findById(id).select(HOST_FIELDS).lean();
  if (!question) throw notFound('Question');
  return stripInternal(question);
}

export async function createQuestion(input: QuestionInput, hostId: string) {
  const question = await Question.create({ ...input, fingerprint: questionFingerprint(input.questionText), createdBy: hostId });
  return getQuestion(question.id);
}

/** Questions in a live competition's queue are locked; the competition plays frozen snapshots, but we refuse edits to avoid confusion. */
async function assertNotLocked(id: string, action: 'edit' | 'delete'): Promise<void> {
  const live = await Competition.findOne({ status: { $in: ['RUNNING', 'PAUSED'] }, 'queue.questionId': new Types.ObjectId(id) })
    .select('name')
    .lean();
  if (live) throw conflict(`This question is in the live competition "${live.name}" and cannot be ${action === 'edit' ? 'edited' : 'deleted'} until it ends.`);
}

export async function updateQuestion(id: string, input: QuestionInput) {
  await assertNotLocked(id, 'edit');
  const updated = await Question.findByIdAndUpdate(
    id,
    { $set: { ...input, fingerprint: questionFingerprint(input.questionText) } },
    { new: true, runValidators: true },
  );
  if (!updated) throw notFound('Question');
  return getQuestion(id);
}

export async function deleteQuestion(id: string): Promise<void> {
  await assertNotLocked(id, 'delete');
  const queued = await Competition.findOne({ status: { $in: ['DRAFT', 'WAITING'] }, 'queue.questionId': new Types.ObjectId(id) })
    .select('name')
    .lean();
  if (queued) throw conflict(`Remove this question from the queue of "${queued.name}" before deleting it.`);
  const result = await Question.deleteOne({ _id: id });
  if (result.deletedCount === 0) throw notFound('Question');
}

export async function duplicateQuestion(id: string, hostId: string) {
  const source = await Question.findById(id).select(HOST_FIELDS).lean();
  if (!source) throw notFound('Question');
  const copy = await Question.create({
    questionText: `${source.questionText} (copy)`.slice(0, 2000),
    options: source.options,
    correctOption: source.correctOption,
    difficulty: source.difficulty,
    timeLimitSeconds: source.timeLimitSeconds,
    points: source.points,
    topic: source.topic,
    explanation: source.explanation,
    tags: source.tags,
    status: 'DRAFT',
    fingerprint: questionFingerprint(`${source.questionText} (copy)`),
    createdBy: hostId,
  });
  return getQuestion(copy.id);
}
