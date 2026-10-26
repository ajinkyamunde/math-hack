import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

/** Converts every error into a consistent JSON shape without leaking internals. */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      error: { code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR', message: tooLarge ? 'The uploaded file is too large.' : error.message },
    });
    return;
  }
  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Invalid ${error.path}.` } });
    return;
  }
  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map((item) => ({ field: item.path, message: item.message }));
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed.', details } });
    return;
  }
  const typed = error as { type?: string; status?: number };
  if (typed?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
    return;
  }
  if (typed?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body.' } });
    return;
  }
  logger.error('Unhandled request error', { method: req.method, path: req.path, error });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' } });
}
