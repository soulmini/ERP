import { env } from '../env';
import { badRequest } from './http';

/** 'YYYY-MM-DD' for "today" in the school's timezone (IST by default). */
export function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: env.timezone });
}

/** 'YYYY-MM' for the current month in the school's timezone. */
export function currentMonthStr(): string {
  return todayStr().slice(0, 7);
}

/** Date-only string → Date at UTC midnight (what Postgres DATE columns map to). */
export function dateOnly(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest('Date must be YYYY-MM-DD');
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw badRequest('Invalid date');
  return d;
}

export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM' → [first day, first day of next month) */
export function monthRange(month: string): { from: Date; to: Date; days: number } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('Month must be YYYY-MM');
  const [y, m] = month.split('-').map(Number);
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m, 1)),
    days: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86_400_000);
}
