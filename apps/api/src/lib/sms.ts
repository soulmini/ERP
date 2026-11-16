/**
 * SMS: provider adapter + absent alerts. Every attempt is recorded in SmsLog (Notices → SMS log).
 *
 * Environment variables
 *   SMS_PROVIDER          'log' (default) | 'msg91' | 'fast2sms'
 *                         'log' never sends anything: the message is printed to the console and
 *                         stored in SmsLog with status SKIPPED. Use it for development and demos.
 *   SMS_API_KEY           MSG91 "authkey" or Fast2SMS API key (Dev API → authorization).
 *   SMS_SENDER_ID         6-letter DLT-approved sender id (header), e.g. RRYSCH.
 *                         Fast2SMS: sent as sender_id. MSG91: the sender is linked to the template in the MSG91 panel.
 *   SMS_TEMPLATE_ABSENT   Template for absent alerts.
 *   SMS_TEMPLATE_NOTICE   Template for notices.
 *                         MSG91: the Flow/template id; write the variables as ##var1##, ##var2## … in the template.
 *                         Fast2SMS: the DLT "Message ID" from the Fast2SMS DLT manager (variables are {#var#}).
 *                         Without a template id, Fast2SMS falls back to its "Quick SMS" route (free text, costlier);
 *                         MSG91 cannot send without one (the attempt is logged as FAILED).
 *
 * India (TRAI DLT): business SMS must use a registered sender id and pre-approved templates — free text is
 * blocked by operators. Register exactly these texts on your DLT portal (Jio / Airtel / Vi / BSNL), then
 * link them in the provider panel; the variables are filled in this order:
 *   absent: "Dear Parent, your ward {#var#} ({#var#}) is absent today ({#var#}). - {#var#}"
 *           var1 = student name, var2 = class-section, var3 = date DD-MM-YYYY, var4 = school name
 *   notice: "Dear Parent, new notice: {#var#}. Please check the school app for details. - {#var#}"
 *           var1 = notice title (first 30 characters), var2 = school name
 */
import { prisma } from '../db';
import type { SmsLog } from '../generated/prisma/client';
import { dateOnly, todayStr } from './dates';

export type SmsProvider = 'log' | 'msg91' | 'fast2sms';

export const SMS_PURPOSE = { absent: 'attendance.absent', notice: 'notice' } as const;

/** DLT variables are limited to 30 characters each. */
const VAR_MAX = 30;
const clip = (s: string, max = VAR_MAX) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Message texts — must match the DLT templates documented above. Returns the text and its variables. */
export const SMS_TEXT = {
  absent(student: string, classLabel: string, ddmmyyyy: string, school: string) {
    const vars = [clip(student), clip(classLabel), ddmmyyyy, clip(school)];
    return { vars, message: `Dear Parent, your ward ${vars[0]} (${vars[1]}) is absent today (${vars[2]}). - ${vars[3]}` };
  },
  notice(title: string, school: string) {
    const vars = [clip(title), clip(school)];
    return { vars, message: `Dear Parent, new notice: ${vars[0]}. Please check the school app for details. - ${vars[1]}` };
  },
};

export function smsProvider(): SmsProvider {
  const p = (process.env.SMS_PROVIDER ?? 'log').trim().toLowerCase();
  if (p === 'msg91' || p === 'fast2sms') return p;
  if (p && p !== 'log') console.warn(`[sms] Unknown SMS_PROVIDER "${p}", using 'log' (nothing is sent)`);
  return 'log';
}

/** Indian mobile → 10 digits (drops +91 / 0 prefixes); null when it isn't a valid mobile number. */
export function normalizeMobile(raw: string | null | undefined): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export interface SendSmsInput {
  schoolId: string;
  to: string;
  message: string;
  /** SmsLog.purpose, e.g. 'attendance.absent', 'notice', 'fees.due'. */
  purpose: string;
  refId?: string;
  /** Provider template id (DLT). */
  templateId?: string;
  /** Template variables in order (var1, var2 …). */
  vars?: string[];
}

const errText = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 500);

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function sendMsg91(to: string, m: SendSmsInput) {
  const authkey = need('SMS_API_KEY');
  if (!m.templateId) throw new Error('MSG91 needs a template id (SMS_TEMPLATE_ABSENT / SMS_TEMPLATE_NOTICE)');
  const vars = Object.fromEntries((m.vars ?? []).map((v, i) => [`var${i + 1}`, v]));
  const res = await fetch('https://control.msg91.com/api/v5/flow', {
    method: 'POST',
    headers: { authkey, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ template_id: m.templateId, short_url: '0', recipients: [{ mobiles: `91${to}`, ...vars }] }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { type?: string; message?: string } | null;
  if (!res.ok || body?.type !== 'success') throw new Error(`MSG91: ${body?.message ?? `HTTP ${res.status}`}`);
}

async function sendFast2sms(to: string, m: SendSmsInput) {
  const authorization = need('SMS_API_KEY');
  const payload = m.templateId
    ? {
        route: 'dlt',
        sender_id: need('SMS_SENDER_ID'),
        message: m.templateId,
        variables_values: (m.vars ?? []).map((v) => v.replace(/\|/g, '/')).join('|'),
        numbers: to,
        flash: 0,
      }
    : { route: 'q', message: m.message, numbers: to, flash: 0 };
  const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { return?: boolean; message?: string | string[] } | null;
  if (!res.ok || body?.return !== true) {
    throw new Error(`Fast2SMS: ${[body?.message ?? `HTTP ${res.status}`].flat().join(' ')}`);
  }
}

/**
 * Send one SMS through the configured provider and record it in SmsLog.
 * Never throws: failures are stored with status FAILED and the error. Returns the log row (null if even logging failed).
 */
export async function sendSms(input: SendSmsInput): Promise<SmsLog | null> {
  const provider = smsProvider();
  const record = (to: string, status: SmsLog['status'], error: string | null) =>
    prisma.smsLog.create({
      data: {
        schoolId: input.schoolId,
        to,
        message: input.message,
        templateId: input.templateId ?? null,
        provider,
        purpose: input.purpose,
        refId: input.refId ?? null,
        status,
        error,
      },
    });
  try {
    const to = normalizeMobile(input.to);
    if (!to) return await record(String(input.to ?? '').slice(0, 20), 'FAILED', 'Invalid or missing mobile number');
    if (provider === 'log') {
      console.log(`[sms:log] (not sent) → ${to} [${input.purpose}] ${input.message}`);
      return await record(to, 'SKIPPED', null);
    }
    const log = await record(to, 'QUEUED', null);
    try {
      await (provider === 'msg91' ? sendMsg91(to, input) : sendFast2sms(to, input));
      return await prisma.smsLog.update({ where: { id: log.id }, data: { status: 'SENT' } });
    } catch (e) {
      console.error(`[sms:${provider}] failed → ${to}:`, errText(e));
      return await prisma.smsLog.update({ where: { id: log.id }, data: { status: 'FAILED', error: errText(e) } });
    }
  } catch (e) {
    console.error('[sms] could not send / record SMS', e);
    return null;
  }
}

/** Send many messages with a small concurrency limit. Never throws; returns counts by status. */
export async function sendSmsMany(list: SendSmsInput[], concurrency = 4) {
  const counts: Record<string, number> = { SENT: 0, SKIPPED: 0, FAILED: 0, QUEUED: 0, ERROR: 0 };
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const log = await sendSms(list[next++]);
      counts[log?.status ?? 'ERROR']++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return counts;
}

// ───────────────────────── Absent alerts ─────────────────────────

/** One run at a time per section & date, so quick re-saves can't text a parent twice. */
const absentRuns = new Map<string, Promise<void>>();

/**
 * Text the primary guardian of every student marked ABSENT in a section on a date (only for today's register),
 * once per student per day. Called fire-and-forget after attendance is saved:
 *   void notifyAbsentees(schoolId, sectionId, '2026-11-16');
 * Runs after the response (never slows or breaks the save) and never rejects.
 */
export function notifyAbsentees(schoolId: string, sectionId: string, date: string): Promise<void> {
  const key = `${sectionId}:${date}`;
  const run: Promise<void> = (absentRuns.get(key) ?? Promise.resolve())
    .then(() => new Promise<void>((resolve) => setImmediate(resolve)))
    .then(() => runAbsentees(schoolId, sectionId, date))
    .catch((e) => console.error('[sms] absent alerts failed', e))
    .finally(() => {
      if (absentRuns.get(key) === run) absentRuns.delete(key);
    });
  absentRuns.set(key, run);
  return run;
}

async function runAbsentees(schoolId: string, sectionId: string, date: string) {
  // "absent today" alerts only make sense for today's register; corrections to past days don't text parents.
  if (date !== todayStr()) return;
  const rows = await prisma.studentAttendance.findMany({
    where: { schoolId, sectionId, date: dateOnly(date), status: 'ABSENT', smsSentAt: null },
    select: {
      id: true,
      studentId: true,
      student: {
        select: {
          firstName: true,
          lastName: true,
          guardians: { select: { isPrimary: true, guardian: { select: { phone: true } } } },
        },
      },
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  });
  if (!rows.length) return;

  // Saving attendance again recreates the rows (smsSentAt back to null), so de-duplicate on the SMS log.
  const ref = (studentId: string) => `${studentId}:${date}`;
  const [school, done] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
    prisma.smsLog.findMany({
      where: {
        schoolId,
        purpose: SMS_PURPOSE.absent,
        refId: { in: rows.map((r) => ref(r.studentId)) },
        status: { in: ['QUEUED', 'SENT', 'SKIPPED'] },
      },
      select: { refId: true, createdAt: true },
    }),
  ]);
  const alerted = new Map(done.map((d) => [d.refId, d.createdAt]));
  const dmy = date.split('-').reverse().join('-');
  const templateId = process.env.SMS_TEMPLATE_ABSENT?.trim() || undefined;

  for (const r of rows) {
    const already = alerted.get(ref(r.studentId));
    if (already) {
      await prisma.studentAttendance.updateMany({ where: { id: r.id, smsSentAt: null }, data: { smsSentAt: already } });
      continue;
    }
    const guardian = r.student.guardians.find((g) => g.isPrimary) ?? r.student.guardians[0];
    const name = [r.student.firstName, r.student.lastName].filter(Boolean).join(' ');
    const { message, vars } = SMS_TEXT.absent(name, `${r.section.class.name}-${r.section.name}`, dmy, school?.name ?? 'School');
    const log = await sendSms({
      schoolId,
      to: guardian?.guardian.phone ?? '',
      message,
      purpose: SMS_PURPOSE.absent,
      refId: ref(r.studentId),
      templateId,
      vars,
    });
    // FAILED attempts stay unmarked so the next save of the register retries them.
    if (log && log.status !== 'FAILED') {
      await prisma.studentAttendance.updateMany({ where: { id: r.id }, data: { smsSentAt: log.createdAt } });
    }
  }
}
