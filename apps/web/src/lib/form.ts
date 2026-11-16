import { useState } from 'react';
import type { z } from 'zod';

/**
 * Tiny form helper using the SAME Zod schemas as the API (from @erp/shared).
 * values are strings/booleans as typed in the form; validate() returns parsed data or null.
 */
export function useZodForm<S extends z.ZodTypeAny>(schema: S, initial: Record<string, unknown>) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (name: string, value: unknown) => {
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
  };

  /** Props for <Input>/<Select>. */
  const bind = (name: string) => ({
    name,
    value: (values[name] as string | undefined) ?? '',
    onChange: (e: { target: { value: string } }) => set(name, e.target.value),
  });

  const validate = (): z.output<S> | null => {
    const r = schema.safeParse(values);
    if (r.success) {
      setErrors({});
      return r.data;
    }
    const fe = r.error.flatten().fieldErrors as Record<string, string[] | undefined>;
    setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])));
    return null;
  };

  return { values, setValues, set, bind, errors, validate, reset: () => (setValues(initial), setErrors({})) };
}
