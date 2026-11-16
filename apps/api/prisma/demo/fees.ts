/**
 * Demo fees: heads, class-wise structure for the current session, a sibling concession,
 * dues for all enrolled students and a set of receipts. Idempotent — a second run creates nothing.
 */
import { allocatePayment, formatReceiptNo, toPaise, type CollectMode, type DueLike } from '@erp/shared';
import { prisma } from '../../src/db';
import { nextNumber } from '../../src/lib/counters';
import { dateOnly, toDateStr, todayStr } from '../../src/lib/dates';
import { generateDues, TX } from '../../src/modules/fees/common';

const HEADS = [
  { name: 'Admission Fee', frequency: 'ONE_TIME', order: 1 },
  { name: 'Tuition Fee', frequency: 'MONTHLY', order: 2 },
  { name: 'Computer Fee', frequency: 'MONTHLY', order: 3 },
  { name: 'Exam Fee', frequency: 'HALF_YEARLY', order: 4 },
] as const;

/** ₹ per class (by class name). Computer fee only from class 3. */
const TUITION: Record<string, number> = { Nursery: 400, LKG: 450, UKG: 450, '1': 500, '2': 550, '3': 600, '4': 650, '5': 700, '6': 750, '7': 800, '8': 900 };
const pre = (c: string) => ['Nursery', 'LKG', 'UKG'].includes(c);
const senior = (c: string) => ['6', '7', '8'].includes(c);

export async function seedDemoFees(schoolId: string) {
  const session = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
  if (!session) return;

  // Heads
  for (const h of HEADS) {
    await prisma.feeHead.upsert({
      where: { schoolId_name: { schoolId, name: h.name } },
      create: { schoolId, ...h },
      update: {},
    });
  }
  const heads = Object.fromEntries(
    (await prisma.feeHead.findMany({ where: { schoolId, name: { in: HEADS.map((h) => h.name) } } })).map((h) => [h.name, h.id]),
  );

  // Structure (only cells that don't exist yet)
  const classes = await prisma.class.findMany({ where: { schoolId } });
  const cells = classes.flatMap((c) => {
    const tuition = TUITION[c.name];
    if (!tuition) return [];
    const rows = [
      { feeHeadId: heads['Tuition Fee'], amount: toPaise(tuition), lateFine: toPaise(50) },
      { feeHeadId: heads['Admission Fee'], amount: toPaise(pre(c.name) ? 1000 : senior(c.name) ? 2000 : 1500), lateFine: 0 },
      { feeHeadId: heads['Exam Fee'], amount: toPaise(pre(c.name) ? 300 : senior(c.name) ? 500 : 400), lateFine: toPaise(25) },
    ];
    if (!pre(c.name) && !['1', '2'].includes(c.name)) {
      rows.push({ feeHeadId: heads['Computer Fee'], amount: toPaise(senior(c.name) ? 150 : 100), lateFine: 0 });
    }
    return rows.map((r) => ({ ...r, schoolId, sessionId: session.id, classId: c.id, dueDay: 10 }));
  });
  await prisma.feeStructure.createMany({ data: cells, skipDuplicates: true });

  // Sibling concession: ₹100 off tuition every month for the younger Sharma child (3-A).
  const sibling = await prisma.student.findFirst({
    where: { schoolId, firstName: 'Rohan', lastName: 'Sharma', enrollments: { some: { sessionId: session.id } } },
  });
  if (sibling && !(await prisma.concession.findFirst({ where: { studentId: sibling.id, sessionId: session.id } }))) {
    await prisma.concession.create({
      data: { schoolId, sessionId: session.id, studentId: sibling.id, feeHeadId: heads['Tuition Fee'], amount: toPaise(100), reason: 'Sibling concession' },
    });
  }

  await generateDues(schoolId, session);

  // Receipts — only once.
  if (await prisma.payment.count({ where: { schoolId } })) return;
  const principal = await prisma.user.findFirst({ where: { schoolId, roles: { some: { role: { kind: 'PRINCIPAL' } } } } });
  const enrolled = await prisma.enrollment.findMany({
    where: { sessionId: session.id, student: { schoolId, status: 'ACTIVE' } },
    orderBy: [{ section: { class: { order: 'desc' } } }, { rollNo: 'asc' }],
    select: { studentId: true, section: { select: { classId: true } } },
  });
  const today = todayStr();
  // Pattern by position: up to date / paid till Sep / paid till Jun / nothing paid yet.
  const plans: [string, string, CollectMode, string?][][] = [
    [['2026-04-07', '2026-06', 'CASH'], ['2026-07-08', '2026-09', 'UPI', 'UPI 6187 2290 4410'], ['2026-10-14', '2026-11', 'CASH']],
    [['2026-04-09', '2026-06', 'CASH'], ['2026-07-21', '2026-09', 'CHEQUE', 'SBI 004512']],
    [['2026-04-15', '2026-06', 'CASH']],
    [],
  ];
  const planOf = (k: number) => (k + 1) % plans.length; // the Sharma children land on "paid till Sep"
  for (const [k, e] of enrolled.entries()) {
    const plan = plans[planOf(k)];
    for (const [date, upTo, mode, reference] of plan) {
      if (date > today) continue;
      await pay(schoolId, session, e.studentId, e.section.classId, { date, upTo, mode, reference, collectedById: principal?.id ?? null });
    }
  }
  // A couple of receipts today so the dashboard has numbers.
  for (const e of enrolled.filter((_, k) => planOf(k) === 3).slice(0, 2)) {
    await pay(schoolId, session, e.studentId, e.section.classId, {
      date: today,
      upTo: '2026-05',
      mode: 'CASH',
      collectedById: principal?.id ?? null,
    });
  }
}

/** Pay all open dues of a student falling due up to month `upTo`, as the API would. */
async function pay(
  schoolId: string,
  session: { id: string; name: string },
  studentId: string,
  classId: string,
  o: { date: string; upTo: string; mode: CollectMode; reference?: string; collectedById: string | null },
) {
  await prisma.$transaction(async (tx) => {
    const [dues, structures] = await Promise.all([
      tx.studentFeeDue.findMany({
        where: { studentId, sessionId: session.id, status: { in: ['UNPAID', 'PARTIAL'] } },
        include: { feeHead: { select: { order: true } } },
      }),
      tx.feeStructure.findMany({ where: { sessionId: session.id, classId } }),
    ]);
    const fines = new Map(structures.map((s) => [s.feeHeadId, s.lateFine]));
    const likes: DueLike[] = dues
      .filter((d) => toDateStr(d.dueDate).slice(0, 7) <= o.upTo)
      .map((d) => ({
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
    const alloc = allocatePayment(likes, { date: o.date });
    if (!alloc.lines.length || alloc.allocated <= 0) return;
    for (const l of alloc.lines) {
      await tx.studentFeeDue.update({ where: { id: l.id }, data: { paid: l.paidAfter, fine: l.fineAfter, status: l.status } });
    }
    const n = await nextNumber(tx, schoolId, `receipt:${session.name}`);
    await tx.payment.create({
      data: {
        schoolId,
        sessionId: session.id,
        studentId,
        receiptNo: formatReceiptNo(session.name, n),
        date: dateOnly(o.date),
        amount: alloc.allocated,
        mode: o.mode,
        reference: o.reference ?? null,
        collectedById: o.collectedById,
        allocations: { create: alloc.lines.map((l) => ({ dueId: l.id, amount: l.amount })) },
      },
    });
  }, TX);
}
