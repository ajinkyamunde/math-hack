import type { AuthUser } from './domain.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser & { sessionId: string };
    }
  }
}

export {};
