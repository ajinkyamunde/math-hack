export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'DEADLINE_PASSED'
  | 'ALREADY_SUBMITTED'
  | 'RATE_LIMITED'
  | 'CSRF_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** An error whose message is safe to show to the client. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthenticated = (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const invalidState = (message: string) => new AppError(409, 'INVALID_STATE', message);

export function isDuplicateKeyError(error: unknown): error is { code: 11000; keyPattern?: Record<string, unknown> } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}
