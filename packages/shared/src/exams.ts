// Zod schemas & types for the exams module (shared by API and web).
import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');
/** '' / undefined → null, otherwise validated by `s`. */
const orNull = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), s.nullable());

// ─────────────── Exams ───────────────

export const examSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter the exam name').max(60),
    startDate: orNull(dateOnly),
    endDate: orNull(dateOnly),
    order: z.coerce.number().int().min(0).max(999).default(0),
  })
  .refine((d) => !d.startDate || !d.endDate || d.endDate >= d.startDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type ExamInput = z.infer<typeof examSchema>;

export const publishResultSchema = z.object({ published: z.boolean() });

// ─────────────── Date sheet ───────────────

/** Marks are whole numbers or halves (e.g. 72.5). */
export const isHalfMarkStep = (v: number) => Math.round(v * 2) === v * 2;

export const examScheduleEntrySchema = z
  .object({
    subjectId: z.string().min(1),
    date: orNull(dateOnly),
    startTime: orNull(time),
    endTime: orNull(time),
    maxMarks: z.coerce.number().positive('Max marks must be more than 0').max(1000).refine(isHalfMarkStep, 'Use steps of 0.5'),
    passMarks: z.coerce.number().min(0).max(1000).refine(isHalfMarkStep, 'Use steps of 0.5'),
  })
  .refine((d) => d.passMarks <= d.maxMarks, { message: 'Pass marks cannot be more than max marks', path: ['passMarks'] })
  .refine((d) => !d.startTime || !d.endTime || d.endTime > d.startTime, {
    message: 'End time must be after the start time',
    path: ['endTime'],
  });
export type ExamScheduleEntryInput = z.infer<typeof examScheduleEntrySchema>;

/** Full date sheet of one class for one exam. Subjects left out are removed from the exam. */
export const dateSheetSchema = z.object({
  classId: z.string().min(1),
  entries: z
    .array(examScheduleEntrySchema)
    .max(60)
    .refine((e) => new Set(e.map((x) => x.subjectId)).size === e.length, 'A subject is listed twice'),
});
export type DateSheetInput = z.infer<typeof dateSheetSchema>;

export const copyDateSheetSchema = z.object({
  fromClassId: z.string().min(1),
  toClassIds: z.array(z.string().min(1)).min(1, 'Choose at least one class').max(100),
});
export type CopyDateSheetInput = z.infer<typeof copyDateSheetSchema>;

// ─────────────── Grade scale ───────────────

export interface GradeBand {
  grade: string;
  minPercent: number;
  maxPercent: number;
  gradePoint?: number | null;
  remark?: string | null;
}

/** CBSE-style 8-point scale used when a school has not set its own. */
export const DEFAULT_GRADE_SCALE: GradeBand[] = [
  { grade: 'A1', minPercent: 91, maxPercent: 100, gradePoint: 10, remark: 'Outstanding' },
  { grade: 'A2', minPercent: 81, maxPercent: 90, gradePoint: 9, remark: 'Excellent' },
  { grade: 'B1', minPercent: 71, maxPercent: 80, gradePoint: 8, remark: 'Very good' },
  { grade: 'B2', minPercent: 61, maxPercent: 70, gradePoint: 7, remark: 'Good' },
  { grade: 'C1', minPercent: 51, maxPercent: 60, gradePoint: 6, remark: 'Fair' },
  { grade: 'C2', minPercent: 41, maxPercent: 50, gradePoint: 5, remark: 'Average' },
  { grade: 'D', minPercent: 33, maxPercent: 40, gradePoint: 4, remark: 'Pass' },
  { grade: 'E', minPercent: 0, maxPercent: 32, gradePoint: null, remark: 'Needs improvement' },
];

export const gradeBandSchema = z.object({
  grade: z
    .string()
    .trim()
    .min(1, 'Enter a grade')
    .max(4, 'Max 4 characters')
    .regex(/^[A-Za-z0-9+-]+$/, 'Letters, digits, + or - only'),
  minPercent: z.coerce.number().min(0).max(100),
  maxPercent: z.coerce.number().min(0).max(100),
  gradePoint: orNull(z.coerce.number().min(0).max(10)),
  remark: orNull(z.string().trim().max(40)),
});

export const gradeScaleSchema = z
  .object({ grades: z.array(gradeBandSchema).min(1, 'Add at least one grade').max(20) })
  .superRefine(({ grades }, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['grades'], message });
    const names = grades.map((g) => g.grade.toUpperCase());
    if (new Set(names).size !== names.length) issue('Each grade must be different');
    for (const g of grades) if (g.minPercent > g.maxPercent) issue(`${g.grade}: min % is more than max %`);
    const sorted = [...grades].sort((a, b) => a.minPercent - b.minPercent);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].minPercent <= sorted[i - 1].maxPercent) issue(`${sorted[i - 1].grade} and ${sorted[i].grade} overlap`);
    }
    if (sorted[0] && sorted[0].minPercent !== 0) issue('The lowest grade must start at 0%');
  });
export type GradeScaleInput = z.infer<typeof gradeScaleSchema>;

/** Grade for a percentage: the band with the highest minimum the percentage reaches. */
export function gradeForPercent(pct: number | null | undefined, scale: GradeBand[]): string | null {
  if (pct == null || !Number.isFinite(pct) || !scale.length) return null;
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  return (sorted.find((g) => pct >= g.minPercent) ?? sorted[sorted.length - 1]).grade;
}

// ─────────────── Marks & remarks ───────────────

/** Problem with a typed mark, or null when it is fine. */
export function marksError(v: number, max: number): string | null {
  if (!Number.isFinite(v)) return 'Enter a number';
  if (v < 0) return 'Cannot be negative';
  if (v > max) return `Max ${max}`;
  if (!isHalfMarkStep(v)) return 'Use steps of 0.5';
  return null;
}

export const markEntrySchema = z.object({
  studentId: z.string().min(1),
  /** Scholastic subjects. null (and not absent) clears the entry. */
  marks: z.number().min(0).max(1000).refine(isHalfMarkStep, 'Marks must be in steps of 0.5').nullable().default(null),
  /** Co-scholastic subjects: a letter from the school's grade scale. */
  grade: orNull(z.string().trim().max(4)).default(null),
  isAbsent: z.boolean().default(false),
});

export const marksEntrySchema = z.object({
  sectionId: z.string().min(1),
  subjectId: z.string().min(1),
  entries: z
    .array(markEntrySchema)
    .min(1, 'Nothing to save')
    .max(300)
    .refine((e) => new Set(e.map((x) => x.studentId)).size === e.length, 'A student is listed twice'),
});
export type MarksEntryInput = z.infer<typeof marksEntrySchema>;

export const examRemarksSchema = z.object({
  sectionId: z.string().min(1),
  entries: z
    .array(z.object({ studentId: z.string().min(1), remark: orNull(z.string().trim().max(300)) }))
    .min(1, 'Nothing to save')
    .max(300),
});
export type ExamRemarksInput = z.infer<typeof examRemarksSchema>;

export type ExamResultStatus = 'PASS' | 'FAIL' | 'PENDING';
