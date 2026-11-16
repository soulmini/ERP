// Zod schemas & types for the admissions module (shared by API and web).
import { z } from 'zod';

// ───────── Labels & option lists ─────────

export const STUDENT_GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export const STUDENT_GENDER_LABELS: Record<(typeof STUDENT_GENDERS)[number], string> = {
  MALE: 'Boy',
  FEMALE: 'Girl',
  OTHER: 'Other',
};

export const GUARDIAN_RELATIONS = ['FATHER', 'MOTHER', 'GUARDIAN'] as const;
export type GuardianRelationKey = (typeof GUARDIAN_RELATIONS)[number];
export const GUARDIAN_RELATION_LABELS: Record<GuardianRelationKey, string> = {
  FATHER: 'Father',
  MOTHER: 'Mother',
  GUARDIAN: 'Guardian',
};

export const STUDENT_CATEGORIES = ['GEN', 'OBC', 'SC', 'ST', 'EWS'] as const;
export const STUDENT_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const STUDENT_STATUSES = ['ACTIVE', 'LEFT', 'PASSED_OUT'] as const;
export type StudentStatusKey = (typeof STUDENT_STATUSES)[number];
export const STUDENT_STATUS_LABELS: Record<StudentStatusKey, string> = {
  ACTIVE: 'Active',
  LEFT: 'Left',
  PASSED_OUT: 'Passed out',
};

export const ENQUIRY_STATUSES = ['NEW', 'FOLLOW_UP', 'CONVERTED', 'CLOSED'] as const;
export type EnquiryStatusKey = (typeof ENQUIRY_STATUSES)[number];
export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatusKey, string> = {
  NEW: 'New',
  FOLLOW_UP: 'Follow-up',
  CONVERTED: 'Converted',
  CLOSED: 'Closed',
};

/** Stored as-is in Enquiry.source. */
export const ENQUIRY_SOURCES = ['walk-in', 'phone', 'reference', 'social media', 'other'] as const;
export const ENQUIRY_SOURCE_LABELS: Record<(typeof ENQUIRY_SOURCES)[number], string> = {
  'walk-in': 'Walk-in',
  phone: 'Phone call',
  reference: 'Reference',
  'social media': 'Social media',
  other: 'Other',
};

// ───────── Field helpers (module-private) ─────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_MSG = 'Enter a valid 10-digit mobile number';

const pad2 = (n: number) => String(n).padStart(2, '0');
const todayIso = () => new Date().toISOString().slice(0, 10);

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD/MM/YYYY' (also '.' separators) → 'YYYY-MM-DD', or null if invalid. */
function looseDate(raw: string): string | null {
  const t = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  let iso: string | null = null;
  if (m) iso = `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) iso = `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
  return iso && isRealDate(iso) ? iso : null;
}

/** "+91 98765-43210" / "098765 43210" → "9876543210" */
function cleanMobile(v: string): string {
  const d = v.replace(/[\s\-().]/g, '');
  if (/^\+?91\d{10}$/.test(d)) return d.slice(-10);
  if (/^0\d{10}$/.test(d)) return d.slice(1);
  return d;
}

/** Optional text: blank → null (clears on update), missing → undefined (unchanged). */
const optText = (max = 120) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .nullish()
    .transform((v) => (v === '' ? null : v));

const optEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' ? null : v), z.enum(values).nullish());

const optDate = optText(10).refine((v) => v == null || isRealDate(v), 'Enter a valid date');

const mobile = z
  .string({ required_error: 'Enter mobile number' })
  .trim()
  .transform(cleanMobile)
  .refine((v) => MOBILE_RE.test(v), MOBILE_MSG);

const optMobile = optText(20)
  .transform((v) => (v ? cleanMobile(v) : v))
  .refine((v) => v == null || MOBILE_RE.test(v), MOBILE_MSG);

const optEmail = optText(120)
  .transform((v) => (v ? v.toLowerCase() : v))
  .refine((v) => v == null || EMAIL_RE.test(v), 'Enter a valid email');

const optAadhaar = optText(20)
  .transform((v) => (v ? v.replace(/[\s-]/g, '') : v))
  .refine((v) => v == null || /^\d{12}$/.test(v), 'Aadhaar must be 12 digits');

const optPincode = optText(10).refine((v) => v == null || /^[1-9]\d{5}$/.test(v), 'PIN code must be 6 digits');

/** Optional whole number from a form ("" → null). */
const optInt = (max: number, msg = 'Enter a whole number') =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v === null ? null : typeof v === 'string' ? Number(v.trim()) : v),
    z.number({ invalid_type_error: msg }).int(msg).min(0, msg).max(max, 'Too large').nullish(),
  );

const dobField = z
  .string({ required_error: 'Enter date of birth' })
  .trim()
  .superRefine((v, ctx) => {
    const msg = !v
      ? 'Enter date of birth'
      : !isRealDate(v)
        ? 'Enter a valid date'
        : v > todayIso()
          ? 'Date of birth cannot be in the future'
          : v < '1950-01-01'
            ? 'Check the year'
            : null;
    if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
  });

// ───────── Enquiries ─────────

export const enquirySchema = z.object({
  studentName: z.string({ required_error: 'Enter the student name' }).trim().min(1, 'Enter the student name').max(100),
  gender: optEnum(STUDENT_GENDERS),
  dob: optDate,
  classId: optText(40),
  guardianName: z.string({ required_error: 'Enter the parent name' }).trim().min(1, 'Enter the parent name').max(100),
  phone: mobile,
  email: optEmail,
  address: optText(300),
  source: optEnum(ENQUIRY_SOURCES),
  notes: optText(2000),
  followUpDate: optDate,
  /** CONVERTED is set only by saving an admission. */
  status: z.enum(['NEW', 'FOLLOW_UP', 'CLOSED']).optional(),
});
export type EnquiryInput = z.infer<typeof enquirySchema>;

// ───────── Student & guardians ─────────

/** Every Student column the office can edit (admission no., class and status are handled separately). */
export const studentProfileSchema = z.object({
  firstName: z.string({ required_error: 'Enter first name' }).trim().min(1, 'Enter first name').max(60),
  lastName: optText(60),
  gender: z.enum(STUDENT_GENDERS, { errorMap: () => ({ message: 'Select gender' }) }),
  dob: dobField,
  bloodGroup: optEnum(STUDENT_BLOOD_GROUPS),
  srNo: optText(30),
  penNo: optText(30),
  aadhaarNo: optAadhaar,
  category: optEnum(STUDENT_CATEGORIES),
  religion: optText(40),
  caste: optText(60),
  motherTongue: optText(40),
  nationality: optText(40),
  phone: optMobile,
  email: optEmail,
  address: optText(300),
  city: optText(60),
  state: optText(60),
  pincode: optPincode,
  previousSchool: optText(150),
  previousClass: optText(30),
  medicalNotes: optText(1000),
  admissionDate: optDate,
});
export type StudentProfileInput = z.infer<typeof studentProfileSchema>;

const guardianFields = {
  relation: z.enum(GUARDIAN_RELATIONS, { errorMap: () => ({ message: 'Select relation' }) }),
  name: z.string({ required_error: 'Enter name' }).trim().min(1, 'Enter name').max(100),
  email: optEmail,
  occupation: optText(80),
  qualification: optText(80),
  /** PAISE (the form shows rupees). */
  annualIncome: optInt(2_000_000_000, 'Enter an amount in rupees'),
  aadhaarNo: optAadhaar,
  address: optText(300),
};

/** A parent / guardian on the admission form. phone may be blank for a non-primary guardian (primary's number is used). */
export const admissionGuardianSchema = z.object({
  ...guardianFields,
  phone: optMobile,
  isPrimary: z.boolean().default(false),
});
export type AdmissionGuardianInput = z.infer<typeof admissionGuardianSchema>;

/** Editing an existing guardian (shared with siblings). */
export const studentGuardianUpdateSchema = z.object({ ...guardianFields, phone: mobile });
export type StudentGuardianUpdateInput = z.infer<typeof studentGuardianUpdateSchema>;

/** Full admission form. */
export const admissionSchema = studentProfileSchema
  .extend({
    sectionId: z.string({ required_error: 'Select class & section' }).min(1, 'Select class & section'),
    rollNo: optInt(9999, 'Roll no. must be a number'),
    /** Blank = next automatic number, e.g. 2026/0021. */
    admissionNo: optText(30),
    enquiryId: optText(40),
    guardians: z.array(admissionGuardianSchema).min(1, 'Add at least one parent or guardian').max(3),
  })
  .superRefine((v, ctx) => {
    const primary = v.guardians.findIndex((g) => g.isPrimary);
    if (primary < 0 || v.guardians.filter((g) => g.isPrimary).length > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['guardians'], message: 'Choose one primary contact (parent app login)' });
    } else if (!v.guardians[primary].phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guardians', primary, 'phone'],
        message: 'Mobile is required for the primary contact (parent app login)',
      });
    }
    const seen = new Set<string>();
    v.guardians.forEach((g, i) => {
      if (seen.has(g.relation)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['guardians', i, 'relation'], message: `${GUARDIAN_RELATION_LABELS[g.relation]} is added twice` });
      }
      seen.add(g.relation);
    });
  });
export type AdmissionInput = z.infer<typeof admissionSchema>;

/** Edit student details (profile → Details). Blank roll no. keeps the current one (or auto-assigns after a class change). */
export const studentUpdateSchema = studentProfileSchema.extend({
  admissionNo: z.string({ required_error: 'Enter admission no.' }).trim().min(1, 'Enter admission no.').max(30),
  sectionId: optText(40),
  rollNo: optInt(9999, 'Roll no. must be a number'),
});
export type StudentUpdateInput = z.infer<typeof studentUpdateSchema>;

export const studentLeaveSchema = z.object({
  status: z.enum(['LEFT', 'PASSED_OUT']).default('LEFT'),
  leftDate: z.string({ required_error: 'Enter the date' }).trim().refine(isRealDate, 'Enter a valid date'),
  leftReason: z.string({ required_error: 'Enter a reason' }).trim().min(1, 'Enter a reason').max(300),
});
export type StudentLeaveInput = z.infer<typeof studentLeaveSchema>;

export const studentReactivateSchema = z.object({
  /** Needed only when the student has no class in the current session. */
  sectionId: optText(40),
  rollNo: optInt(9999, 'Roll no. must be a number'),
});

// ───────── Promotion ─────────

export const studentPromotionSchema = z.object({
  sourceSectionId: z.string().min(1, 'Select the current class'),
  targetSessionId: z.string().min(1, 'Select the next session'),
  targetSectionId: z.string().min(1, 'Select the new class'),
  studentIds: z.array(z.string().min(1)).min(1, 'Select at least one student').max(500),
  /** KEEP = same roll no. (if free); ALPHA = re-number alphabetically. */
  rollMode: z.enum(['KEEP', 'ALPHA']).default('KEEP'),
});
export type StudentPromotionInput = z.infer<typeof studentPromotionSchema>;

export const studentPassOutSchema = z.object({
  sourceSectionId: z.string().min(1, 'Select the class'),
  studentIds: z.array(z.string().min(1)).min(1, 'Select at least one student').max(500),
  date: z.string().trim().refine(isRealDate, 'Enter a valid date'),
  reason: optText(200),
});
export type StudentPassOutInput = z.infer<typeof studentPassOutSchema>;

// ───────── CSV import ─────────

/** Template columns (in order). */
export const STUDENT_IMPORT_COLUMNS = [
  'firstName',
  'lastName',
  'gender',
  'dob',
  'class',
  'section',
  'rollNo',
  'guardianName',
  'guardianPhone',
  'address',
] as const;
/** Extra columns that are understood when present. */
export const STUDENT_IMPORT_OPTIONAL_COLUMNS = ['admissionNo', 'guardianRelation'] as const;

const GENDER_WORDS: Record<string, (typeof STUDENT_GENDERS)[number]> = {
  m: 'MALE',
  male: 'MALE',
  boy: 'MALE',
  b: 'MALE',
  f: 'FEMALE',
  female: 'FEMALE',
  girl: 'FEMALE',
  g: 'FEMALE',
  o: 'OTHER',
  other: 'OTHER',
};
const RELATION_WORDS: Record<string, GuardianRelationKey> = {
  f: 'FATHER',
  father: 'FATHER',
  m: 'MOTHER',
  mother: 'MOTHER',
  g: 'GUARDIAN',
  guardian: 'GUARDIAN',
};

const csvCell = z.preprocess((v) => (v == null ? '' : String(v)), z.string());

/** One CSV row (all strings) → clean values. Class / section are resolved by the API. */
export const studentImportRowSchema = z.object({
  firstName: csvCell.pipe(z.string().trim().min(1, 'First name is required').max(60)),
  lastName: csvCell.transform((v) => v.trim() || null),
  gender: csvCell.transform((v, ctx) => {
    const g = GENDER_WORDS[v.trim().toLowerCase()];
    if (!g) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.trim() ? `Unknown gender "${v.trim()}" (use M / F)` : 'Gender is required' });
      return z.NEVER;
    }
    return g;
  }),
  dob: csvCell.transform((v, ctx) => {
    const d = looseDate(v);
    const msg = !v.trim()
      ? 'Date of birth is required'
      : !d
        ? `Bad date "${v.trim()}" (use YYYY-MM-DD or DD-MM-YYYY)`
        : d > todayIso()
          ? 'Date of birth is in the future'
          : d < '1950-01-01'
            ? 'Date of birth year looks wrong'
            : null;
    if (msg) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
      return z.NEVER;
    }
    return d!;
  }),
  class: csvCell.pipe(z.string().trim().min(1, 'Class is required')),
  section: csvCell.transform((v) => v.trim().toUpperCase() || null),
  rollNo: csvCell.transform((v, ctx) => {
    const t = v.trim();
    if (!t) return null;
    if (!/^\d{1,4}$/.test(t) || +t < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Roll no. "${t}" must be a whole number` });
      return z.NEVER;
    }
    return +t;
  }),
  guardianName: csvCell.pipe(z.string().trim().min(1, 'Guardian name is required').max(100)),
  guardianPhone: csvCell.transform((v, ctx) => {
    const p = cleanMobile(v.trim());
    if (!MOBILE_RE.test(p)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.trim() ? `Bad mobile "${v.trim()}" (10 digits, starts with 6-9)` : 'Guardian mobile is required' });
      return z.NEVER;
    }
    return p;
  }),
  address: csvCell.transform((v) => v.trim().slice(0, 300) || null),
  admissionNo: csvCell.transform((v) => v.trim().slice(0, 30) || null),
  guardianRelation: csvCell.transform((v, ctx) => {
    const t = v.trim().toLowerCase();
    if (!t) return 'FATHER' as GuardianRelationKey;
    const r = RELATION_WORDS[t];
    if (!r) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown relation "${v.trim()}" (Father / Mother / Guardian)` });
      return z.NEVER;
    }
    return r;
  }),
});
export type StudentImportRow = z.infer<typeof studentImportRowSchema>;

/** Rows as parsed from the CSV in the browser: header → cell text, with the file line number. */
export const studentImportSchema = z.object({
  rows: z
    .array(z.object({ line: z.number().int().min(1), data: z.record(z.string(), z.string().max(500).nullish()) }))
    .min(1, 'The file has no student rows')
    .max(1000, 'Import at most 1000 students at a time'),
});
export type StudentImportInput = z.infer<typeof studentImportSchema>;
