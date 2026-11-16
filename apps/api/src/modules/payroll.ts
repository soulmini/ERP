import { Router } from 'express';
import {
  SALARY_DEDUCTION_FIELDS,
  SALARY_EARNING_FIELDS,
  lossOfPay,
  payrollGenerateSchema,
  payslipAdjustSchema,
  payslipNet,
  payslipPaySchema,
  salaryStructureSchema,
  salaryTotals,
  staffBankSchema,
  summarizeStaffAttendance,
  type PayslipBreakdown,
  type PayslipStaff,
  type SalaryComponents,
  type StaffDayStatus,
} from '@erp/shared';
import { prisma } from '../db';
import type { PayrollStatus, Payslip, Prisma, SalaryStructure } from '../generated/prisma/client';
import { badRequest, conflict, notFound, parse, str } from '../lib/http';
import { currentMonthStr, dateOnly, monthRange, toDateStr, todayStr } from '../lib/dates';
import { audit } from '../lib/audit';
import { authOf, can } from '../middleware/auth';

/** Salary structures, monthly payroll, payslips. Everything here needs `payroll.manage`. */
export const payrollRouter = Router();
payrollRouter.use(can('payroll.manage'));

const DAY = 86_400_000;
/** Interactive transactions talk to a remote DB several times — give them room. */
const TX = { timeout: 30_000, maxWait: 15_000 };

const fullName = (s: { firstName: string; lastName: string | null }) => `${s.firstName} ${s.lastName ?? ''}`.trim();
const dateStr = (d: Date | null | undefined) => (d ? toDateStr(d) : null);

/** '2026-11' → 'November 2026' */
export const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function monthParam(v: unknown): string {
  const m = str(v, 'month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw badRequest('Month must be YYYY-MM');
  return m;
}

const staffSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  designation: true,
  joiningDate: true,
  bankName: true,
  bankAccount: true,
  ifsc: true,
  pan: true,
} as const satisfies Prisma.StaffSelect;
type StaffLite = Prisma.StaffGetPayload<{ select: typeof staffSelect }>;

function staffSnapshot(s: StaffLite): PayslipStaff {
  return {
    name: fullName(s),
    employeeCode: s.employeeCode,
    designation: s.designation,
    joiningDate: dateStr(s.joiningDate),
    bankName: s.bankName,
    bankAccount: s.bankAccount,
    ifsc: s.ifsc,
    pan: s.pan,
  };
}
const sameStaff = (a: PayslipStaff | undefined, b: PayslipStaff) =>
  !!a && (Object.keys(b) as (keyof PayslipStaff)[]).every((k) => (a[k] ?? null) === (b[k] ?? null));

const components = (s: SalaryStructure): SalaryComponents => ({
  basic: s.basic,
  hra: s.hra,
  da: s.da,
  conveyance: s.conveyance,
  otherAllowance: s.otherAllowance,
  pf: s.pf,
  esi: s.esi,
  tds: s.tds,
  otherDeduction: s.otherDeduction,
});

const structureOut = (s: SalaryStructure) => ({
  ...components(s),
  effectiveFrom: toDateStr(s.effectiveFrom),
  updatedAt: s.updatedAt,
  ...salaryTotals(s),
});

async function staffOfSchool(id: string, schoolId: string) {
  const s = await prisma.staff.findFirst({ where: { id, schoolId }, include: { salaryStructure: true } });
  if (!s) throw notFound('Staff not found');
  return s;
}

// ═════════════════════ Calendar: working days of a month ═════════════════════

/** Working days = days in month − Sundays − holiday days (Holiday rows, ranges expanded, Sundays not double-counted). */
async function monthCalendar(schoolId: string, month: string) {
  const { from, to, days } = monthRange(month);
  const holidays = await prisma.holiday.findMany({
    where: { schoolId, date: { lt: to }, OR: [{ date: { gte: from } }, { endDate: { gte: from } }] },
    orderBy: { date: 'asc' },
    select: { name: true, date: true, endDate: true },
  });
  const holidayOn = new Map<string, string>();
  const list = holidays.map((h) => {
    const start = Math.max(h.date.getTime(), from.getTime());
    const end = Math.min((h.endDate ?? h.date).getTime(), to.getTime() - DAY);
    let count = 0;
    for (let t = start; t <= end; t += DAY) {
      const d = new Date(t);
      if (d.getUTCDay() === 0) continue; // Sunday is already off
      const key = toDateStr(d);
      if (!holidayOn.has(key)) {
        holidayOn.set(key, h.name);
        count++;
      }
    }
    return { name: h.name, from: toDateStr(h.date), to: toDateStr(h.endDate ?? h.date), days: count };
  });
  const workingDates: string[] = [];
  let sundays = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * DAY);
    if (d.getUTCDay() === 0) sundays++;
    else if (!holidayOn.has(toDateStr(d))) workingDates.push(toDateStr(d));
  }
  return {
    month,
    label: monthLabel(month),
    daysInMonth: days,
    sundays,
    holidayDays: holidayOn.size,
    holidays: list.filter((h) => h.days > 0),
    workingDays: workingDates.length,
    workingDates,
  };
}
type Calendar = Awaited<ReturnType<typeof monthCalendar>>;

// ═════════════════════ Payslip computation ═════════════════════

const NO_ADJUSTMENT: PayslipBreakdown['adjustment'] = { extraAllowance: 0, extraDeduction: 0, note: null };

/** Fill earnings/deductions lines and compute the payslip columns from a breakdown snapshot. */
function withAmounts(b: PayslipBreakdown, lop: number) {
  b.earnings = [
    ...SALARY_EARNING_FIELDS.map((f) => ({ key: f.key as string, label: f.label as string, amount: b.structure[f.key] })),
    ...(b.adjustment.extraAllowance ? [{ key: 'extraAllowance', label: 'Extra allowance', amount: b.adjustment.extraAllowance }] : []),
  ];
  b.deductions = [
    ...SALARY_DEDUCTION_FIELDS.map((f) => ({ key: f.key as string, label: f.label as string, amount: b.structure[f.key] })),
    ...(b.adjustment.extraDeduction ? [{ key: 'extraDeduction', label: 'Extra deduction', amount: b.adjustment.extraDeduction }] : []),
  ];
  const gross = b.structureGross + b.adjustment.extraAllowance;
  const deductions = b.fixedDeductions + b.adjustment.extraDeduction;
  return {
    workingDays: b.attendance.workingDays,
    presentDays: b.attendance.presentDays,
    leaveDays: b.attendance.leave,
    absentDays: b.attendance.absentDays,
    paidDays: b.attendance.paidDays,
    gross,
    deductions,
    lopDeduction: lop,
    net: payslipNet({ gross, deductions, lop }),
    breakdown: b as unknown as Prisma.InputJsonValue,
  };
}

function buildSlip(
  structure: SalaryStructure,
  attendance: PayslipBreakdown['attendance'],
  cal: Calendar,
  adjustment: PayslipBreakdown['adjustment'],
  staff: PayslipStaff,
) {
  const t = salaryTotals(structure);
  const lop = lossOfPay(t.gross, cal.workingDays, attendance.unpaidDays);
  const breakdown: PayslipBreakdown = {
    version: 1,
    structure: { ...components(structure), effectiveFrom: toDateStr(structure.effectiveFrom) },
    structureGross: t.gross,
    fixedDeductions: t.deductions,
    earnings: [],
    deductions: [],
    adjustment,
    attendance,
    calendar: { daysInMonth: cal.daysInMonth, sundays: cal.sundays, holidays: cal.holidayDays, workingDays: cal.workingDays },
    perDay: cal.workingDays ? Math.round(t.gross / cal.workingDays) : 0,
    staff,
  };
  return withAmounts(breakdown, lop);
}

/** API shape of a payslip. Finalized payslips show the staff snapshot taken at finalization; drafts the live record. */
function slipOut(p: Payslip & { staff: StaffLite }, status: PayrollStatus) {
  const b = p.breakdown as unknown as PayslipBreakdown;
  const staff = status === 'FINALIZED' && b?.staff ? b.staff : staffSnapshot(p.staff);
  return {
    id: p.id,
    staffId: p.staffId,
    staff,
    workingDays: p.workingDays,
    presentDays: p.presentDays,
    leaveDays: p.leaveDays,
    absentDays: p.absentDays,
    paidDays: p.paidDays,
    unpaidDays: Math.round((p.workingDays - p.paidDays) * 100) / 100,
    gross: p.gross,
    deductions: p.deductions,
    lopDeduction: p.lopDeduction,
    net: p.net,
    paidAt: dateStr(p.paidAt),
    paymentMode: p.paymentMode,
    reference: p.reference,
    breakdown: b,
  };
}

async function slipOfSchool(id: string, schoolId: string) {
  const s = await prisma.payslip.findFirst({
    where: { id, payroll: { schoolId } },
    include: { payroll: true, staff: { select: staffSelect } },
  });
  if (!s) throw notFound('Payslip not found');
  return s;
}

/** Everything the month screen needs: calendar, payroll status, payslips, totals, notes. */
async function loadMonth(schoolId: string, month: string) {
  const { to } = monthRange(month);
  const monthEnd = new Date(to.getTime() - DAY);
  const [calendar, payroll, staff] = await Promise.all([
    monthCalendar(schoolId, month),
    prisma.payroll.findUnique({
      where: { schoolId_month: { schoolId, month } },
      include: { payslips: { include: { staff: { select: staffSelect } } } },
    }),
    prisma.staff.findMany({
      where: { schoolId, isActive: true },
      orderBy: { employeeCode: 'asc' },
      select: { id: true, firstName: true, lastName: true, joiningDate: true, salaryStructure: { select: { effectiveFrom: true } } },
    }),
  ]);
  const notes: { staffId: string; name: string; kind: 'missing' | 'notJoined' | 'effective'; message: string }[] = [];
  let eligible = 0;
  for (const s of staff) {
    const name = fullName(s);
    if (!s.salaryStructure) notes.push({ staffId: s.id, name, kind: 'missing', message: 'No salary structure — not included' });
    else if (s.joiningDate && s.joiningDate > monthEnd)
      notes.push({ staffId: s.id, name, kind: 'notJoined', message: `Joins on ${fmtDay(s.joiningDate)} — not included` });
    else {
      eligible++;
      if (s.salaryStructure.effectiveFrom > monthEnd)
        notes.push({
          staffId: s.id,
          name,
          kind: 'effective',
          message: `Salary structure is effective from ${fmtDay(s.salaryStructure.effectiveFrom)}; it is used for this month too`,
        });
    }
  }
  const payslips = (payroll?.payslips ?? [])
    .map((p) => slipOut(p, payroll!.status))
    .sort((x, y) => x.staff.employeeCode.localeCompare(y.staff.employeeCode));
  const totals = payslips.reduce(
    (t, p) => ({
      gross: t.gross + p.gross,
      deductions: t.deductions + p.deductions,
      lop: t.lop + p.lopDeduction,
      net: t.net + p.net,
      paid: t.paid + (p.paidAt ? 1 : 0),
      paidAmount: t.paidAmount + (p.paidAt ? p.net : 0),
    }),
    { gross: 0, deductions: 0, lop: 0, net: 0, paid: 0, paidAmount: 0 },
  );
  const { workingDates: _w, ...cal } = calendar;
  const current = currentMonthStr();
  return {
    month,
    label: calendar.label,
    isFuture: month > current,
    isCurrent: month === current,
    calendar: cal,
    payroll: payroll
      ? { id: payroll.id, status: payroll.status, createdAt: payroll.createdAt, finalizedAt: payroll.finalizedAt }
      : null,
    /** rule used when the payroll was generated */
    treatUnmarkedAs: payslips[0]?.breakdown?.attendance?.unmarkedAs ?? null,
    eligible,
    notes,
    payslips,
    totals: { ...totals, count: payslips.length },
  };
}

function checkPaidAt(paidAt: string, month: string) {
  if (paidAt > todayStr()) throw badRequest('Payment date cannot be in the future');
  if (paidAt < `${month}-01`) throw badRequest(`Payment date cannot be before ${monthLabel(month)}`);
}

// ═════════════════════ Salary structures & bank details ═════════════════════

/** Active staff with their salary structure (monthly gross / net) and bank details. */
payrollRouter.get('/staff', async (req, res) => {
  const a = authOf(req);
  const staff = await prisma.staff.findMany({
    where: { schoolId: a.sid, isActive: true },
    orderBy: { employeeCode: 'asc' },
    select: { ...staffSelect, phone: true, salaryStructure: true },
  });
  const rows = staff.map((s) => ({
    id: s.id,
    name: fullName(s),
    employeeCode: s.employeeCode,
    designation: s.designation,
    phone: s.phone,
    joiningDate: dateStr(s.joiningDate),
    bank: { bankName: s.bankName, bankAccount: s.bankAccount, ifsc: s.ifsc, pan: s.pan },
    structure: s.salaryStructure ? structureOut(s.salaryStructure) : null,
  }));
  const withStructure = rows.filter((r) => r.structure);
  res.json({
    staff: rows,
    summary: {
      staff: rows.length,
      withStructure: withStructure.length,
      gross: withStructure.reduce((n, r) => n + r.structure!.gross, 0),
      deductions: withStructure.reduce((n, r) => n + r.structure!.deductions, 0),
      net: withStructure.reduce((n, r) => n + r.structure!.net, 0),
      missingBank: rows.filter((r) => !r.bank.bankAccount).length,
    },
  });
});

/** Create / replace a staff member's salary structure. */
payrollRouter.put('/staff/:id/structure', async (req, res) => {
  const a = authOf(req);
  const staff = await staffOfSchool(str(req.params.id), a.sid);
  const { effectiveFrom, ...amounts } = parse(salaryStructureSchema, req.body);
  const row = await prisma.salaryStructure.upsert({
    where: { staffId: staff.id },
    create: { staffId: staff.id, ...amounts, effectiveFrom: dateOnly(effectiveFrom) },
    update: { ...amounts, effectiveFrom: dateOnly(effectiveFrom) },
  });
  audit(req, staff.salaryStructure ? 'salary.update' : 'salary.create', 'SalaryStructure', row.id, {
    staffId: staff.id,
    before: staff.salaryStructure ? components(staff.salaryStructure) : null,
    after: { ...amounts, effectiveFrom },
  });
  res.json(structureOut(row));
});

payrollRouter.delete('/staff/:id/structure', async (req, res) => {
  const a = authOf(req);
  const staff = await staffOfSchool(str(req.params.id), a.sid);
  if (!staff.salaryStructure) throw notFound('This staff member has no salary structure');
  await prisma.salaryStructure.delete({ where: { staffId: staff.id } });
  audit(req, 'salary.delete', 'SalaryStructure', staff.salaryStructure.id, { staffId: staff.id, before: components(staff.salaryStructure) });
  res.json({ ok: true });
});

/** Bank details (only these four Staff fields are touched). */
payrollRouter.put('/staff/:id/bank', async (req, res) => {
  const a = authOf(req);
  const staff = await staffOfSchool(str(req.params.id), a.sid);
  const data = parse(staffBankSchema, req.body);
  const s = await prisma.staff.update({
    where: { id: staff.id },
    data: { bankName: data.bankName, bankAccount: data.bankAccount, ifsc: data.ifsc, pan: data.pan },
    select: { bankName: true, bankAccount: true, ifsc: true, pan: true },
  });
  audit(req, 'staff.bank', 'Staff', staff.id, { bankAccountLast4: s.bankAccount?.slice(-4) ?? null, ifsc: s.ifsc });
  res.json(s);
});

// ═════════════════════ Monthly payroll ═════════════════════

/** Recent payroll months with totals. */
payrollRouter.get('/payrolls', async (req, res) => {
  const a = authOf(req);
  const rows = await prisma.payroll.findMany({
    where: { schoolId: a.sid },
    orderBy: { month: 'desc' },
    take: 36,
    include: { payslips: { select: { gross: true, deductions: true, lopDeduction: true, net: true, paidAt: true } } },
  });
  res.json(
    rows.map((p) => ({
      id: p.id,
      month: p.month,
      label: monthLabel(p.month),
      status: p.status,
      createdAt: p.createdAt,
      finalizedAt: p.finalizedAt,
      staff: p.payslips.length,
      gross: p.payslips.reduce((n, s) => n + s.gross, 0),
      lop: p.payslips.reduce((n, s) => n + s.lopDeduction, 0),
      net: p.payslips.reduce((n, s) => n + s.net, 0),
      paid: p.payslips.filter((s) => s.paidAt).length,
      paidAmount: p.payslips.reduce((n, s) => n + (s.paidAt ? s.net : 0), 0),
    })),
  );
});

payrollRouter.get('/months/:month', async (req, res) => {
  res.json(await loadMonth(authOf(req).sid, monthParam(req.params.month)));
});

/** Create or regenerate the DRAFT payroll of a month from salary structures + staff attendance. */
payrollRouter.post('/months/:month/generate', async (req, res) => {
  const a = authOf(req);
  const month = monthParam(req.params.month);
  if (month > currentMonthStr()) throw badRequest('Payroll cannot be generated for a future month');
  const { treatUnmarkedAs } = parse(payrollGenerateSchema, req.body ?? {});
  const { from, to } = monthRange(month);
  const monthEnd = new Date(to.getTime() - DAY);

  const existing = await prisma.payroll.findUnique({ where: { schoolId_month: { schoolId: a.sid, month } } });
  if (existing?.status === 'FINALIZED') throw conflict(`Payroll for ${monthLabel(month)} is finalized and locked`);

  const [calendar, allStaff] = await Promise.all([
    monthCalendar(a.sid, month),
    prisma.staff.findMany({
      where: { schoolId: a.sid, isActive: true, salaryStructure: { isNot: null } },
      orderBy: { employeeCode: 'asc' },
      select: { ...staffSelect, salaryStructure: true },
    }),
  ]);
  // Not yet joined by the end of the month → not on this payroll.
  const staff = allStaff.filter((s) => !(s.joiningDate && s.joiningDate > monthEnd));
  if (!staff.length) throw badRequest('No staff have a salary structure yet. Set up salary structures first.');

  const records = await prisma.staffAttendance.findMany({
    where: { schoolId: a.sid, staffId: { in: staff.map((s) => s.id) }, date: { gte: from, lt: to } },
    select: { staffId: true, date: true, status: true },
  });
  const byStaff = new Map<string, Map<string, StaffDayStatus>>();
  for (const r of records) {
    if (!byStaff.has(r.staffId)) byStaff.set(r.staffId, new Map());
    byStaff.get(r.staffId)!.set(toDateStr(r.date), r.status);
  }

  const payroll = await prisma.$transaction(async (tx) => {
    const p =
      (await tx.payroll.findUnique({ where: { schoolId_month: { schoolId: a.sid, month } } })) ??
      (await tx.payroll.create({ data: { schoolId: a.sid, month } }));
    // Row lock + status check in one statement: a concurrent finalize waits for us, or we see it finalized.
    const locked = await tx.payroll.updateMany({ where: { id: p.id, status: 'DRAFT' }, data: { status: 'DRAFT' } });
    if (!locked.count) throw conflict(`Payroll for ${monthLabel(month)} is finalized and locked`);
    // Manual adjustments survive a regenerate.
    const previous = await tx.payslip.findMany({ where: { payrollId: p.id }, select: { staffId: true, breakdown: true } });
    const keep = new Map(previous.map((s) => [s.staffId, (s.breakdown as unknown as PayslipBreakdown | null)?.adjustment]));
    await tx.payslip.deleteMany({ where: { payrollId: p.id } });
    await tx.payslip.createMany({
      data: staff.map((s) => ({
        payrollId: p.id,
        staffId: s.id,
        ...buildSlip(
          s.salaryStructure!,
          summarizeStaffAttendance(calendar.workingDates, byStaff.get(s.id) ?? new Map(), dateStr(s.joiningDate), treatUnmarkedAs),
          calendar,
          keep.get(s.id) ?? NO_ADJUSTMENT,
          staffSnapshot(s),
        ),
      })),
    });
    return p;
  }, TX);

  audit(req, existing ? 'payroll.regenerate' : 'payroll.generate', 'Payroll', payroll.id, {
    month,
    treatUnmarkedAs,
    staff: staff.length,
  });
  res.json(await loadMonth(a.sid, month));
});

/** Discard a DRAFT payroll. */
payrollRouter.delete('/months/:month', async (req, res) => {
  const a = authOf(req);
  const month = monthParam(req.params.month);
  const p = await prisma.payroll.findUnique({ where: { schoolId_month: { schoolId: a.sid, month } } });
  if (!p) throw notFound('There is no payroll for this month');
  const r = await prisma.payroll.deleteMany({ where: { id: p.id, status: 'DRAFT' } });
  if (!r.count) throw conflict('A finalized payroll cannot be deleted');
  audit(req, 'payroll.delete', 'Payroll', p.id, { month });
  res.json({ ok: true });
});

/** Lock the payroll: no more edits or regeneration. Staff details are snapshotted onto the payslips. */
payrollRouter.post('/months/:month/finalize', async (req, res) => {
  const a = authOf(req);
  const month = monthParam(req.params.month);
  const p = await prisma.payroll.findUnique({ where: { schoolId_month: { schoolId: a.sid, month } } });
  if (!p) throw notFound('Generate the payroll first');
  const count = await prisma.$transaction(async (tx) => {
    const r = await tx.payroll.updateMany({
      where: { id: p.id, status: 'DRAFT' },
      data: { status: 'FINALIZED', finalizedAt: new Date() },
    });
    if (!r.count) throw conflict('This payroll is already finalized');
    const slips = await tx.payslip.findMany({ where: { payrollId: p.id }, include: { staff: { select: staffSelect } } });
    if (!slips.length) throw badRequest('There are no payslips to finalize');
    for (const s of slips) {
      const b = s.breakdown as unknown as PayslipBreakdown;
      const snap = staffSnapshot(s.staff);
      if (!sameStaff(b.staff, snap)) {
        await tx.payslip.update({ where: { id: s.id }, data: { breakdown: { ...b, staff: snap } as unknown as Prisma.InputJsonValue } });
      }
    }
    return slips.length;
  }, TX);
  audit(req, 'payroll.finalize', 'Payroll', p.id, { month, payslips: count });
  res.json(await loadMonth(a.sid, month));
});

/** Undo finalize — only while no salary has been paid from it. */
payrollRouter.post('/months/:month/reopen', async (req, res) => {
  const a = authOf(req);
  const month = monthParam(req.params.month);
  const p = await prisma.payroll.findUnique({ where: { schoolId_month: { schoolId: a.sid, month } } });
  if (!p) throw notFound('There is no payroll for this month');
  await prisma.$transaction(async (tx) => {
    const r = await tx.payroll.updateMany({ where: { id: p.id, status: 'FINALIZED' }, data: { status: 'DRAFT', finalizedAt: null } });
    if (!r.count) throw conflict('Only a finalized payroll can be reopened');
    const paid = await tx.payslip.count({ where: { payrollId: p.id, paidAt: { not: null } } });
    if (paid) throw conflict(`${paid} payslip(s) are already marked paid — undo those payments first`);
  }, TX);
  audit(req, 'payroll.reopen', 'Payroll', p.id, { month });
  res.json(await loadMonth(a.sid, month));
});

/** Mark every unpaid payslip of a finalized payroll as paid. */
payrollRouter.post('/months/:month/pay-all', async (req, res) => {
  const a = authOf(req);
  const month = monthParam(req.params.month);
  const input = parse(payslipPaySchema, req.body);
  checkPaidAt(input.paidAt, month);
  const p = await prisma.payroll.findUnique({ where: { schoolId_month: { schoolId: a.sid, month } } });
  if (!p) throw notFound('There is no payroll for this month');
  const count = await prisma.$transaction(async (tx) => {
    const locked = await tx.payroll.updateMany({ where: { id: p.id, status: 'FINALIZED' }, data: { status: 'FINALIZED' } });
    if (!locked.count) throw conflict('Finalize the payroll before recording salary payments');
    const r = await tx.payslip.updateMany({
      where: { payrollId: p.id, paidAt: null },
      data: { paidAt: dateOnly(input.paidAt), paymentMode: input.mode, reference: input.reference ?? null },
    });
    if (!r.count) throw badRequest('All payslips are already marked paid');
    return r.count;
  }, TX);
  audit(req, 'payroll.payAll', 'Payroll', p.id, { month, count, paidAt: input.paidAt, mode: input.mode });
  res.json({ ok: true, count });
});

// ═════════════════════ Payslips ═════════════════════

payrollRouter.get('/payslips/:id', async (req, res) => {
  const s = await slipOfSchool(str(req.params.id), authOf(req).sid);
  res.json({
    ...slipOut(s, s.payroll.status),
    month: s.payroll.month,
    monthLabel: monthLabel(s.payroll.month),
    status: s.payroll.status,
  });
});

/** Manual adjustment on a DRAFT payslip: extra allowance / deduction with a note → net recomputed. */
payrollRouter.put('/payslips/:id', async (req, res) => {
  const a = authOf(req);
  const input = parse(payslipAdjustSchema, req.body);
  const slip = await slipOfSchool(str(req.params.id), a.sid);
  if (slip.payroll.status !== 'DRAFT') throw conflict('This payroll is finalized — payslips can no longer be edited');
  await prisma.$transaction(async (tx) => {
    const locked = await tx.payroll.updateMany({ where: { id: slip.payrollId, status: 'DRAFT' }, data: { status: 'DRAFT' } });
    if (!locked.count) throw conflict('This payroll is finalized — payslips can no longer be edited');
    const fresh = await tx.payslip.findUnique({ where: { id: slip.id } });
    if (!fresh) throw notFound('Payslip not found — the payroll was regenerated, please reload');
    const b = fresh.breakdown as unknown as PayslipBreakdown;
    b.adjustment = { extraAllowance: input.extraAllowance, extraDeduction: input.extraDeduction, note: input.note ?? null };
    await tx.payslip.update({ where: { id: slip.id }, data: withAmounts(b, fresh.lopDeduction) });
  }, TX);
  audit(req, 'payslip.adjust', 'Payslip', slip.id, { month: slip.payroll.month, staffId: slip.staffId, ...input });
  const s = await slipOfSchool(slip.id, a.sid);
  res.json(slipOut(s, s.payroll.status));
});

/** Record the salary payment of one payslip (payroll must be finalized). */
payrollRouter.post('/payslips/:id/pay', async (req, res) => {
  const a = authOf(req);
  const input = parse(payslipPaySchema, req.body);
  const slip = await slipOfSchool(str(req.params.id), a.sid);
  checkPaidAt(input.paidAt, slip.payroll.month);
  await prisma.$transaction(async (tx) => {
    const locked = await tx.payroll.updateMany({ where: { id: slip.payrollId, status: 'FINALIZED' }, data: { status: 'FINALIZED' } });
    if (!locked.count) throw conflict('Finalize the payroll before recording salary payments');
    const r = await tx.payslip.updateMany({
      where: { id: slip.id, paidAt: null },
      data: { paidAt: dateOnly(input.paidAt), paymentMode: input.mode, reference: input.reference ?? null },
    });
    if (!r.count) throw conflict('This payslip is already marked paid');
  }, TX);
  audit(req, 'payslip.pay', 'Payslip', slip.id, { month: slip.payroll.month, staffId: slip.staffId, net: slip.net, ...input });
  const s = await slipOfSchool(slip.id, a.sid);
  res.json(slipOut(s, s.payroll.status));
});

/** Undo a payment entered by mistake. */
payrollRouter.post('/payslips/:id/unpay', async (req, res) => {
  const a = authOf(req);
  const slip = await slipOfSchool(str(req.params.id), a.sid);
  const r = await prisma.payslip.updateMany({
    where: { id: slip.id, paidAt: { not: null } },
    data: { paidAt: null, paymentMode: null, reference: null },
  });
  if (!r.count) throw badRequest('This payslip is not marked paid');
  audit(req, 'payslip.unpay', 'Payslip', slip.id, {
    month: slip.payroll.month,
    staffId: slip.staffId,
    was: { paidAt: dateStr(slip.paidAt), mode: slip.paymentMode, reference: slip.reference },
  });
  const s = await slipOfSchool(slip.id, a.sid);
  res.json(slipOut(s, s.payroll.status));
});
