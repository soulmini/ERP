import { env } from '../../env';

/** Milliseconds the school's timezone is ahead of UTC at a given instant (IST → +19 800 000). */
function tzOffsetMs(at: Date, timeZone = env.timezone): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** Wall-clock 'YYYY-MM-DD' + 'HH:MM' in the school's timezone → the real instant. */
export function zonedInstant(date: string, hhmm = '00:00'): Date {
  const guess = new Date(`${date}T${hhmm}:00.000Z`);
  return new Date(guess.getTime() - tzOffsetMs(guess));
}

/** [start, end) instants of a school-timezone calendar day. */
export function zonedDayRange(date: string): { from: Date; to: Date } {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: zonedInstant(date), to: zonedInstant(next.toISOString().slice(0, 10)) };
}
