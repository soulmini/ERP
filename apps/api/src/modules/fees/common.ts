import {
  concessionFor,
  dueBalance,
  dueDisplay,
  dueNet,
  feePeriods,
  pendingFine,
  sortDues,
  type ConcessionRow,
  type FeeCard,
  type FeeDueRow,
  type FeeFrequency,
  type FeePaymentRow,
  type FeePeriod,
  type FeeStudentInfo,
  type FeeTotals,
  type ReceiptDetail,
  type ReceiptLine,
} from '@erp/shared';
import { prisma } from '../../db';
import type { DueStatus, Prisma } from '../../generated/prisma/client';
import { notFound } from '../../lib/http';
import { dateOnly, toDateStr, todayStr } from '../../lib/dates';
import { signedUrl } from '../../lib/storage';
import type { AuthPayload } from '../../lib/tokens';
import { can, hasPerm } from '../../middleware/auth';
import { currentSession } from '../academic';

/** Interactive transactions talk to a remote DB several times — give them room. */
export const TX = { timeout: 30_000, maxWait: 15_000 };

/** Any fee permission (read-only screens). */
export const anyFeePerm = can('fees.view', 'fees.collect', 'fees.manage');
export const hasAnyFeePerm = (a: AuthPayload) =>
  hasPerm(a, 'fees.view') || hasPerm(a, 'fees.collect') || hasPerm(a, 'fees.manage');

export const fullName = (s: { firstName: string; lastName: string | null }) => `${s.firstName} ${s.lastName ?? ''}`.trim();

export type Sess = { id: string; name: string; startDate: Date; endDate: Date };

/** Sum helper. */
export const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0);

// ═════════════════════ Students ═════════════════════

export const studentInclude = (sessionId: string) =>
  ({
    enrollments: { where: { sessionId }, include: { section: { include: { class: true } } } },
    guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' } },
  }) satisfies Prisma.StudentInclude;

type StudentWith = Prisma.StudentGetPayload<{
  include: {
    enrollments: { include: { section: { include: { class: true } } } };
    guardians: { include: { guardian: true } };
  };
}>;

export async function toStudentInfo(s: StudentWith): Promise<FeeStudentInfo> {
  const e = s.enrollments[0];
  const g = s.guardians[0]?.guardian;
  const father = s.guardians.find((x) => x.guardian.relation === 'FATHER')?.guardian;
  return {
    id: s.id,
    name: fullName(s),
    admissionNo: s.admissionNo,
    photoUrl: await signedUrl(s.photoKey),
    status: s.status,
    classId: e?.section.classId ?? null,
    classLabel: e ? `${e.section.class.name}-${e.section.name}` : null,
    rollNo: e?.rollNo ?? null,
    fatherName: father?.name ?? null,
    guardianName: g?.name ?? null,
    guardianPhone: g?.phone ?? s.phone ?? null,
  };
}

// ═════════════════════ Dues generation ═════════════════════

/**
 * Create / reconcile StudentFeeDue rows for enrolled ACTIVE students from the class fee structure.
 * Idempotent: existing dues are kept; untouched ones (nothing paid, not waived) get their amount,
 * concession and due date refreshed, and are removed if the class no longer has that (active) head.
 */
export async function generateDues(schoolId: string, session: Sess, scope: { classId?: string; studentId?: string } = {}) {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      sessionId: session.id,
      student: { schoolId, status: 'ACTIVE' },
      ...(scope.studentId ? { studentId: scope.studentId } : {}),
      ...(scope.classId ? { section: { classId: scope.classId } } : {}),
    },
    select: { studentId: true, section: { select: { classId: true } }, student: { select: { admissionDate: true } } },
  });
  const result = { students: enrollments.length, created: 0, updated: 0, removed: 0 };
  if (!enrollments.length) return result;

  const studentIds = enrollments.map((e) => e.studentId);
  const classIds = [...new Set(enrollments.map((e) => e.section.classId))];
  const [structures, concessions, existing] = await Promise.all([
    prisma.feeStructure.findMany({
      where: { schoolId, sessionId: session.id, classId: { in: classIds }, feeHead: { isActive: true } },
      include: { feeHead: { select: { frequency: true } } },
    }),
    prisma.concession.findMany({ where: { schoolId, sessionId: session.id, studentId: { in: studentIds } } }),
    prisma.studentFeeDue.findMany({
      // ONE_TIME dues from earlier sessions count as "already charged".
      where: { schoolId, studentId: { in: studentIds }, OR: [{ sessionId: session.id }, { period: 'ONE_TIME' }] },
      select: {
        id: true,
        studentId: true,
        feeHeadId: true,
        sessionId: true,
        period: true,
        label: true,
        dueDate: true,
        amount: true,
        concession: true,
        paid: true,
        status: true,
        feeHead: { select: { isActive: true } },
        _count: { select: { allocations: true } },
      },
    }),
  ]);

  const sess = { name: session.name, startDate: toDateStr(session.startDate), endDate: toDateStr(session.endDate) };
  const periodCache = new Map<string, FeePeriod[]>();
  const periodsOf = (f: FeeFrequency, dueDay: number) => {
    const k = `${f}|${dueDay}`;
    if (!periodCache.has(k)) periodCache.set(k, feePeriods(f, sess, dueDay));
    return periodCache.get(k)!;
  };
  const byClass = new Map<string, typeof structures>();
  for (const s of structures) byClass.set(s.classId, [...(byClass.get(s.classId) ?? []), s]);
  const concOf = new Map<string, typeof concessions>();
  for (const c of concessions) concOf.set(c.studentId, [...(concOf.get(c.studentId) ?? []), c]);

  type Want = { studentId: string; feeHeadId: string; period: string; label: string; dueDate: string; amount: number; concession: number };
  const want = new Map<string, Want>();
  for (const e of enrollments) {
    const admitted = toDateStr(e.student.admissionDate);
    for (const s of byClass.get(e.section.classId) ?? []) {
      if (s.amount <= 0) continue;
      const f = s.feeHead.frequency as FeeFrequency;
      // One-time heads (admission fee) only for students admitted this session.
      if (f === 'ONE_TIME' && admitted < sess.startDate) continue;
      const cs = (concOf.get(e.studentId) ?? []).filter((c) => !c.feeHeadId || c.feeHeadId === s.feeHeadId);
      const concession = concessionFor(s.amount, cs);
      for (const p of periodsOf(f, s.dueDay)) {
        want.set(`${e.studentId}|${s.feeHeadId}|${p.period}`, {
          studentId: e.studentId,
          feeHeadId: s.feeHeadId,
          period: p.period,
          label: p.label,
          dueDate: p.dueDate,
          amount: s.amount,
          concession,
        });
      }
    }
  }

  const statusFor = (w: Want): DueStatus => (w.amount - w.concession <= 0 ? 'PAID' : 'UNPAID');
  const seen = new Set<string>();
  const updates = new Map<string, { data: Prisma.StudentFeeDueUpdateManyMutationInput; ids: string[] }>();
  const toDelete: string[] = [];
  for (const d of existing) {
    const key = `${d.studentId}|${d.feeHeadId}|${d.period}`;
    const w = want.get(key);
    if (w) seen.add(key);
    if (d.sessionId !== session.id) continue;
    const untouched = d.paid === 0 && d.status !== 'WAIVED';
    if (!untouched) continue;
    if (!w) {
      if (d.feeHead.isActive && d._count.allocations === 0) toDelete.push(d.id);
      continue;
    }
    const status = statusFor(w);
    if (
      d.amount !== w.amount ||
      d.concession !== w.concession ||
      toDateStr(d.dueDate) !== w.dueDate ||
      d.label !== w.label ||
      d.status !== status
    ) {
      const k = [w.amount, w.concession, w.dueDate, w.label, status].join('|');
      const g = updates.get(k) ?? {
        data: { amount: w.amount, concession: w.concession, dueDate: dateOnly(w.dueDate), label: w.label, status, fine: 0 },
        ids: [],
      };
      g.ids.push(d.id);
      updates.set(k, g);
    }
  }

  const toCreate = [...want.entries()]
    .filter(([k]) => !seen.has(k))
    .map(([, w]) => ({
      schoolId,
      sessionId: session.id,
      studentId: w.studentId,
      feeHeadId: w.feeHeadId,
      period: w.period,
      label: w.label,
      dueDate: dateOnly(w.dueDate),
      amount: w.amount,
      concession: w.concession,
      status: statusFor(w),
    }));
  for (let i = 0; i < toCreate.length; i += 1000) {
    const r = await prisma.studentFeeDue.createMany({ data: toCreate.slice(i, i + 1000), skipDuplicates: true });
    result.created += r.count;
  }
  // Guarded updates: a payment taken meanwhile (paid > 0) makes the row skip.
  const groups = [...updates.values()];
  for (let i = 0; i < groups.length; i += 8) {
    const rs = await Promise.all(
      groups.slice(i, i + 8).map((g) =>
        prisma.studentFeeDue.updateMany({ where: { id: { in: g.ids }, paid: 0, status: { not: 'WAIVED' } }, data: g.data }),
      ),
    );
    result.updated += sum(rs, (r) => r.count);
  }
  if (toDelete.length) {
    const r = await prisma.studentFeeDue.deleteMany({ where: { id: { in: toDelete }, paid: 0, allocations: { none: {} } } });
    result.removed = r.count;
  }
  return result;
}

// ═════════════════════ Rows ═════════════════════

type PaymentWith = Prisma.PaymentGetPayload<{ include: { collectedBy: { select: { name: true } } } }>;

export function toPaymentRow(
  p: PaymentWith,
  student?: { id: string; firstName: string; lastName: string | null; admissionNo: string; classLabel: string | null },
): FeePaymentRow {
  return {
    id: p.id,
    receiptNo: p.receiptNo,
    date: toDateStr(p.date),
    amount: p.amount,
    mode: p.mode,
    reference: p.reference,
    remarks: p.remarks,
    collectedBy: p.collectedBy?.name ?? null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    cancelReason: p.cancelReason,
    createdAt: p.createdAt.toISOString(),
    ...(student
      ? { student: { id: student.id, name: fullName(student), admissionNo: student.admissionNo, classLabel: student.classLabel } }
      : {}),
  };
}

export const concessionInclude = (sessionId: string) =>
  ({
    feeHead: { select: { name: true } },
    student: {
      select: {
        firstName: true,
        lastName: true,
        admissionNo: true,
        enrollments: { where: { sessionId }, select: { section: { select: { name: true, class: { select: { name: true } } } } } },
      },
    },
  }) satisfies Prisma.ConcessionInclude;

type ConcessionWith = Prisma.ConcessionGetPayload<{
  include: {
    feeHead: { select: { name: true } };
    student: {
      select: {
        firstName: true;
        lastName: true;
        admissionNo: true;
        enrollments: { select: { section: { select: { name: true; class: { select: { name: true } } } } } };
      };
    };
  };
}>;

export function toConcessionRow(c: ConcessionWith): ConcessionRow {
  const sec = c.student.enrollments[0]?.section;
  return {
    id: c.id,
    studentId: c.studentId,
    studentName: fullName(c.student),
    admissionNo: c.student.admissionNo,
    classLabel: sec ? `${sec.class.name}-${sec.name}` : null,
    feeHeadId: c.feeHeadId,
    head: c.feeHead?.name ?? null,
    percent: c.percent,
    amount: c.amount,
    reason: c.reason,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Late fine per head for a class in a session. */
export async function lateFines(sessionId: string, classId: string | null | undefined) {
  if (!classId) return new Map<string, number>();
  const rows = await prisma.feeStructure.findMany({ where: { sessionId, classId }, select: { feeHeadId: true, lateFine: true } });
  return new Map(rows.map((r) => [r.feeHeadId, r.lateFine]));
}

type DueWith = Prisma.StudentFeeDueGetPayload<{ include: { feeHead: { select: { name: true; order: true; frequency: true } } } }>;

export function toDueRows(dues: DueWith[], fines: Map<string, number>, today: string): FeeDueRow[] {
  return sortDues(
    dues.map((d) => {
      const like = {
        id: d.id,
        dueDate: toDateStr(d.dueDate),
        amount: d.amount,
        concession: d.concession,
        fine: d.fine,
        paid: d.paid,
        status: d.status,
        lateFine: fines.get(d.feeHeadId) ?? 0,
        headOrder: d.feeHead.order,
      };
      return {
        ...like,
        feeHeadId: d.feeHeadId,
        head: d.feeHead.name,
        frequency: d.feeHead.frequency,
        period: d.period,
        label: d.label,
        balance: dueBalance(like),
        pendingFine: pendingFine(like, today),
        display: dueDisplay(like, today),
      };
    }),
  );
}

export function totalsOf(rows: FeeDueRow[], today: string): FeeTotals {
  return {
    total: sum(rows, (d) => (d.status === 'WAIVED' ? d.paid : dueNet(d))),
    paid: sum(rows, (d) => d.paid),
    balance: sum(rows, (d) => d.balance),
    dueTillToday: sum(rows, (d) => (d.dueDate <= today ? d.balance : 0)),
    overdue: sum(rows, (d) => (d.dueDate < today ? d.balance : 0)),
    pendingFine: sum(rows, (d) => d.pendingFine),
  };
}

// ═════════════════════ Fee card ═════════════════════

/** Everything the collection screen / parent screen needs for one student. */
export async function buildCard(schoolId: string, studentId: string, opts: { autoGenerate: boolean }): Promise<FeeCard> {
  const session = await currentSession(schoolId);
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId }, include: studentInclude(session.id) });
  if (!student) throw notFound('Student not found');
  const classId = student.enrollments[0]?.section.classId;
  const today = todayStr();

  const loadDues = () =>
    prisma.studentFeeDue.findMany({
      where: { studentId, sessionId: session.id },
      include: { feeHead: { select: { name: true, order: true, frequency: true } } },
    });
  let [dues, payments, concessions, fines, info] = await Promise.all([
    loadDues(),
    prisma.payment.findMany({
      where: { studentId, schoolId, sessionId: session.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { collectedBy: { select: { name: true } } },
    }),
    prisma.concession.findMany({
      where: { studentId, schoolId, sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      include: concessionInclude(session.id),
    }),
    lateFines(session.id, classId),
    toStudentInfo(student),
  ]);
  let generated = 0;
  if (!dues.length && opts.autoGenerate && classId && student.status === 'ACTIVE') {
    generated = (await generateDues(schoolId, session, { studentId })).created;
    if (generated) dues = await loadDues();
  }
  const rows = toDueRows(dues, fines, today);
  return {
    today,
    session: { id: session.id, name: session.name },
    student: info,
    dues: rows,
    payments: payments.map((p) => toPaymentRow(p)),
    concessions: concessions.map(toConcessionRow),
    totals: totalsOf(rows, today),
    generated,
  };
}

// ═════════════════════ Receipt ═════════════════════

/** Short period text for a group of installments: "April 2026", "April 2026, May 2026", "April 2026 – November 2026 (8)". */
function periodsText(labels: string[]) {
  if (labels.length <= 2) return labels.join(', ');
  return `${labels[0]} – ${labels[labels.length - 1]} (${labels.length})`;
}

export async function receiptDetail(schoolId: string, paymentId: string): Promise<ReceiptDetail> {
  const p = await prisma.payment.findFirst({
    where: { id: paymentId, schoolId },
    include: {
      session: true,
      collectedBy: { select: { name: true } },
      allocations: {
        include: {
          due: {
            include: {
              feeHead: { select: { name: true, order: true } },
              allocations: { select: { amount: true, payment: { select: { id: true, createdAt: true, cancelledAt: true } } } },
            },
          },
        },
      },
    },
  });
  if (!p) throw notFound('Receipt not found');
  const today = todayStr();
  const [student, open] = await Promise.all([
    prisma.student.findFirstOrThrow({ where: { id: p.studentId }, include: studentInclude(p.sessionId) }),
    prisma.studentFeeDue.findMany({
      where: { studentId: p.studentId, sessionId: p.sessionId, status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lte: dateOnly(today) } },
      select: { amount: true, concession: true, fine: true, paid: true, status: true },
    }),
  ]);

  // Fine is paid first: this allocation's fine part = what of due.fine earlier live payments had not covered.
  const items = p.allocations
    .map((a) => {
      const d = a.due;
      const earlier = sum(
        d.allocations.filter(
          (x) => x.payment.id !== p.id && !x.payment.cancelledAt && x.payment.createdAt < p.createdAt,
        ),
        (x) => x.amount,
      );
      const fine = Math.min(a.amount, Math.max(0, d.fine - earlier));
      return { d, amount: a.amount, fine };
    })
    .sort((x, y) => x.d.feeHead.order - y.d.feeHead.order || +x.d.dueDate - +y.d.dueDate);

  const groups = new Map<string, typeof items>();
  for (const it of items) groups.set(it.d.feeHeadId, [...(groups.get(it.d.feeHeadId) ?? []), it]);
  const lines: ReceiptLine[] = [...groups.values()].map((g) => ({
    head: g[0].d.feeHead.name,
    periods: periodsText(g.map((x) => x.d.label)),
    fee: sum(g, (x) => x.d.amount),
    concession: sum(g, (x) => x.d.concession),
    fine: sum(g, (x) => x.fine),
    paid: sum(g, (x) => x.amount),
  }));

  return {
    id: p.id,
    receiptNo: p.receiptNo,
    date: toDateStr(p.date),
    amount: p.amount,
    mode: p.mode,
    reference: p.reference,
    remarks: p.remarks,
    collectedBy: p.collectedBy?.name ?? null,
    createdAt: p.createdAt.toISOString(),
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    cancelReason: p.cancelReason,
    session: p.session.name,
    student: await toStudentInfo(student),
    lines,
    totalFine: sum(lines, (l) => l.fine),
    balanceDue: sum(open, (d) => dueBalance(d)),
  };
}
