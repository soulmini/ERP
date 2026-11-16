import { Router } from 'express';
import {
  dueBalance,
  dueNet,
  pendingFine,
  type ClasswiseRow,
  type CollectionReport,
  type DefaulterRow,
  type FeeSummary,
  type PaymentModeKey,
} from '@erp/shared';
import { prisma } from '../../db';
import { badRequest, optStr } from '../../lib/http';
import { currentMonthStr, dateOnly, daysBetween, monthRange, toDateStr, todayStr } from '../../lib/dates';
import { authOf, can } from '../../middleware/auth';
import { currentSession } from '../academic';
import { anyFeePerm, fullName, sum, toPaymentRow } from './common';

/** Dashboard summary + collection / defaulter / class-wise reports. */
export const feesReportsRouter = Router();

const OPEN = ['UNPAID', 'PARTIAL'] as const;

feesReportsRouter.get('/summary', anyFeePerm, async (req, res) => {
  const { sid } = authOf(req);
  const session = await currentSession(sid);
  const today = dateOnly(todayStr());
  const { from, to } = monthRange(currentMonthStr());
  const [day, month, open, overdue] = await Promise.all([
    prisma.payment.aggregate({ where: { schoolId: sid, date: today, cancelledAt: null }, _sum: { amount: true }, _count: true }),
    prisma.payment.aggregate({ where: { schoolId: sid, date: { gte: from, lt: to }, cancelledAt: null }, _sum: { amount: true } }),
    prisma.studentFeeDue.aggregate({
      where: { schoolId: sid, sessionId: session.id, status: { in: [...OPEN] }, dueDate: { lte: today }, student: { status: 'ACTIVE' } },
      _sum: { amount: true, concession: true, fine: true, paid: true },
    }),
    prisma.studentFeeDue.groupBy({
      by: ['studentId'],
      where: { schoolId: sid, sessionId: session.id, status: { in: [...OPEN] }, dueDate: { lt: today }, student: { status: 'ACTIVE' } },
    }),
  ]);
  const s = open._sum;
  const out: FeeSummary = {
    todayCollection: day._sum.amount ?? 0,
    todayReceipts: day._count,
    monthCollection: month._sum.amount ?? 0,
    outstanding: (s.amount ?? 0) - (s.concession ?? 0) + (s.fine ?? 0) - (s.paid ?? 0),
    overdueStudents: overdue.length,
  };
  res.json(out);
});

// ───────── Daily collection ─────────

feesReportsRouter.get('/reports/collection', can('fees.view'), async (req, res) => {
  const { sid } = authOf(req);
  const from = optStr(req.query.from) ?? todayStr();
  const to = optStr(req.query.to) ?? from;
  if (to < from) throw badRequest('"To" date is before "from" date');
  if (daysBetween(from, to) > 366) throw badRequest('Choose a range of up to one year');
  const rows = await prisma.payment.findMany({
    where: { schoolId: sid, date: { gte: dateOnly(from), lte: dateOnly(to) } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    include: {
      collectedBy: { select: { id: true, name: true } },
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNo: true,
          enrollments: { orderBy: { createdAt: 'desc' }, take: 1, select: { section: { select: { name: true, class: { select: { name: true } } } } } },
        },
      },
    },
  });
  const live = rows.filter((p) => !p.cancelledAt);
  const group = <K extends string | null>(key: (p: (typeof rows)[number]) => K) => {
    const m = new Map<K, { amount: number; count: number; sample: (typeof rows)[number] }>();
    for (const p of live) {
      const k = key(p);
      const g = m.get(k) ?? { amount: 0, count: 0, sample: p };
      g.amount += p.amount;
      g.count++;
      m.set(k, g);
    }
    return m;
  };
  const report: CollectionReport = {
    from,
    to,
    total: sum(live, (p) => p.amount),
    count: live.length,
    cancelled: rows.length - live.length,
    byMode: [...group((p) => p.mode as string)].map(([mode, g]) => ({ mode: mode as PaymentModeKey, amount: g.amount, count: g.count })).sort((a, b) => b.amount - a.amount),
    byCollector: [...group((p) => p.collectedById)]
      .map(([id, g]) => ({ id, name: g.sample.collectedBy?.name ?? 'Unknown', amount: g.amount, count: g.count }))
      .sort((a, b) => b.amount - a.amount),
    byDay: [...group((p) => toDateStr(p.date))].map(([date, g]) => ({ date, amount: g.amount, count: g.count })),
    receipts: rows.map((p) => {
      const sec = p.student.enrollments[0]?.section;
      return toPaymentRow(p, { ...p.student, classLabel: sec ? `${sec.class.name}-${sec.name}` : null });
    }),
  };
  res.json(report);
});

// ───────── Defaulters ─────────

/** Students with dues past their due date as of ?date= (default today); optional ?classId=. */
feesReportsRouter.get('/reports/defaulters', can('fees.view'), async (req, res) => {
  const { sid } = authOf(req);
  const session = await currentSession(sid);
  const date = optStr(req.query.date) ?? todayStr();
  const classId = optStr(req.query.classId);
  const dues = await prisma.studentFeeDue.findMany({
    where: {
      schoolId: sid,
      sessionId: session.id,
      status: { in: [...OPEN] },
      dueDate: { lt: dateOnly(date) },
      student: {
        status: 'ACTIVE',
        ...(classId ? { enrollments: { some: { sessionId: session.id, section: { classId } } } } : {}),
      },
    },
    select: {
      studentId: true,
      feeHeadId: true,
      dueDate: true,
      amount: true,
      concession: true,
      fine: true,
      paid: true,
      status: true,
    },
  });
  const studentIds = [...new Set(dues.map((d) => d.studentId))];
  const [students, structures] = await Promise.all([
    prisma.student.findMany({
      where: { id: { in: studentIds } },
      include: {
        enrollments: { where: { sessionId: session.id }, include: { section: { include: { class: true } } } },
        guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' }, take: 1 },
      },
    }),
    prisma.feeStructure.findMany({ where: { schoolId: sid, sessionId: session.id }, select: { classId: true, feeHeadId: true, lateFine: true } }),
  ]);
  const fineOf = new Map(structures.map((s) => [`${s.classId}|${s.feeHeadId}`, s.lateFine]));
  const rows: DefaulterRow[] = students
    .map((s) => {
      const e = s.enrollments[0];
      const g = s.guardians[0]?.guardian;
      const mine = dues.filter((d) => d.studentId === s.id);
      const like = mine.map((d) => ({
        id: '',
        dueDate: toDateStr(d.dueDate),
        amount: d.amount,
        concession: d.concession,
        fine: d.fine,
        paid: d.paid,
        status: d.status,
        lateFine: e ? (fineOf.get(`${e.section.classId}|${d.feeHeadId}`) ?? 0) : 0,
      }));
      return {
        studentId: s.id,
        name: fullName(s),
        admissionNo: s.admissionNo,
        classId: e?.section.classId ?? null,
        classLabel: e ? `${e.section.class.name}-${e.section.name}` : null,
        classOrder: e?.section.class.order ?? 999,
        rollNo: e?.rollNo ?? null,
        guardianName: g?.name ?? null,
        guardianPhone: g?.phone ?? s.phone ?? null,
        periods: like.length,
        oldestDue: like.map((d) => d.dueDate).sort()[0],
        overdue: sum(like, (d) => dueBalance(d)),
        pendingFine: sum(like, (d) => pendingFine(d, date)),
      };
    })
    .filter((r) => r.overdue > 0)
    .sort((a, b) => a.classOrder - b.classOrder || (a.classLabel ?? '').localeCompare(b.classLabel ?? '') || (a.rollNo ?? 999) - (b.rollNo ?? 999));
  res.json({
    date,
    rows,
    total: sum(rows, (r) => r.overdue),
    totalFine: sum(rows, (r) => r.pendingFine),
  });
});

// ───────── Class-wise summary ─────────

feesReportsRouter.get('/reports/classwise', can('fees.view'), async (req, res) => {
  const { sid } = authOf(req);
  const session = await currentSession(sid);
  const today = todayStr();
  const [classes, enrollments, dues] = await Promise.all([
    prisma.class.findMany({ where: { schoolId: sid }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    prisma.enrollment.findMany({
      where: { sessionId: session.id, student: { schoolId: sid, status: 'ACTIVE' } },
      select: { studentId: true, section: { select: { classId: true } } },
    }),
    prisma.studentFeeDue.findMany({
      where: { schoolId: sid, sessionId: session.id, student: { status: 'ACTIVE' } },
      select: { studentId: true, dueDate: true, amount: true, concession: true, fine: true, paid: true, status: true },
    }),
  ]);
  const classOf = new Map(enrollments.map((e) => [e.studentId, e.section.classId]));
  const rows: ClasswiseRow[] = classes.map((c) => ({
    classId: c.id,
    className: c.name,
    students: enrollments.filter((e) => e.section.classId === c.id).length,
    expected: 0,
    collected: 0,
    outstanding: 0,
    dueTillToday: 0,
    overdueStudents: 0,
  }));
  const byId = new Map(rows.map((r) => [r.classId, r]));
  const overdueStudents = new Map<string, Set<string>>();
  for (const d of dues) {
    const cid = classOf.get(d.studentId);
    const r = cid && byId.get(cid);
    if (!r) continue;
    const ds = toDateStr(d.dueDate);
    const bal = dueBalance(d);
    r.expected += d.status === 'WAIVED' ? d.paid : dueNet(d);
    r.collected += d.paid;
    r.outstanding += bal;
    if (ds <= today) r.dueTillToday += bal;
    if (ds < today && bal > 0) overdueStudents.set(cid, (overdueStudents.get(cid) ?? new Set()).add(d.studentId));
  }
  for (const r of rows) r.overdueStudents = overdueStudents.get(r.classId)?.size ?? 0;
  res.json({ session: session.name, today, rows });
});
