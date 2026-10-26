import type { CorsOptions } from 'cors';
import { getEnv } from './environment.js';

/** Only the configured frontend origin may send credentialed requests. */
export function allowedOrigins(): string[] {
  return [new URL(getEnv().FRONTEND_URL).origin];
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  return !origin || allowedOrigins().includes(origin);
}

export function corsOptions(): CorsOptions {
  return {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  };
}
