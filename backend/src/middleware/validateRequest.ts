import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from '../utils/errors.js';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function formatZodIssues(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message }));
}

/** Validates and replaces body/query/params with parsed (coerced, stripped) values. */
export function validateRequest(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (!result.success) throw badRequest('Please correct the highlighted fields.', formatZodIssues(result.error));
      // Express 5 exposes req.query as a getter, so redefine it rather than assigning.
      Object.defineProperty(req, key, { value: result.data, writable: true, configurable: true, enumerable: true });
    }
    next();
  };
}
