import { Router } from 'express';
import * as competitions from '../controllers/competitionController.js';
import * as results from '../controllers/resultController.js';
import { authenticate, requireStudent } from '../middleware/authenticate.js';
import { authorizeHost } from '../middleware/authorizeHost.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { idParams, objectId } from '../validation/common.js';
import {
  competitionListQuerySchema,
  createCompetitionSchema,
  publishSchema,
  setQueueSchema,
  submitAnswerSchema,
  updateCompetitionSchema,
} from '../validation/competitionSchemas.js';
import { z } from 'zod';

export function competitionRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  const params = validateRequest({ params: idParams });
  const hostCommand = [authorizeHost, validateRequest({ params: idParams, body: publishSchema })];

  router.get('/', validateRequest({ query: competitionListQuerySchema }), competitions.list);
  router.post('/', authorizeHost, validateRequest({ body: createCompetitionSchema }), competitions.create);
  router.get('/:id', params, competitions.get);
  router.get('/:id/state', params, competitions.get);
  router.patch('/:id', authorizeHost, validateRequest({ params: idParams, body: updateCompetitionSchema }), competitions.update);
  router.put('/:id/queue', authorizeHost, validateRequest({ params: idParams, body: setQueueSchema }), competitions.setQueue);

  router.post('/:id/join', requireStudent, params, competitions.join);
  router.post('/:id/answers', requireStudent, validateRequest({ params: idParams, body: submitAnswerSchema }), competitions.submit);

  router.post('/:id/open', ...hostCommand, competitions.open);
  router.post('/:id/start', ...hostCommand, competitions.start);
  router.post('/:id/pause', ...hostCommand, competitions.pause);
  router.post('/:id/resume', ...hostCommand, competitions.resume);
  router.post('/:id/publish', ...hostCommand, competitions.publish);
  router.post('/:id/skip', ...hostCommand, competitions.skip);
  router.post('/:id/end', ...hostCommand, competitions.end);
  router.post('/:id/cancel', ...hostCommand, competitions.cancel);

  router.get('/:id/leaderboard', params, results.leaderboard);
  router.get('/:id/results', params, results.results);
  router.get('/:id/analytics', authorizeHost, params, results.analytics);
  router.get('/:id/export.xlsx', authorizeHost, params, results.exportXlsx);
  router.get('/:id/export.csv', authorizeHost, params, results.exportCsv);
  router.get('/:id/my-report.csv', requireStudent, params, results.studentReport);
  router.get(
    '/:id/students/:studentId/report.csv',
    authorizeHost,
    validateRequest({ params: z.object({ id: objectId, studentId: objectId }) }),
    results.studentReport,
  );
  return router;
}
