import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// backend/src/config -> repository root (also works from backend/dist/config).
const repoRoot = path.resolve(here, '..', '..', '..');

/** Loads the repository-level .env file once, without overriding real environment variables. */
function loadEnvFile(): void {
  if (process.env.NODE_ENV === 'test') return;
  const file = process.env.MATHHACK_ENV_FILE ?? path.join(repoRoot, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must be a mongodb:// or mongodb+srv:// URI'),
    FRONTEND_URL: z.string().url(),
    BACKEND_PUBLIC_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    COOKIE_DOMAIN: z.string().optional().transform((value) => value || undefined),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    REDIS_URL: z.string().optional().transform((value) => value || undefined),
    SMTP_HOST: z.string().optional().transform((value) => value || undefined),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    REQUIRE_EMAIL_VERIFICATION: booleanString,
    ROSTER_ENFORCED: booleanString,
    ALLOWED_EMAIL_DOMAINS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '')
          .split(',')
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean),
      ),
    RATE_LIMIT_DISABLED: booleanString,
  })
  .superRefine((env, ctx) => {
    if (env.REQUIRE_EMAIL_VERIFICATION && !env.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REQUIRE_EMAIL_VERIFICATION'],
        message: 'REQUIRE_EMAIL_VERIFICATION=true needs SMTP_HOST, SMTP_PORT and SMTP_FROM to be configured',
      });
    }
    if (env.COOKIE_SAME_SITE === 'none' && !env.BACKEND_PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['COOKIE_SAME_SITE'], message: 'COOKIE_SAME_SITE=none requires an https BACKEND_PUBLIC_URL' });
    }
    if (env.NODE_ENV === 'production' && env.RATE_LIMIT_DISABLED) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RATE_LIMIT_DISABLED'], message: 'Rate limiting cannot be disabled in production' });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export class EnvironmentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
  }
}

/** Validates process.env. Error messages name variables but never echo their values. */
export function parseEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentError(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  return result.data;
}

let cached: Environment | undefined;

export function getEnv(): Environment {
  if (!cached) {
    loadEnvFile();
    cached = parseEnvironment();
  }
  return cached;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';
export const emailVerificationAvailable = (): boolean => Boolean(getEnv().SMTP_HOST && getEnv().SMTP_FROM);
