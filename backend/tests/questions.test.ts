import { describe, expect, it } from 'vitest';
import { createOpenCompetition, loginHost, questionPayload, useTestDatabase } from './helpers.js';

const getApp = useTestDatabase();

describe('question CRUD', () => {
  it('creates a valid MCQ and applies difficulty defaults', async () => {
    const host = await loginHost(getApp());
    const res = await host.post('/api/questions', {
      questionText: 'What is 25% of 240?',
      options: ['40', '50', '60', '80'],
      correctOption: 'C',
      difficulty: 'MEDIUM',
    });
    expect(res.status).toBe(201);
    expect(res.body.question).toMatchObject({ difficulty: 'MEDIUM', timeLimitSeconds: 300, points: 20, status: 'DRAFT', correctOption: 'C' });
  });

  it.each([
    ['missing options', { options: ['1', '2', '3'] }, 'options'],
    ['invalid correct option', { correctOption: 'E' }, 'correctOption'],
    ['invalid difficulty', { difficulty: 'IMPOSSIBLE' }, 'difficulty'],
    ['EASY timer out of range', { difficulty: 'EASY', timeLimitSeconds: 45 }, 'timeLimitSeconds'],
    ['HARD timer out of range', { difficulty: 'HARD', timeLimitSeconds: 600 }, 'timeLimitSeconds'],
    ['MEDIUM timer out of range', { difficulty: 'MEDIUM', timeLimitSeconds: 299 }, 'timeLimitSeconds'],
    ['negative points', { points: -5 }, 'points'],
    ['duplicate options', { options: ['1', '1', '3', '4'] }, 'options'],
    ['empty question', { questionText: '' }, 'questionText'],
  ])('rejects %s', async (_label, override, field) => {
    const host = await loginHost(getApp());
    const res = await host.post('/api/questions', questionPayload(override));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('reads, updates, duplicates and deletes a question', async () => {
    const host = await loginHost(getApp());
    const created = await host.post('/api/questions', questionPayload({ questionText: 'Original question?' }));
    const id = created.body.question._id;

    const fetched = await host.get(`/api/questions/${id}`);
    expect(fetched.body.question.explanation).toBe('Because.');

    const updated = await host.put(`/api/questions/${id}`, questionPayload({ questionText: 'Edited question?', difficulty: 'HARD', timeLimitSeconds: 800 }));
    expect(updated.status).toBe(200);
    expect(updated.body.question).toMatchObject({ questionText: 'Edited question?', difficulty: 'HARD', timeLimitSeconds: 800, points: 10 });

    const copy = await host.post(`/api/questions/${id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body.question.questionText).toBe('Edited question? (copy)');
    expect(copy.body.question.status).toBe('DRAFT');

    expect((await host.del(`/api/questions/${id}`)).status).toBe(204);
    expect((await host.get(`/api/questions/${id}`)).status).toBe(404);
  });

  it('searches, filters and paginates', async () => {
    const host = await loginHost(getApp());
    await host.post('/api/questions', questionPayload({ questionText: 'Derivative of x squared?', difficulty: 'MEDIUM', timeLimitSeconds: 300, topic: 'Calculus' }));
    await host.post('/api/questions', questionPayload({ questionText: 'Integral of 2x?', difficulty: 'HARD', timeLimitSeconds: 900, topic: 'Calculus', status: 'DRAFT' }));
    await host.post('/api/questions', questionPayload({ questionText: 'Probability of heads?', topic: 'Probability' }));

    expect((await host.get('/api/questions?search=integral')).body.total).toBe(1);
    expect((await host.get('/api/questions?topic=calculus')).body.total).toBe(2);
    expect((await host.get('/api/questions?difficulty=HARD')).body.total).toBe(1);
    expect((await host.get('/api/questions?status=DRAFT')).body.total).toBe(1);
    const page = await host.get('/api/questions?page=2&pageSize=2');
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(3);
    expect((await host.get('/api/questions/topics')).body.topics).toEqual(['Calculus', 'Probability']);
    expect((await host.get('/api/questions?search=(unclosed[')).status).toBe(200);
  });

  it('locks questions used by a live competition', async () => {
    const host = await loginHost(getApp());
    const q = await host.post('/api/questions', questionPayload());
    const id = q.body.question._id;
    const competitionId = await createOpenCompetition(host, [id], { questionProgressionMode: 'MANUAL' });
    expect((await host.del(`/api/questions/${id}`)).status).toBe(409); // queued in a waiting competition
    await host.post(`/api/competitions/${competitionId}/start`);
    expect((await host.put(`/api/questions/${id}`, questionPayload())).status).toBe(409);
    expect((await host.del(`/api/questions/${id}`)).status).toBe(409);
    await host.post(`/api/competitions/${competitionId}/end`);
    expect((await host.put(`/api/questions/${id}`, questionPayload({ questionText: 'Changed later?' }))).status).toBe(200);
  });
});
