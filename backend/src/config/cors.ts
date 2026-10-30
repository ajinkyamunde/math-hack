import type { CorsOptions } from 'cors';
import { getEnv } from './environment.js';

/**
 * Exact browser origins allowed to send credentialed requests: FRONTEND_URL plus any listed in
 * CORS_EXTRA_ORIGINS (for example a Vercel preview URL). There is deliberately no wildcard: with a cross-site
 * session cookie, any page on an allowed origin could act as a signed-in host and read participant data.
 */
export function allowedOrigins(): string[] {
  const env = getEnv();
  return [...new Set([new URL(env.FRONTEND_URL).origin, ...env.CORS_EXTRA_ORIGINS])];
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
