// Zod schemas, constants, response types & pure helpers for the fees module (shared by API and web).
// All money values are integer PAISE. Date-only values are 'YYYY-MM-DD' strings.
import { z } from 'zod';
import { dateOnlySchema } from './schemas';

// ─────────────── Constants ───────────────

export const FEE_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'ONE_TIME'] as const;
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number];
export const FEE_FREQUENCY_LABEL: Record<FeeFrequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-yearly',
  YEARLY: 'Yearly',
  ONE_TIME: 'One-time',
};

/** Modes the office can collect in. (ONLINE is reserved for the payment gateway, later.) */
export const PAYMENT_MODES = ['CASH', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'CARD'] as const;
export type CollectMode = (typeof PAYMENT_MODES)[number];
export type PaymentModeKey = CollectMode | 'ONLINE';
export const PAYMENT_MODE_LABEL: Record<PaymentModeKey, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  ONLINE: 'Online',
};

export const DUE_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'WAIVED'] as const;
export type DueStatusKey = (typeof DUE_STATUSES)[number];

/** Receipt number: ("2026-27", 1) → "R/2026-27/00001". */
export const formatReceiptNo = (sessionName: string, n: number) => `R/${sessionName}/${String(n).padStart(5, '0')}`;

// ─────────────── Schemas ───────────────

const id = z.string().trim().min(1);
/** Paise, up to ₹1 crore per value (DB columns are 32-bit ints). */
const paise = z.number().int('Amount must be in paise').min(0).max(1_000_000_000, 'Amount is too large');
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const feeHeadSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(60),
  frequency: z.enum(FEE_FREQUENCIES),
  order: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});
export type FeeHeadInput = z.infer<typeof feeHeadSchema>;

/** Save cells of the class × head grid for the current session. amount 0 = remove that head from the class. */
export const feeStructureSchema = z.object({
  items: z
    .array(
      z.object({
        classId: id,
        feeHeadId: id,
        amount: paise,
        dueDay: z.number().int().min(1, 'Due day 1–31').max(31, 'Due day 1–31').default(10),
        lateFine: paise.default(0),
      }),
    )
    .max(5000),
});
export type FeeStructureInput = z.infer<typeof feeStructureSchema>;

/** Standing discount: either `percent` (1–100) or flat `amount` (paise off per period). No head = all heads. */
export const concessionSchema = z
  .object({
    studentId: id,
    feeHeadId: id.nullable().optional(),
    percent: z.number().int().min(1, 'Percent 1–100').max(100, 'Percent 1–100').nullable().optional(),
    amount: paise.min(1, 'Enter an amount').nullable().optional(),
    reason: z.string().trim().min(2, 'Give a reason').max(200),
  })
  .refine((v) => (v.percent != null) !== (v.amount != null), {
    message: 'Give either a percentage or a flat amount',
    path: ['percent'],
  });
export type ConcessionInput = z.infer<typeof concessionSchema>;

export const generateDuesSchema = z.object({ classId: id.optional().nullable() });

export const collectPaymentSchema = z
  .object({
    studentId: id,
    date: dateOnlySchema,
    mode: z.enum(PAYMENT_MODES),
    reference: optText(100),
    remarks: optText(300),
    amount: paise.min(1, 'Enter an amount'),
    /** Dues to pay (allocated oldest first). Empty / missing = all open dues, oldest first. */
    dueIds: z.array(id).max(500).optional(),
    /** Collector waives the late fine for the dues this payment covers. */
    waiveFine: z.boolean().default(false),
  })
  .refine((v) => v.mode !== 'CHEQUE' || !!v.reference, { message: 'Enter the cheque number', path: ['reference'] });
export type CollectPaymentInput = z.infer<typeof collectPaymentSchema>;

export const cancelPaymentSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });
export const waiveDueSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });

// ─────────────── Periods ───────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortMon = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3);

/** '2026-04' → 'April 2026' */
export const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** ('2026-04', '2026-06') → 'Apr–Jun 2026'; across years → 'Oct 2026–Mar 2027' */
function monthRangeLabel(a: string, b: string) {
  return a.slice(0, 4) === b.slice(0, 4)
    ? `${shortMon(a)}–${shortMon(b)} ${a.slice(0, 4)}`
    : `${shortMon(a)} ${a.slice(0, 4)}–${shortMon(b)} ${b.slice(0, 4)}`;
}

/** Calendar months of a session: ('2026-04-01', '2027-03-31') → ['2026-04', ..., '2027-03']. */
export function sessionMonths(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7));
  const end = endDate.slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > end) break;
    out.push(key);
    if (++m > 12) (m = 1), y++;
  }
  return out;
}

/** Day `dueDay` of a month, clamped to the month's length: ('2027-02', 31) → '2027-02-28'. */
export function dueDateIn(month: string, dueDay: number) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(1, dueDay), days)).padStart(2, '0')}`;
}

export interface FeePeriod {
  /** "2026-04", "2026-Q1", "2026-H1", "2026-YEAR", "ONE_TIME" */
  period: string;
  label: string;
  dueDate: string;
}

/**
 * Installments of a fee head in a session.
 * MONTHLY → every month; QUARTERLY → Apr/Jul/Oct/Jan; HALF_YEARLY → Apr/Oct; YEARLY & ONE_TIME → first month.
 * (A ONE_TIME head is charged once per student, ever — e.g. admission fee.)
 */
export function feePeriods(
  frequency: FeeFrequency,
  session: { name: string; startDate: string; endDate: string },
  dueDay: number,
): FeePeriod[] {
  const months = sessionMonths(session.startDate, session.endDate);
  if (!months.length) return [];
  const y0 = months[0].slice(0, 4);
  const chunks = (size: number, prefix: string) =>
    Array.from({ length: Math.ceil(months.length / size) }, (_, i) => {
      const first = months[i * size];
      const last = months[Math.min(months.length, (i + 1) * size) - 1];
      return {
        period: `${y0}-${prefix}${i + 1}`,
        label: `${prefix}${i + 1} (${monthRangeLabel(first, last)})`,
        dueDate: dueDateIn(first, dueDay),
      };
    });
  switch (frequency) {
    case 'MONTHLY':
      return months.map((m) => ({ period: m, label: monthName(m), dueDate: dueDateIn(m, dueDay) }));
    case 'QUARTERLY':
      return chunks(3, 'Q');
    case 'HALF_YEARLY':
      return chunks(6, 'H');
    case 'YEARLY':
      return [{ period: `${y0}-YEAR`, label: `Session ${session.name}`, dueDate: dueDateIn(months[0], dueDay) }];
    case 'ONE_TIME':
      return [{ period: 'ONE_TIME', label: 'One-time', dueDate: dueDateIn(months[0], dueDay) }];
  }
}

/** Concession (paise) on one installment of `amount`, from the student's concessions that apply to the head. */
export function concessionFor(amount: number, concessions: { percent: number | null; amount: number | null }[]) {
  const off = concessions.reduce(
    (n, c) => n + (c.percent != null ? Math.round((amount * c.percent) / 100) : 0) + (c.amount ?? 0),
    0,
  );
  return Math.min(amount, Math.max(0, off));
}

// ─────────────── Dues maths (same rules on API and web) ───────────────

export interface DueLike {
  id: string;
  dueDate: string; // YYYY-MM-DD
  amount: number;
  concession: number;
  fine: number; // fine already charged
  paid: number;
  status: DueStatusKey;
  lateFine: number; // the structure's late fine for this head & class
  headOrder?: number;
}

/** What the due costs after concession, including any fine already charged. */
export const dueNet = (d: Pick<DueLike, 'amount' | 'concession' | 'fine'>) => d.amount - d.concession + d.fine;

export const dueBalance = (d: Pick<DueLike, 'amount' | 'concession' | 'fine' | 'paid' | 'status'>) =>
  d.status === 'WAIVED' ? 0 : Math.max(0, dueNet(d) - d.paid);

/** Status a due should have after `paid` (never returns WAIVED). */
export function dueStatusOf(d: Pick<DueLike, 'amount' | 'concession' | 'fine'>, paid: number): 'PAID' | 'PARTIAL' | 'UNPAID' {
  return paid >= dueNet(d) ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
}

/**
 * Late fine that would be charged if the due were paid on `date`:
 * the flat structure fine, once, on an overdue due that has nothing paid yet.
 */
export const pendingFine = (d: DueLike, date: string) =>
  d.status === 'UNPAID' && d.paid === 0 && d.fine === 0 && d.lateFine > 0 && d.dueDate < date ? d.lateFine : 0;

export const isOpenDue = (d: Pick<DueLike, 'status'>) => d.status === 'UNPAID' || d.status === 'PARTIAL';

/** Oldest first: due date, then head order. */
export function sortDues<T extends DueLike>(dues: T[]): T[] {
  return [...dues].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || (a.headOrder ?? 0) - (b.headOrder ?? 0) || a.id.localeCompare(b.id),
  );
}

export interface AllocationLine {
  id: string;
  /** paise from this payment (fine first, then fee) */
  amount: number;
  /** late fine charged by this payment */
  fine: number;
  fineWaived: number;
  paidAfter: number;
  fineAfter: number;
  status: 'PAID' | 'PARTIAL';
}

/**
 * Split a payment over open dues, oldest first.
 * `amount` omitted = pay everything in `dues` in full.
 * Returns `excess` > 0 when the amount is more than what is payable (over-payment).
 */
export function allocatePayment(dues: DueLike[], opts: { amount?: number; date: string; waiveFine?: boolean }) {
  const open = sortDues(dues.filter(isOpenDue));
  const fineOf = (d: DueLike) => pendingFine(d, opts.date);
  const payableOf = (d: DueLike) => dueBalance(d) + (opts.waiveFine ? 0 : fineOf(d));
  const payable = open.reduce((n, d) => n + payableOf(d), 0);
  const amount = opts.amount ?? payable;
  let remaining = amount;
  let fineCharged = 0;
  let fineWaived = 0;
  const lines: AllocationLine[] = [];
  for (const d of open) {
    if (remaining <= 0) break;
    const p = payableOf(d);
    if (p <= 0) continue;
    const take = Math.min(remaining, p);
    const pf = fineOf(d);
    const fine = opts.waiveFine ? 0 : pf;
    const fineAfter = d.fine + fine;
    const paidAfter = d.paid + take;
    lines.push({
      id: d.id,
      amount: take,
      fine,
      fineWaived: opts.waiveFine ? pf : 0,
      paidAfter,
      fineAfter,
      status: paidAfter >= d.amount - d.concession + fineAfter ? 'PAID' : 'PARTIAL',
    });
    remaining -= take;
    fineCharged += fine;
    fineWaived += opts.waiveFine ? pf : 0;
  }
  return { lines, payable, allocated: amount - Math.max(0, remaining), excess: Math.max(0, remaining), fineCharged, fineWaived };
}

/** How a due looks to people: overdue = open and past its due date; upcoming = due in a later month. */
export type DueDisplay = 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' | 'UPCOMING' | 'WAIVED';
export function dueDisplay(d: Pick<DueLike, 'status' | 'dueDate'>, today: string): DueDisplay {
  if (d.status === 'WAIVED' || d.status === 'PAID') return d.status;
  if (d.dueDate < today) return d.status === 'PARTIAL' ? 'PARTIAL' : 'OVERDUE';
  if (d.status === 'PARTIAL') return 'PARTIAL';
  return d.dueDate.slice(0, 7) > today.slice(0, 7) ? 'UPCOMING' : 'UNPAID';
}

// ─────────────── API response shapes ───────────────

export interface FeeHeadRow {
  id: string;
  name: string;
  frequency: FeeFrequency;
  order: number;
  isActive: boolean;
  dues: number;
}

export interface FeeStructureView {
  session: { id: string; name: string; startDate: string; endDate: string };
  heads: FeeHeadRow[];
  classes: { id: string; name: string; students: number; studentsWithDues: number }[];
  items: { classId: string; feeHeadId: string; amount: number; dueDay: number; lateFine: number }[];
}

export interface ConcessionRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  classLabel: string | null;
  feeHeadId: string | null;
  head: string | null;
  percent: number | null;
  amount: number | null;
  reason: string;
  createdAt: string;
}

export interface FeeStudentInfo {
  id: string;
  name: string;
  admissionNo: string;
  photoUrl: string | null;
  status: string;
  classId: string | null;
  classLabel: string | null;
  rollNo: number | null;
  fatherName: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
}

export interface FeeDueRow {
  id: string;
  feeHeadId: string;
  head: string;
  headOrder: number;
  frequency: FeeFrequency;
  period: string;
  label: string;
  dueDate: string;
  amount: number;
  concession: number;
  fine: number;
  paid: number;
  status: DueStatusKey;
  lateFine: number;
  balance: number;
  /** late fine that will be added if paid today */
  pendingFine: number;
  display: DueDisplay;
}

export interface FeePaymentRow {
  id: string;
  receiptNo: string;
  date: string;
  amount: number;
  mode: PaymentModeKey;
  reference: string | null;
  remarks: string | null;
  collectedBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  student?: { id: string; name: string; admissionNo: string; classLabel: string | null };
}

export interface FeeTotals {
  /** whole session after concession (+ fines charged), excluding waived */
  total: number;
  paid: number;
  /** balance of everything in the session */
  balance: number;
  /** balance of dues due up to today */
  dueTillToday: number;
  overdue: number;
  /** late fines that would be added if all overdue dues were paid today */
  pendingFine: number;
}

export interface FeeCard {
  today: string;
  session: { id: string; name: string };
  student: FeeStudentInfo;
  dues: FeeDueRow[];
  payments: FeePaymentRow[];
  concessions: ConcessionRow[];
  totals: FeeTotals;
  /** dues created automatically when the card was opened */
  generated: number;
}

export interface FeeSearchRow {
  id: string;
  name: string;
  admissionNo: string;
  photoUrl: string | null;
  classLabel: string | null;
  rollNo: number | null;
  guardianName: string | null;
  guardianPhone: string | null;
  /** balance of dues due up to today */
  dueTillToday: number;
}

export interface ReceiptLine {
  head: string;
  periods: string;
  /** gross fee of those installments */
  fee: number;
  concession: number;
  fine: number;
  /** paid by this receipt */
  paid: number;
}

export interface ReceiptDetail {
  id: string;
  receiptNo: string;
  date: string;
  amount: number;
  mode: PaymentModeKey;
  reference: string | null;
  remarks: string | null;
  collectedBy: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  session: string;
  student: FeeStudentInfo;
  lines: ReceiptLine[];
  totalFine: number;
  /** balance still due (up to today) after this receipt, for the student */
  balanceDue: number;
}

export interface FeeSummary {
  todayCollection: number;
  monthCollection: number;
  /** balance of dues due up to today */
  outstanding: number;
  overdueStudents: number;
  todayReceipts: number;
}

export interface CollectionReport {
  from: string;
  to: string;
  total: number;
  count: number;
  cancelled: number;
  byMode: { mode: PaymentModeKey; amount: number; count: number }[];
  byCollector: { id: string | null; name: string; amount: number; count: number }[];
  byDay: { date: string; amount: number; count: number }[];
  receipts: FeePaymentRow[];
}

export interface DefaulterRow {
  studentId: string;
  name: string;
  admissionNo: string;
  classId: string | null;
  classLabel: string | null;
  classOrder: number;
  rollNo: number | null;
  guardianName: string | null;
  guardianPhone: string | null;
  /** number of overdue installments */
  periods: number;
  oldestDue: string;
  overdue: number;
  pendingFine: number;
}

export interface ClasswiseRow {
  classId: string;
  className: string;
  students: number;
  expected: number;
  collected: number;
  outstanding: number;
  dueTillToday: number;
  overdueStudents: number;
}
