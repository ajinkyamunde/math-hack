import { Router } from 'express';
import { authRoutes } from './authRoutes.js';
import { competitionRoutes } from './competitionRoutes.js';
import { questionRoutes } from './questionRoutes.js';
import { studentRoutes } from './studentRoutes.js';
import { overview } from '../controllers/dashboardController.js';
import * as participantAccounts from '../controllers/participantAccountController.js';
import { participantAdminLimiter } from '../middleware/rateLimiter.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { createParticipantSchema } from '../validation/participantSchemas.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeHost } from '../middleware/authorizeHost.js';

export function apiRoutes(): Router {
  const router = Router();
  router.use('/auth', authRoutes());
  router.use('/questions', questionRoutes());
  router.use('/competitions', competitionRoutes());
  router.use('/students', studentRoutes());
  router.get('/host/overview', authenticate, authorizeHost, overview);
  router.get('/host/assignable-competitions', authenticate, authorizeHost, participantAccounts.assignableCompetitions);
  router.post(
    '/host/participants',
    authenticate,
    authorizeHost,
    participantAdminLimiter(),
    validateRequest({ body: createParticipantSchema }),
    participantAccounts.create,
  );
  return router;
}
