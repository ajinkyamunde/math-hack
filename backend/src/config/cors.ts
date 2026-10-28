import type { CorsOptions } from 'cors';
import { getEnv } from './environment.js';

/** Only the configured frontend origin may send credentialed requests. */
export function allowedOrigins(): string[] {
  return [new URL(getEnv().FRONTEND_URL).origin];
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins().includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    if (hostname.endsWith('.vercel.app')) return true;
  } catch {
    return false;
  }
  return false;
}

export function corsOptions(): CorsOptions {
  return {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Accept', 'Authorization'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  };
}
