type Level = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|authorization|hash|uri|smtp_password/i;
const MONGO_CREDENTIALS = /(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi;

/** Recursively replaces values under sensitive keys and strips credentials from connection strings. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth limit]';
  if (typeof value === 'string') return value.replace(MONGO_CREDENTIALS, '$1[redacted]@');
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1), stack: value.stack };
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)]),
    );
  }
  return value;
}

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test' && level !== 'error' && !process.env.LOG_IN_TESTS) return;
  const entry = { time: new Date().toISOString(), level, message, ...(meta ? (redact(meta) as object) : {}) };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
