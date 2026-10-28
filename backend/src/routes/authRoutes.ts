import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authLimiter, registrationLimiter } from '../middleware/rateLimiter.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { loginSchema, registerSchema } from '../validation/authSchemas.js';

export function authRoutes(): Router {
  const router = Router();
  router.post('/register', registrationLimiter(), validateRequest({ body: registerSchema }), auth.register);
  router.post('/login', authLimiter(), validateRequest({ body: loginSchema }), auth.login);
  router.post('/logout', auth.logout);
  router.get('/me', authenticate, auth.me);
  return router;
}
