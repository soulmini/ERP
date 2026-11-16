import { z } from 'zod';

/**
 * Communication module (homework, notices, holidays, time table, SMS):
 * Zod schemas & constants shared by the API (validation) and the web (forms).
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
/** Optional date: '' / null / missing → undefined. */
const optDate = z.preprocess(blankToUndefined, date.optional());
/** Optional id: '' / null / missing → undefined. */
const optId = z.preprocess(blankToUndefined, z.string().min(1).optional());
const optText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

// ───────── Time table ─────────

/** School days of the time table. TimetableSlot.day uses these numbers (1 = Monday … 6 = Saturday). */
export const WEEK_DAYS = [
  { day: 1, short: 'Mon', name: 'Monday' },
  { day: 2, short: 'Tue', name: 'Tuesday' },
  { day: 3, short: 'Wed', name: 'Wednesday' },
  { day: 4, short: 'Thu', name: 'Thursday' },
  { day: 5, short: 'Fri', name: 'Friday' },
  { day: 6, short: 'Sat', name: 'Saturday' },
] as const;

export const periodSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(40),
    startTime: time,
    endTime: time,
    order: z.coerce.number().int().min(0).max(99),
    isBreak: z.boolean().default(false),
  })
  .refine((p) => p.endTime > p.startTime, { path: ['endTime'], message: 'End time must be after start time' });
export type PeriodInput = z.infer<typeof periodSchema>;

/** One cell of a class time table. Neither subject nor teacher = empty cell. */
export const timetableCellSchema = z.object({
  day: z.coerce.number().int().min(1).max(6),
  periodId: z.string().min(1),
  subjectId: optId,
  teacherId: optId,
  room: optText(30),
});
export type TimetableCellInput = z.infer<typeof timetableCellSchema>;

/** Whole week for one section (replaces what is saved). */
export const timetableGridSchema = z.object({ slots: z.array(timetableCellSchema).max(600) });
export type TimetableGridInput = z.infer<typeof timetableGridSchema>;

// ───────── Homework ─────────

export const HOMEWORK_MAX_FILES = 5;

const homeworkBase = z.object({
  sectionId: z.string().min(1, 'Select class & section'),
  subjectId: optId,
  title: z.string().trim().min(2, 'Enter a title').max(200),
  description: optText(5000),
  /** Defaults to today on the server. */
  assignedDate: optDate,
  dueDate: optDate,
});
const dueAfterAssigned = (h: { assignedDate?: string; dueDate?: string }) =>
  !h.dueDate || !h.assignedDate || h.dueDate >= h.assignedDate;
const dueRule = { path: ['dueDate'], message: 'Due date cannot be before the assigned date' };

export const homeworkSchema = homeworkBase.refine(dueAfterAssigned, dueRule);
export type HomeworkInput = z.infer<typeof homeworkSchema>;

export const homeworkUpdateSchema = homeworkBase
  .extend({ removeAttachmentIds: z.array(z.string()).max(20).default([]) })
  .refine(dueAfterAssigned, dueRule);
export type HomeworkUpdateInput = z.infer<typeof homeworkUpdateSchema>;

// ───────── Notices ─────────

export const NOTICE_AUDIENCES = ['ALL', 'STAFF', 'PARENTS', 'SECTIONS'] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];
export const NOTICE_AUDIENCE_LABELS: Record<NoticeAudience, string> = {
  ALL: 'Everyone',
  STAFF: 'Staff',
  PARENTS: 'Parents',
  SECTIONS: 'Selected classes',
};

const noticeBase = z.object({
  title: z.string().trim().min(2, 'Enter a title').max(200),
  body: z.string().trim().min(1, 'Write the notice').max(5000),
  audience: z.enum(NOTICE_AUDIENCES).default('ALL'),
  sectionIds: z.array(z.string().min(1)).max(200).default([]),
  pinned: z.boolean().default(false),
  /** Last day the notice is shown (inclusive). */
  expiresOn: optDate,
});
const sectionsPicked = (n: { audience: NoticeAudience; sectionIds: string[] }) => n.audience !== 'SECTIONS' || n.sectionIds.length > 0;
const sectionsRule = { path: ['sectionIds'], message: 'Pick at least one class' };

/** Create: multipart (`data` = this JSON + optional `file`) or plain JSON. */
export const noticeSchema = noticeBase.extend({ sendSms: z.boolean().default(false) }).refine(sectionsPicked, sectionsRule);
export type NoticeInput = z.infer<typeof noticeSchema>;

export const noticeUpdateSchema = noticeBase.extend({ removeAttachment: z.boolean().default(false) }).refine(sectionsPicked, sectionsRule);
export type NoticeUpdateInput = z.infer<typeof noticeUpdateSchema>;

// ───────── Holidays ─────────

export const holidaySchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the holiday name').max(100),
    date,
    /** Last day of a multi-day holiday (vacation); empty for a single day. */
    endDate: optDate,
  })
  .refine((h) => !h.endDate || h.endDate >= h.date, { path: ['endDate'], message: 'End date cannot be before the start date' });
export type HolidayInput = z.infer<typeof holidaySchema>;

// ───────── SMS ─────────

export const SMS_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type SmsStatus = (typeof SMS_STATUSES)[number];

/** SmsLog.purpose values and their labels. */
export const SMS_PURPOSES: Record<string, string> = {
  'attendance.absent': 'Absent alert',
  notice: 'Notice',
  'fees.due': 'Fee reminder',
};
