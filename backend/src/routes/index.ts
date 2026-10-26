import { Router } from 'express';
import { authRoutes } from './authRoutes.js';
import { competitionRoutes } from './competitionRoutes.js';
import { questionRoutes } from './questionRoutes.js';
import { studentRoutes } from './studentRoutes.js';
import { overview } from '../controllers/dashboardController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeHost } from '../middleware/authorizeHost.js';

export function apiRoutes(): Router {
  const router = Router();
  router.use('/auth', authRoutes());
  router.use('/questions', questionRoutes());
  router.use('/competitions', competitionRoutes());
  router.use('/students', studentRoutes());
  router.get('/host/overview', authenticate, authorizeHost, overview);
  return router;
}
