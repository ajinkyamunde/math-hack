import { describe, expect, it } from 'vitest';
import { EnvironmentError, parseEnvironment } from '../src/config/environment.js';
import { redact } from '../src/utils/logger.js';

const base = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.net/mathhack',
  FRONTEND_URL: 'https://mathhack.college.edu',
  BACKEND_PUBLIC_URL: 'https://api.mathhack.college.edu',
  SESSION_SECRET: 'a'.repeat(40),
};

describe('environment validation', () => {
  it('accepts a complete production configuration with defaults', () => {
    const env = parseEnvironment(base);
    expect(env.PORT).toBe(4000);
    expect(env.COOKIE_SAME_SITE).toBe('lax');
    expect(env.REQUIRE_EMAIL_VERIFICATION).toBe(false);
  });

  it('rejects missing or weak settings without echoing secret values', () => {
    try {
      parseEnvironment({ ...base, SESSION_SECRET: 'short-secret-value', MONGODB_URI: 'postgres://nope' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError);
      const message = (error as Error).message;
      expect(message).toContain('SESSION_SECRET');
      expect(message).toContain('MONGODB_URI');
      expect(message).not.toContain('short-secret-value');
    }
  });

  it('refuses unsafe production combinations', () => {
    expect(() => parseEnvironment({ ...base, RATE_LIMIT_DISABLED: 'true' })).toThrow(/Rate limiting/);
    expect(() => parseEnvironment({ ...base, REQUIRE_EMAIL_VERIFICATION: 'true' })).toThrow(/SMTP_HOST/);
    expect(() => parseEnvironment({ ...base, COOKIE_SAME_SITE: 'none', BACKEND_PUBLIC_URL: 'http://api.example' })).toThrow(/https/);
  });
});

describe('log redaction', () => {
  it('removes secrets and connection-string credentials', () => {
    const out = redact({ password: 'x', nested: { sessionSecret: 'y' }, uri: 'mongodb://u:p@h/db', note: 'mongodb+srv://u:p@h/db' }) as Record<string, unknown>;
    expect(out.password).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).sessionSecret).toBe('[redacted]');
    expect(out.note).toBe('mongodb+srv://[redacted]@h/db');
  });
});
