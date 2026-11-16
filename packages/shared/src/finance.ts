// Zod schemas, constants & pure helpers for the finance modules — Salary (payroll), Accounts, Inventory.
// Shared by the API (validation) and the web (forms + live previews). All money values are integer PAISE.
import { z } from 'zod';
import { dateOnlySchema } from './schemas';

// ───────────────────────── helpers ─────────────────────────

/** Integer paise in [0, max]. */
const paise = (max: number) =>
  z
    .number({ required_error: 'Enter an amount', invalid_type_error: 'Enter a valid amount' })
    .int('Use at most 2 decimal places')
    .min(0, 'Cannot be negative')
    .max(max, 'Amount is too large');

/** Optional trimmed text; blank → undefined. */
const optText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() || undefined : (v ?? undefined)),
    z.string().max(max, `At most ${max} characters`).optional(),
  );

/** Nullable cleaned text; blank → null (used to clear a value). */
const nullableText = (clean: (s: string) => string, inner: z.ZodString) =>
  z.preprocess((v) => (typeof v === 'string' ? clean(v) || null : (v ?? null)), inner.nullable());

/** ₹10 lakh — cap for one salary component / per-unit rate. */
const MAX_COMPONENT = 100_000_000;
/** ₹1 crore — cap for one ledger transaction. */
const MAX_TXN = 1_000_000_000;
const MAX_QTY = 1_000_000;

// ───────────────────────── payment modes ─────────────────────────

/** Modes for salary payments and manual ledger entries (ONLINE is used only by fee receipts). */
export const FINANCE_PAYMENT_MODES = ['CASH', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'CARD'] as const;
export type FinancePaymentMode = (typeof FINANCE_PAYMENT_MODES)[number];
export const FINANCE_MODE_LABELS: Record<FinancePaymentMode | 'ONLINE', string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  ONLINE: 'Online',
};

// ───────────────────────── Salary ─────────────────────────

export const SALARY_EARNING_FIELDS = [
  { key: 'basic', label: 'Basic pay' },
  { key: 'hra', label: 'House rent allowance (HRA)' },
  { key: 'da', label: 'Dearness allowance (DA)' },
  { key: 'conveyance', label: 'Conveyance' },
  { key: 'otherAllowance', label: 'Other allowance' },
] as const;
export const SALARY_DEDUCTION_FIELDS = [
  { key: 'pf', label: 'Provident fund (PF)' },
  { key: 'esi', label: 'ESI' },
  { key: 'tds', label: 'TDS (income tax)' },
  { key: 'otherDeduction', label: 'Other deduction' },
] as const;
export type SalaryEarningKey = (typeof SALARY_EARNING_FIELDS)[number]['key'];
export type SalaryDeductionKey = (typeof SALARY_DEDUCTION_FIELDS)[number]['key'];
export type SalaryComponents = Record<SalaryEarningKey | SalaryDeductionKey, number>;

/** Monthly gross / deductions / net of a salary structure (paise). */
export function salaryTotals(s: Partial<Record<SalaryEarningKey | SalaryDeductionKey, number | null | undefined>>) {
  const gross = SALARY_EARNING_FIELDS.reduce((n, f) => n + (s[f.key] ?? 0), 0);
  const deductions = SALARY_DEDUCTION_FIELDS.reduce((n, f) => n + (s[f.key] ?? 0), 0);
  return { gross, deductions, net: Math.max(0, gross - deductions) };
}

export const salaryStructureSchema = z
  .object({
    basic: paise(MAX_COMPONENT).min(1, 'Basic pay is required'),
    hra: paise(MAX_COMPONENT).default(0),
    da: paise(MAX_COMPONENT).default(0),
    conveyance: paise(MAX_COMPONENT).default(0),
    otherAllowance: paise(MAX_COMPONENT).default(0),
    pf: paise(MAX_COMPONENT).default(0),
    esi: paise(MAX_COMPONENT).default(0),
    tds: paise(MAX_COMPONENT).default(0),
    otherDeduction: paise(MAX_COMPONENT).default(0),
    effectiveFrom: dateOnlySchema,
  })
  .superRefine((s, ctx) => {
    const t = salaryTotals(s);
    if (t.deductions > t.gross) {
      ctx.addIssue({ code: 'custom', path: ['totalDeductions'], message: 'Total deductions cannot be more than the gross salary' });
    }
  });
export type SalaryStructureInput = z.infer<typeof salaryStructureSchema>;

/** Bank details on the Staff record (blank clears a field). */
export const staffBankSchema = z.object({
  bankName: nullableText((s) => s.trim().replace(/\s+/g, ' '), z.string().max(80, 'At most 80 characters')),
  bankAccount: nullableText(
    (s) => s.replace(/[\s-]/g, ''),
    z.string().regex(/^\d{6,20}$/, 'Account number should be 6–20 digits'),
  ),
  ifsc: nullableText((s) => s.trim().toUpperCase(), z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks like SBIN0001234')),
  pan: nullableText((s) => s.trim().toUpperCase(), z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN looks like ABCDE1234F')),
});
export type StaffBankInput = z.infer<typeof staffBankSchema>;

/** Leave days per month that are paid; leave beyond this is loss of pay. */
export const PAID_LEAVE_PER_MONTH = 1.5;

/** How working days with no staff-attendance record are counted. */
export const UNMARKED_DAY_RULES = ['PRESENT', 'ABSENT'] as const;
export type UnmarkedDayRule = (typeof UNMARKED_DAY_RULES)[number];

export const payrollGenerateSchema = z.object({
  treatUnmarkedAs: z.enum(UNMARKED_DAY_RULES).default('PRESENT'),
});

/** Manual adjustment on a DRAFT payslip. */
export const payslipAdjustSchema = z
  .object({
    extraAllowance: paise(MAX_COMPONENT).default(0),
    extraDeduction: paise(MAX_COMPONENT).default(0),
    note: optText(200),
  })
  .superRefine((v, ctx) => {
    if ((v.extraAllowance || v.extraDeduction) && !v.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Add a note explaining the adjustment' });
    }
  });
export type PayslipAdjustInput = z.infer<typeof payslipAdjustSchema>;

export const payslipPaySchema = z.object({
  paidAt: dateOnlySchema,
  mode: z.enum(FINANCE_PAYMENT_MODES),
  reference: optText(100),
});
export type PayslipPayInput = z.infer<typeof payslipPaySchema>;

/** Loss of pay = gross ÷ working days × unpaid days, rounded to the paisa. */
export function lossOfPay(gross: number, workingDays: number, unpaidDays: number) {
  return workingDays > 0 ? Math.round((gross * unpaidDays) / workingDays) : 0;
}

/** Net pay = gross − deductions − loss of pay, never below 0. */
export function payslipNet(p: { gross: number; deductions: number; lop: number }) {
  return Math.max(0, p.gross - p.deductions - p.lop);
}

export type StaffDayStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY';

export interface PayslipAttendance {
  workingDays: number;
  /** day counts by status (working days only) */
  present: number;
  late: number;
  halfDay: number;
  leave: number;
  absent: number;
  holiday: number;
  unmarked: number;
  notJoined: number;
  unmarkedAs: UnmarkedDayRule;
  paidLeave: number;
  unpaidLeave: number;
  /** present + late + ½ half-days + marked holidays (+ unmarked when counted present) */
  presentDays: number;
  /** absent + ½ half-days + days before joining (+ unmarked when counted absent) */
  absentDays: number;
  unpaidDays: number;
  paidDays: number;
}

/**
 * Attendance → paid / unpaid days for one staff member in one month.
 * PRESENT/LATE = 1 day, HALF_DAY = ½, LEAVE is paid up to PAID_LEAVE_PER_MONTH, ABSENT is unpaid,
 * a working day with no record follows `unmarkedAs`, days before joining are unpaid.
 * Records on Sundays / holidays are ignored (only `workingDates` are looked at).
 */
export function summarizeStaffAttendance(
  workingDates: string[],
  records: Map<string, StaffDayStatus>,
  joiningDate: string | null,
  unmarkedAs: UnmarkedDayRule,
): PayslipAttendance {
  const c = { present: 0, late: 0, halfDay: 0, leave: 0, absent: 0, holiday: 0, unmarked: 0, notJoined: 0 };
  for (const d of workingDates) {
    const st = records.get(d);
    if (st === 'PRESENT') c.present++;
    else if (st === 'LATE') c.late++;
    else if (st === 'HALF_DAY') c.halfDay++;
    else if (st === 'LEAVE') c.leave++;
    else if (st === 'ABSENT') c.absent++;
    else if (st === 'HOLIDAY') c.holiday++;
    else if (joiningDate && d < joiningDate) c.notJoined++;
    else c.unmarked++;
  }
  const paidLeave = Math.min(c.leave, PAID_LEAVE_PER_MONTH);
  const unpaidLeave = c.leave - paidLeave;
  const presentDays = c.present + c.late + c.halfDay * 0.5 + c.holiday + (unmarkedAs === 'PRESENT' ? c.unmarked : 0);
  const absentDays = c.absent + c.halfDay * 0.5 + c.notJoined + (unmarkedAs === 'ABSENT' ? c.unmarked : 0);
  const unpaidDays = absentDays + unpaidLeave;
  return {
    workingDays: workingDates.length,
    ...c,
    unmarkedAs,
    paidLeave,
    unpaidLeave,
    presentDays,
    absentDays,
    unpaidDays,
    paidDays: workingDates.length - unpaidDays,
  };
}

export interface PayslipLine {
  key: string;
  label: string;
  amount: number;
}

export interface PayslipStaff {
  name: string;
  employeeCode: string;
  designation: string;
  joiningDate: string | null;
  bankName: string | null;
  bankAccount: string | null;
  ifsc: string | null;
  pan: string | null;
}

/** Snapshot stored in Payslip.breakdown (JSON) — everything needed to print the slip later. */
export interface PayslipBreakdown {
  version: 1;
  structure: SalaryComponents & { effectiveFrom: string };
  /** gross of the salary structure (LOP is computed on this) */
  structureGross: number;
  /** PF + ESI + TDS + other deduction of the structure */
  fixedDeductions: number;
  /** structure earnings + extra allowance (if any) */
  earnings: PayslipLine[];
  /** structure deductions + extra deduction (if any); loss of pay is separate */
  deductions: PayslipLine[];
  adjustment: { extraAllowance: number; extraDeduction: number; note: string | null };
  attendance: PayslipAttendance;
  calendar: { daysInMonth: number; sundays: number; holidays: number; workingDays: number };
  /** structure gross ÷ working days (paise, rounded) */
  perDay: number;
  staff: PayslipStaff;
}

// ───────────────────────── Accounts ─────────────────────────

export const TXN_TYPES = ['INCOME', 'EXPENSE'] as const;
export type TxnKind = (typeof TXN_TYPES)[number];

/** Created automatically the first time a school opens Accounts. */
export const DEFAULT_ACCOUNT_CATEGORIES: { name: string; type: TxnKind }[] = [
  { name: 'Donation', type: 'INCOME' },
  { name: 'Other income', type: 'INCOME' },
  ...['Electricity', 'Water', 'Stationery', 'Maintenance', 'Transport fuel', 'Events', 'Rent', 'Miscellaneous'].map(
    (name) => ({ name, type: 'EXPENSE' as const }),
  ),
];

export const accountCategorySchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(60, 'At most 60 characters'),
  type: z.enum(TXN_TYPES),
});
export type AccountCategoryInput = z.infer<typeof accountCategorySchema>;

export const accountTxnSchema = z.object({
  date: dateOnlySchema,
  type: z.enum(TXN_TYPES),
  categoryId: z.string({ required_error: 'Choose a category' }).min(1, 'Choose a category'),
  amount: paise(MAX_TXN).min(1, 'Enter an amount'),
  mode: z.enum(FINANCE_PAYMENT_MODES).default('CASH'),
  party: optText(100),
  description: optText(300),
  reference: optText(100),
});
export type AccountTxnInput = z.infer<typeof accountTxnSchema>;

// ───────────────────────── Inventory ─────────────────────────

export const inventoryItemSchema = z.object({
  name: z.string().trim().min(2, 'Enter the item name').max(80, 'At most 80 characters'),
  category: optText(40),
  unit: z.preprocess((v) => (typeof v === 'string' ? v.trim() || 'pcs' : (v ?? 'pcs')), z.string().max(20)),
  minStock: z.number({ invalid_type_error: 'Enter a number' }).int('Whole numbers only').min(0).max(MAX_QTY).default(0),
  /** paise per unit */
  rate: paise(MAX_COMPONENT).nullable().optional(),
  isActive: z.boolean().default(true),
  /** Only on create: recorded as the first "Stock in" movement. */
  openingStock: z.number({ invalid_type_error: 'Enter a number' }).int('Whole numbers only').min(0).max(MAX_QTY).optional(),
});
export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;

const stockQty = z
  .number({ required_error: 'Enter the quantity', invalid_type_error: 'Enter the quantity' })
  .int('Whole numbers only')
  .min(1, 'At least 1')
  .max(MAX_QTY, 'Quantity is too large');

/** Purchase / receipt of stock. */
export const stockInSchema = z.object({
  quantity: stockQty,
  /** paise per unit; when given it also becomes the item's current rate */
  rate: paise(MAX_COMPONENT).nullable().optional(),
  party: optText(100), // supplier
  date: dateOnlySchema,
  remark: optText(200),
});
export type StockInInput = z.infer<typeof stockInSchema>;

/** Issue of stock to a person / class / department. */
export const stockOutSchema = z.object({
  quantity: stockQty,
  party: z.string({ required_error: 'Who is it issued to?' }).trim().min(1, 'Who is it issued to?').max(100),
  date: dateOnlySchema,
  remark: optText(200),
});
export type StockOutInput = z.infer<typeof stockOutSchema>;

/** Correction after a physical count: + adds, − removes. */
export const stockAdjustSchema = z.object({
  quantity: z
    .number({ required_error: 'Enter the quantity', invalid_type_error: 'Enter the quantity' })
    .int('Whole numbers only')
    .min(-MAX_QTY)
    .max(MAX_QTY)
    .refine((v) => v !== 0, 'Enter a + or − quantity'),
  date: dateOnlySchema,
  remark: z.string({ required_error: 'Give a reason' }).trim().min(2, 'Give a reason for the adjustment').max(200),
});
export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;
