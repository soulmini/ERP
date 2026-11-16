import type { z } from 'zod';

/**
 * Validate a prepared payload; returns parsed data or the first error per field.
 * Nested errors are keyed by their full path ("guardians.0.phone") and also by the top-level field ("guardians").
 */
export function zodErrors<S extends z.ZodTypeAny>(schema: S, payload: unknown): { data: z.output<S> | null; errors: Record<string, string> } {
  const r = schema.safeParse(payload);
  if (r.success) return { data: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const full = issue.path.join('.') || '_form';
    errors[full] ??= issue.message;
    if (issue.path.length > 1) errors[String(issue.path[0])] ??= issue.message;
  }
  return { data: null, errors };
}
