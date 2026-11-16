import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Join class names; later Tailwind classes override earlier ones (e.g. w-auto beats w-full). */
export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

/** 'YYYY-MM-DD' for today in local time. */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const monthStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  return monthStr(new Date(y, m - 1 + by, 1));
}

export function fmtDate(d: string | Date, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d;
  return date.toLocaleDateString('en-IN', opts);
}

export const fmtTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—';

export const fmtMonth = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** Download rows as a CSV file (Excel-friendly, UTF-8 with BOM). */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "1,234.50" / "1234.5" (rupees typed by a user) → paise; '' → undefined; invalid → NaN. */
export function rupeesInput(v: string): number | undefined {
  const s = v.replace(/[,\s₹]/g, '');
  if (!s) return undefined;
  return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN;
}

/** paise → rupees text for an input box ("1234.5"). */
export const paiseInput = (p: number | null | undefined) => (p == null ? '' : String(p / 100));
