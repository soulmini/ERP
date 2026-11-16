import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/http';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Route not found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  const e = err as { code?: string; meta?: unknown; name?: string; message?: string; type?: string };
  if (e?.code === 'P2002') return res.status(409).json({ error: 'This record already exists', details: e.meta });
  if (e?.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  if (e?.code === 'P2003') return res.status(409).json({ error: 'This record is in use and cannot be removed' });
  if (e?.name === 'MulterError') return res.status(400).json({ error: e.message });
  if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}
