import { Router } from 'express';
import * as competitions from '../controllers/competitionController.js';
import * as participantAccounts from '../controllers/participantAccountController.js';
import * as participants from '../controllers/participantController.js';
import * as results from '../controllers/resultController.js';
import { authenticate, requireStudent } from '../middleware/authenticate.js';
import { authorizeHost } from '../middleware/authorizeHost.js';
import { authorizeCompetitionOwner } from '../middleware/authorizeCompetitionOwner.js';
import { participantAdminLimiter } from '../middleware/rateLimiter.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { idParams, objectId } from '../validation/common.js';
import { participantParams, participantQuerySchema, resetParticipantPasswordSchema } from '../validation/participantSchemas.js';
import {
  competitionListQuerySchema,
  createCompetitionSchema,
  publishSchema,
  setDirectQuestionsSchema,
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
  router.put('/:id/questions', authorizeHost, validateRequest({ params: idParams, body: setDirectQuestionsSchema }), competitions.setDirectQuestions);

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

  // Participant data. Hosts must have created the competition; students keep their existing own-data-only views.
  const owner = authorizeCompetitionOwner;
  router.get('/:id/leaderboard', params, owner, results.leaderboard);
  router.get('/:id/results', params, owner, results.results);
  router.get('/:id/analytics', authorizeHost, params, owner, results.analytics);
  router.get('/:id/export.xlsx', authorizeHost, params, owner, results.exportXlsx);
  router.get('/:id/export.csv', authorizeHost, params, owner, results.exportCsv);
  router.get('/:id/my-report.csv', requireStudent, params, results.studentReport);
  router.get(
    '/:id/students/:studentId/report.csv',
    authorizeHost,
    validateRequest({ params: z.object({ id: objectId, studentId: objectId }) }),
    owner,
    results.studentReport,
  );

  // Host participant dashboard and its Excel export.
  const participantQuery = validateRequest({ params: idParams, query: participantQuerySchema });
  router.get('/:id/participants', authorizeHost, participantQuery, owner, participants.list);
  router.get('/:id/participants/export.xlsx', authorizeHost, participantQuery, owner, participants.exportXlsx);
  router.post(
    '/:id/participants/:studentId/password',
    authorizeHost,
    participantAdminLimiter(),
    validateRequest({ params: participantParams, body: resetParticipantPasswordSchema }),
    owner,
    participantAccounts.resetPassword,
  );
  return router;
}
