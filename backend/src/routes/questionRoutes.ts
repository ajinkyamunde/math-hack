import { Router } from 'express';
import multer from 'multer';
import * as questions from '../controllers/questionController.js';
import * as imports from '../controllers/importController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeHost } from '../middleware/authorizeHost.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { MAX_IMPORT_BYTES } from '../services/questionImportService.js';
import { idParams, objectId } from '../validation/common.js';
import { importConfirmSchema, questionInputSchema, questionListQuerySchema } from '../validation/questionSchemas.js';
import { z } from 'zod';

// Uploads stay in memory (bounded by the size limit) and are never written to disk under a client-chosen name.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 5 } });

export function questionRoutes(): Router {
  const router = Router();
  router.use(authenticate, authorizeHost);

  router.get('/template.csv', imports.csvTemplate);
  router.get('/template.xlsx', imports.xlsxTemplate);
  router.post('/import/preview', uploadLimiter(), upload.single('file'), imports.preview);
  router.post('/import/confirm', validateRequest({ body: importConfirmSchema }), imports.confirm);
  router.get('/import/:batchId/errors.csv', validateRequest({ params: z.object({ batchId: objectId }) }), imports.errorReport);

  router.get('/topics', questions.topics);
  router.get('/', validateRequest({ query: questionListQuerySchema }), questions.list);
  router.post('/', validateRequest({ body: questionInputSchema }), questions.create);
  router.get('/:id', validateRequest({ params: idParams }), questions.get);
  router.put('/:id', validateRequest({ params: idParams, body: questionInputSchema }), questions.update);
  router.delete('/:id', validateRequest({ params: idParams }), questions.remove);
  router.post('/:id/duplicate', validateRequest({ params: idParams }), questions.duplicate);
  return router;
}
