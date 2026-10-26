import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import * as students from '../controllers/studentController.js';
import { authenticate, requireStudent } from '../middleware/authenticate.js';
import { authorizeHost } from '../middleware/authorizeHost.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { pagination } from '../validation/common.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

export function studentRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/me/history', requireStudent, validateRequest({ query: pagination }), students.history);
  router.get('/', authorizeHost, validateRequest({ query: pagination.extend({ search: z.string().trim().max(100).optional() }) }), students.list);
  router.get('/roster', authorizeHost, students.rosterStatus);
  router.post('/roster', authorizeHost, uploadLimiter(), upload.single('file'), students.uploadRoster);
  return router;
}
