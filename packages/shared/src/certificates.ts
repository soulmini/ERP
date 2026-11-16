// Zod schemas & types for the certificates module (shared by API and web).
import { z } from 'zod';
import { numberToWords } from './money';

// ───────────────────────── Types & metadata ─────────────────────────

export const CERT_TYPES = ['TC', 'CC', 'DOB', 'BONAFIDE'] as const;
export type CertType = (typeof CERT_TYPES)[number];

export const CERT_META: Record<
  CertType,
  { slug: string; title: string; short: string; prefix: string; icon: string; description: string }
> = {
  TC: {
    slug: 'tc',
    title: 'Transfer Certificate',
    short: 'TC',
    prefix: 'TC',
    icon: '🏫',
    description: 'School leaving certificate (UP / CBSE format). Marks the student as left.',
  },
  CC: {
    slug: 'cc',
    title: 'Character Certificate',
    short: 'CC',
    prefix: 'CC',
    icon: '🏅',
    description: 'Conduct and character during the years of study.',
  },
  DOB: {
    slug: 'dob',
    title: 'Date of Birth Certificate',
    short: 'DOB',
    prefix: 'DOB',
    icon: '🎂',
    description: 'Date of birth as per the admission register, in figures and words.',
  },
  BONAFIDE: {
    slug: 'bonafide',
    title: 'Bonafide Certificate',
    short: 'Bonafide',
    prefix: 'BC',
    icon: '🎓',
    description: 'Proof of current study — for bank accounts, scholarships, passports.',
  },
};

export const certTypeFromSlug = (slug: string | undefined | null): CertType | null =>
  CERT_TYPES.find((t) => CERT_META[t].slug === slug?.toLowerCase()) ?? null;

/** ("TC", 2026, 1) → "TC/2026/0001" */
export const certSerial = (type: CertType, year: string | number, n: number) =>
  `${CERT_META[type].prefix}/${year}/${String(n).padStart(4, '0')}`;

/** 1 → "GP/00001" */
export const gatePassSerial = (n: number) => `GP/${String(n).padStart(5, '0')}`;

// ───────────────────────── Wording helpers ─────────────────────────

const ORDINALS = [
  '', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth',
  'Nineteenth', 'Twentieth',
];
const TENS_ORDINAL: Record<number, string> = { 2: 'Twentieth', 3: 'Thirtieth', 4: 'Fortieth', 5: 'Fiftieth' };
const TENS_WORD: Record<number, string> = { 2: 'Twenty', 3: 'Thirty', 4: 'Forty', 5: 'Fifty' };

/** 1 → "First", 21 → "Twenty First", 31 → "Thirty First" (1–59). */
function ordinalWord(n: number): string {
  if (n <= 20) return ORDINALS[n] ?? String(n);
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (!TENS_WORD[t]) return String(n);
  return u ? `${TENS_WORD[t]} ${ORDINALS[u]}` : TENS_ORDINAL[t];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseIsoDate(iso: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

/** '2018-05-15' → "Fifteenth May Two Thousand Eighteen" ('' if not a valid date). */
export function dateInWords(iso: string | null | undefined): string {
  const p = parseIsoDate(iso);
  return p ? `${ordinalWord(p.d)} ${MONTHS[p.mo - 1]} ${numberToWords(p.y)}` : '';
}

/** '2018-05-15' → '15-05-2018' (returns the input unchanged if it is not YYYY-MM-DD). */
export function dmyDate(iso: string | null | undefined): string {
  const p = parseIsoDate(iso);
  return p ? `${String(p.d).padStart(2, '0')}-${String(p.mo).padStart(2, '0')}-${p.y}` : (iso ?? '');
}

const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};
const NAMED_CLASSES: Record<string, string> = {
  NURSERY: 'Nursery',
  'PRE-NURSERY': 'Pre-Nursery',
  PG: 'Play Group',
  KG: 'Kindergarten',
  LKG: 'Lower Kindergarten',
  UKG: 'Upper Kindergarten',
};

/** Class name in words for the TC: "5" → "Fifth", "VIII" → "Eighth", "LKG" → "Lower Kindergarten". */
export function classInWords(cls: string | null | undefined): string {
  const s = (cls ?? '').trim();
  const k = s.toUpperCase().replace(/^CLASS\s+/, '').replace(/(ST|ND|RD|TH)$/, '');
  if (NAMED_CLASSES[k]) return NAMED_CLASSES[k];
  const n = /^\d+$/.test(k) ? Number(k) : ROMAN[k];
  return n && n <= 59 ? ordinalWord(n) : s;
}

/** Gender-aware wording for certificate text. */
export function genderWords(g: string | null | undefined) {
  if (g === 'FEMALE') return { child: 'daughter', he: 'she', He: 'She', his: 'her', His: 'Her', him: 'her' };
  if (g === 'MALE') return { child: 'son', he: 'he', He: 'He', his: 'his', His: 'His', him: 'him' };
  return { child: 'ward', he: 'he/she', He: 'He/She', his: 'his/her', His: 'His/Her', him: 'him/her' };
}

// ───────────────────────── Certificate data (snapshot) schemas ─────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), 'Enter a valid date');
const req = (max = 120) => z.string().trim().min(1, 'Required').max(max, `At most ${max} characters`);
const opt = (max = 300) => z.string().trim().max(max, `At most ${max} characters`).default('');

/** Fields printed on every certificate. Everything is editable before issuing. */
export const certCommonSchema = z.object({
  studentName: req(100),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  fatherName: opt(100),
  motherName: opt(100),
  admissionNo: req(40),
  srNo: opt(40),
  className: req(40), // "5-A"
  session: req(20), // "2026-27"
  dob: isoDate,
  dobWords: req(120),
  issueDate: isoDate,
  remarks: opt(500),
});

const parentRequired = (d: { fatherName: string; motherName: string }, ctx: z.RefinementCtx) => {
  if (!d.fatherName && !d.motherName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fatherName'], message: "Enter the father's or mother's name" });
  }
};

export const tcDataSchema = certCommonSchema
  .extend({
    penNo: opt(40),
    nationality: req(40),
    category: opt(40),
    admissionDate: isoDate,
    admissionClass: req(40),
    lastClass: req(40),
    lastClassWords: req(80),
    lastExam: opt(200),
    failedInClass: opt(100),
    subjects: opt(500),
    qualifiedForPromotion: opt(120),
    feesPaidUpTo: opt(60),
    feeConcession: opt(200),
    workingDays: opt(10),
    presentDays: opt(10),
    nccScoutGuide: opt(120),
    gamesActivities: opt(300),
    conduct: req(60),
    applicationDate: isoDate,
    leavingReason: req(200),
  })
  .superRefine((d, ctx) => {
    parentRequired(d, ctx);
    if (d.applicationDate > d.issueDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['applicationDate'], message: 'Application date is after the issue date' });
    }
    if (d.admissionDate > d.issueDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['admissionDate'], message: 'Admission date is after the issue date' });
    }
  });

export const ccDataSchema = certCommonSchema
  .extend({
    studiedFrom: isoDate,
    studiedTo: isoDate,
    conduct: req(60),
  })
  .superRefine((d, ctx) => {
    parentRequired(d, ctx);
    if (d.studiedTo < d.studiedFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['studiedTo'], message: 'Must be on or after "studied from"' });
    }
  });

export const dobDataSchema = certCommonSchema.extend({ purpose: opt(200) }).superRefine(parentRequired);
export const bonafideDataSchema = certCommonSchema.extend({ purpose: opt(200) }).superRefine(parentRequired);

export const CERT_DATA_SCHEMAS = {
  TC: tcDataSchema,
  CC: ccDataSchema,
  DOB: dobDataSchema,
  BONAFIDE: bonafideDataSchema,
} as const;

export type TcData = z.infer<typeof tcDataSchema>;
export type CcData = z.infer<typeof ccDataSchema>;
export type DobCertData = z.infer<typeof dobDataSchema>;
export type BonafideData = z.infer<typeof bonafideDataSchema>;
/** What is stored in IssuedCertificate.data (plus currentStudent, set by the server at issue time). */
export type CertSnapshot = Partial<TcData & CcData & DobCertData & BonafideData> & { currentStudent?: boolean };

/** POST /certificates — `data` is validated with CERT_DATA_SCHEMAS[type]. */
export const issueCertificateSchema = z.object({
  studentId: z.string().min(1, 'Select a student'),
  type: z.enum(CERT_TYPES),
  data: z.record(z.string(), z.unknown()),
  /** TC only: explicit confirmation that the student will be marked LEFT. */
  confirmLeft: z.boolean().optional(),
});
export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;

export const cancelCertificateSchema = z.object({
  reason: z.string().trim().min(3, 'Enter the reason for cancelling').max(300),
  /** TC only: put the student back to ACTIVE (the TC was issued by mistake). */
  restoreStudent: z.boolean().optional(),
});
export type CancelCertificateInput = z.infer<typeof cancelCertificateSchema>;

// ───────────────────────── Gate pass ─────────────────────────

const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');

/** A student leaving early, collected by a parent / guardian. */
export const studentGatePassSchema = z.object({
  kind: z.literal('STUDENT'),
  studentId: z.string().min(1, 'Select a student'),
  personName: req(100),
  relation: req(60),
  phone: mobile,
  reason: req(300),
  /** Out time today (school timezone); defaults to now. */
  outTime: hhmm.optional(),
});

/** A visitor entering the campus. */
export const visitorGatePassSchema = z.object({
  kind: z.literal('VISITOR'),
  visitorName: req(100),
  phone: mobile,
  whomToMeet: req(100),
  reason: req(300),
  outTime: hhmm.optional(),
});

export const gatePassSchema = z.discriminatedUnion('kind', [studentGatePassSchema, visitorGatePassSchema]);
export type GatePassInput = z.infer<typeof gatePassSchema>;
