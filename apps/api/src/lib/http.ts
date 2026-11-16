import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = 'Please log in') => new HttpError(401, m);
export const forbidden = (m = 'You do not have access to this') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

/** Validate input with a Zod schema; throws 422 with field errors. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(422, 'Please check the highlighted fields', r.error.flatten());
  return r.data;
}

/** Read a route/query param as a non-empty string. */
export function str(v: unknown, name = 'parameter'): string {
  if (typeof v !== 'string' || !v) throw badRequest(`Missing ${name}`);
  return v;
}

export function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
