import { NextFunction, Request, Response } from 'express';
import { log } from './logger';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new HttpError(422, code, message, details);
export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

// Express needs the four-argument signature to treat this as the error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    if (err.status >= 500) log('error', err.message, { code: err.code, path: req.path });
    res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: 'INVALID_JSON', message: 'Request body is not valid JSON' });
    return;
  }
  log('error', 'unhandled error', { path: req.path, error: String(err) });
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong. The error has been logged.' });
}

/** Wraps an async route so rejected promises reach the error handler. */
export const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
