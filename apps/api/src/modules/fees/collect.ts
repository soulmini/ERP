import { Router } from 'express';
import {
  allocatePayment,
  cancelPaymentSchema,
  collectPaymentSchema,
  dueBalance,
  dueStatusOf,
  formatINR,
  formatReceiptNo,
  type DueLike,
  type FeeSearchRow,
} from '@erp/shared';
import { prisma } from '../../db';
import { Prisma } from '../../generated/prisma/client';
import { badRequest, conflict, forbidden, notFound, optStr, parse, str } from '../../lib/http';
import { dateOnly, toDateStr, todayStr } from '../../lib/dates';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/counters';
import { signedUrl } from '../../lib/storage';
import { authOf, can, requireKind } from '../../middleware/auth';
import { currentSession } from '../academic';
import { anyFeePerm, buildCard, fullName, hasAnyFeePerm, lateFines, receiptDetail, sum, toPaymentRow, TX } from './common';

/** Student search, fee card, collection, receipts, cancellation, parent view. */
export const feesCollectRouter = Router();

// ───────── Find a student ─────────

/** ?q= name / admission no. / parent mobile (all words must match), or ?sectionId= for a whole class. */
feesCollectRouter.get('/students', anyFeePerm, async (req, res) => {
  const { sid } = authOf(req);
  const session = await currentSession(sid);
  const q = optStr(req.query.q)?.trim() ?? '';
  const sectionId = optStr(req.query.sectionId);
  if (!q && !sectionId) return res.json([]);
  const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
  const students = await prisma.student.findMany({
    where: {
      schoolId: sid,
      status: 'ACTIVE',
      enrollments: { some: { sessionId: session.id, ...(sectionId ? { sectionId } : {}) } },
      AND: words.map((w) => ({
        OR: [
          { firstName: { contains: w, mode: 'insensitive' as const } },
          { lastName: { contains: w, mode: 'insensitive' as const } },
          { admissionNo: { contains: w, mode: 'insensitive' as const } },
          { guardians: { some: { guardian: { OR: [{ phone: { contains: w } }, { name: { contains: w, mode: 'insensitive' as const } }] } } } },
        ],
      })),
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: sectionId ? 200 : 20,
    include: {
      enrollments: { where: { sessionId: session.id }, include: { section: { include: { class: true } } } },
      guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' }, take: 1 },
    },
  });
  const today = dateOnly(todayStr());
  const open = await prisma.studentFeeDue.findMany({
    where: {
      schoolId: sid,
      sessionId: session.id,
      studentId: { in: students.map((s) => s.id) },
      status: { in: ['UNPAID', 'PARTIAL'] },
      dueDate: { lte: today },
    },
    select: { studentId: true, amount: true, concession: true, fine: true, paid: true, status: true },
  });
  const rows: FeeSearchRow[] = await Promise.all(
    students.map(async (s) => {
      const e = s.enrollments[0];
      const g = s.guardians[0]?.guardian;
      return {
        id: s.id,
        name: fullName(s),
        admissionNo: s.admissionNo,
        photoUrl: await signedUrl(s.photoKey),
        classLabel: e ? `${e.section.class.name}-${e.section.name}` : null,
        rollNo: e?.rollNo ?? null,
        guardianName: g?.name ?? null,
        guardianPhone: g?.phone ?? null,
        dueTillToday: sum(
          open.filter((d) => d.studentId === s.id),
          (d) => dueBalance(d),
        ),
      };
    }),
  );
  if (sectionId) rows.sort((a, b) => (a.rollNo ?? 999) - (b.rollNo ?? 999));
  res.json(rows);
});

/** The student's fee card. Dues are generated automatically the first time it is opened. */
feesCollectRouter.get('/students/:id/card', anyFeePerm, async (req, res) => {
  const { sid } = authOf(req);
  res.json(await buildCard(sid, str(req.params.id), { autoGenerate: true }));
});

// ───────── Collect ─────────

feesCollectRouter.post('/payments', can('fees.collect'), async (req, res) => {
  const a = authOf(req);
  const input = parse(collectPaymentSchema, req.body);
  if (input.date > todayStr()) throw badRequest('Payment date cannot be in the future');
  const session = await currentSession(a.sid);
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId: a.sid },
    include: { enrollments: { where: { sessionId: session.id }, select: { section: { select: { classId: true } } } } },
  });
  if (!student) throw notFound('Student not found');
  const fines = await lateFines(session.id, student.enrollments[0]?.section.classId);
  const dueIds = input.dueIds?.length ? [...new Set(input.dueIds)] : undefined;

  const { payment, alloc } = await prisma.$transaction(async (tx) => {
    const dues = await tx.studentFeeDue.findMany({
      where: {
        schoolId: a.sid,
        studentId: student.id,
        sessionId: session.id,
        status: { in: ['UNPAID', 'PARTIAL'] },
        ...(dueIds ? { id: { in: dueIds } } : {}),
      },
      include: { feeHead: { select: { order: true } } },
    });
    if (dueIds && dues.length !== dueIds.length) {
      throw conflict('Some selected dues are already paid or not found. Refresh the fee card and try again.');
    }
    const likes: DueLike[] = dues.map((d) => ({
      id: d.id,
      dueDate: toDateStr(d.dueDate),
      amount: d.amount,
      concession: d.concession,
      fine: d.fine,
      paid: d.paid,
      status: d.status,
      lateFine: fines.get(d.feeHeadId) ?? 0,
      headOrder: d.feeHead.order,
    }));
    const alloc = allocatePayment(likes, { amount: input.amount, date: input.date, waiveFine: input.waiveFine });
    if (!alloc.lines.length) throw badRequest('Nothing is due for this student');
    if (alloc.excess > 0) {
      throw badRequest(`Amount is more than what is due. Maximum for the selected dues is ${formatINR(alloc.payable)}.`);
    }

    // One guarded bulk update: if anyone paid these dues meanwhile, nothing changes and we abort.
    const before = new Map(likes.map((d) => [d.id, d]));
    const values = alloc.lines.map(
      (l) =>
        Prisma.sql`(${l.id}, ${before.get(l.id)!.paid}::int, ${before.get(l.id)!.fine}::int, ${l.paidAfter}::int, ${l.fineAfter}::int, ${l.status}::"DueStatus")`,
    );
    const changed = await tx.$executeRaw`
      UPDATE "StudentFeeDue" AS d
         SET "paid" = v.paid_after, "fine" = v.fine_after, "status" = v.status, "updatedAt" = now()
        FROM (VALUES ${Prisma.join(values)}) AS v(id, paid_before, fine_before, paid_after, fine_after, status)
       WHERE d."id" = v.id AND d."paid" = v.paid_before AND d."fine" = v.fine_before AND d."status" IN ('UNPAID', 'PARTIAL')`;
    if (changed !== alloc.lines.length) throw conflict('These dues were just updated by someone else. Refresh and try again.');

    const n = await nextNumber(tx, a.sid, `receipt:${session.name}`);
    const payment = await tx.payment.create({
      data: {
        schoolId: a.sid,
        sessionId: session.id,
        studentId: student.id,
        receiptNo: formatReceiptNo(session.name, n),
        date: dateOnly(input.date),
        amount: alloc.allocated,
        mode: input.mode,
        reference: input.reference ?? null,
        remarks: input.remarks ?? null,
        collectedById: a.sub,
        allocations: { create: alloc.lines.map((l) => ({ dueId: l.id, amount: l.amount })) },
      },
    });
    return { payment, alloc };
  }, TX);

  audit(req, 'fees.collect', 'Payment', payment.id, {
    receiptNo: payment.receiptNo,
    studentId: student.id,
    amount: payment.amount,
    mode: payment.mode,
    fineCharged: alloc.fineCharged,
    fineWaived: alloc.fineWaived,
  });
  res.status(201).json({
    id: payment.id,
    receiptNo: payment.receiptNo,
    amount: payment.amount,
    fineCharged: alloc.fineCharged,
    fineWaived: alloc.fineWaived,
  });
});

// ───────── Receipts ─────────

/** Receipt list for a date range (default today). */
feesCollectRouter.get('/payments', can('fees.view', 'fees.collect'), async (req, res) => {
  const { sid } = authOf(req);
  const from = optStr(req.query.from) ?? todayStr();
  const to = optStr(req.query.to) ?? from;
  const studentId = optStr(req.query.studentId);
  if (to < from) throw badRequest('"To" date is before "from" date');
  const rows = await prisma.payment.findMany({
    where: { schoolId: sid, date: { gte: dateOnly(from), lte: dateOnly(to) }, ...(studentId ? { studentId } : {}) },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 1000,
    include: {
      collectedBy: { select: { name: true } },
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
  const items = rows.map((p) => {
    const sec = p.student.enrollments[0]?.section;
    return toPaymentRow(p, { ...p.student, classLabel: sec ? `${sec.class.name}-${sec.name}` : null });
  });
  const live = items.filter((p) => !p.cancelledAt);
  res.json({ from, to, items, total: sum(live, (p) => p.amount), count: live.length });
});

/** One receipt — staff with fee access, or the parent of that student. */
feesCollectRouter.get('/payments/:id', async (req, res) => {
  const a = authOf(req);
  const id = str(req.params.id);
  if (!hasAnyFeePerm(a)) {
    const p = await prisma.payment.findFirst({ where: { id, schoolId: a.sid }, select: { studentId: true } });
    if (!p) throw notFound('Receipt not found');
    const mine =
      a.guardianId &&
      (await prisma.studentGuardian.findUnique({
        where: { studentId_guardianId: { studentId: p.studentId, guardianId: a.guardianId } },
      }));
    if (!mine) throw forbidden();
  }
  res.json(await receiptDetail(a.sid, id));
});

/** Cancel a receipt: reverse its allocations and recompute the dues. */
feesCollectRouter.post('/payments/:id/cancel', can('fees.manage'), async (req, res) => {
  const a = authOf(req);
  const id = str(req.params.id);
  const { reason } = parse(cancelPaymentSchema, req.body);
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findFirst({
      where: { id, schoolId: a.sid },
      include: { allocations: { include: { due: true } } },
    });
    if (!p) throw notFound('Receipt not found');
    if (p.cancelledAt) throw badRequest('This receipt is already cancelled');
    if (p.allocations.length) {
      const values = p.allocations.map((al) => {
        const d = al.due;
        const paidAfter = Math.max(0, d.paid - al.amount);
        // A late fine is charged with the first payment; with nothing paid any more it goes too.
        const fineAfter = paidAfter === 0 ? 0 : d.fine;
        const status = d.status === 'WAIVED' ? 'WAIVED' : dueStatusOf({ ...d, fine: fineAfter }, paidAfter);
        return Prisma.sql`(${d.id}, ${d.paid}::int, ${paidAfter}::int, ${fineAfter}::int, ${status}::"DueStatus")`;
      });
      const changed = await tx.$executeRaw`
        UPDATE "StudentFeeDue" AS d
           SET "paid" = v.paid_after, "fine" = v.fine_after, "status" = v.status, "updatedAt" = now()
          FROM (VALUES ${Prisma.join(values)}) AS v(id, paid_before, paid_after, fine_after, status)
         WHERE d."id" = v.id AND d."paid" = v.paid_before`;
      if (changed !== p.allocations.length) throw conflict('The dues changed meanwhile. Refresh and try again.');
    }
    return tx.payment.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: reason } });
  }, TX);
  audit(req, 'fees.receipt.cancel', 'Payment', id, { receiptNo: payment.receiptNo, amount: payment.amount, reason });
  res.json({ ok: true });
});

// ───────── Parent view ─────────

feesCollectRouter.get('/parent/children/:id', requireKind('PARENT'), async (req, res) => {
  const a = authOf(req);
  const studentId = str(req.params.id);
  if (!a.guardianId) throw forbidden();
  const link = await prisma.studentGuardian.findUnique({
    where: { studentId_guardianId: { studentId, guardianId: a.guardianId } },
    include: { student: { select: { schoolId: true } } },
  });
  if (!link || link.student.schoolId !== a.sid) throw forbidden('This student is not linked to your account');
  res.json(await buildCard(a.sid, studentId, { autoGenerate: true }));
});
