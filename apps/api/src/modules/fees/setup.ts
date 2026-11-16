import { Router } from 'express';
import {
  concessionSchema,
  dueStatusOf,
  feeHeadSchema,
  feeStructureSchema,
  generateDuesSchema,
  waiveDueSchema,
  type FeeHeadRow,
  type FeeStructureView,
} from '@erp/shared';
import { prisma } from '../../db';
import { badRequest, conflict, notFound, optStr, parse, str } from '../../lib/http';
import { toDateStr } from '../../lib/dates';
import { audit } from '../../lib/audit';
import { authOf, can } from '../../middleware/auth';
import { currentSession } from '../academic';
import { anyFeePerm, concessionInclude, generateDues, TX, toConcessionRow } from './common';

/** Fee heads, class-wise structure, concessions, dues generation, waivers. */
export const feesSetupRouter = Router();

// ───────── Fee heads ─────────

feesSetupRouter.get('/heads', anyFeePerm, async (req, res) => {
  const { sid } = authOf(req);
  const heads = await prisma.feeHead.findMany({
    where: { schoolId: sid },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { dues: true } } },
  });
  res.json(
    heads.map(
      (h): FeeHeadRow => ({ id: h.id, name: h.name, frequency: h.frequency, order: h.order, isActive: h.isActive, dues: h._count.dues }),
    ),
  );
});

feesSetupRouter.post('/heads', can('fees.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const data = parse(feeHeadSchema, req.body);
  if (await prisma.feeHead.findFirst({ where: { schoolId: sid, name: { equals: data.name, mode: 'insensitive' } } })) {
    throw conflict(`A fee head named "${data.name}" already exists`);
  }
  const head = await prisma.feeHead.create({ data: { ...data, schoolId: sid } });
  audit(req, 'fees.head.create', 'FeeHead', head.id, { name: head.name });
  res.status(201).json(head);
});

feesSetupRouter.put('/heads/:id', can('fees.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const id = str(req.params.id);
  const data = parse(feeHeadSchema, req.body);
  const head = await prisma.feeHead.findFirst({ where: { id, schoolId: sid }, include: { _count: { select: { dues: true } } } });
  if (!head) throw notFound('Fee head not found');
  if (head.frequency !== data.frequency && head._count.dues > 0) {
    throw badRequest('Dues already exist for this head, so its frequency cannot change. Create a new head instead.');
  }
  const clash = await prisma.feeHead.findFirst({
    where: { schoolId: sid, id: { not: id }, name: { equals: data.name, mode: 'insensitive' } },
  });
  if (clash) throw conflict(`A fee head named "${data.name}" already exists`);
  const updated = await prisma.feeHead.update({ where: { id }, data });
  audit(req, 'fees.head.update', 'FeeHead', id, data);
  res.json(updated);
});

feesSetupRouter.delete('/heads/:id', can('fees.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const id = str(req.params.id);
  const head = await prisma.feeHead.findFirst({ where: { id, schoolId: sid }, include: { _count: { select: { dues: true } } } });
  if (!head) throw notFound('Fee head not found');
  if (head._count.dues > 0) throw conflict('Dues exist for this head. Mark it inactive instead of deleting.');
  await prisma.feeHead.delete({ where: { id } });
  audit(req, 'fees.head.delete', 'FeeHead', id, { name: head.name });
  res.json({ ok: true });
});

// ───────── Class-wise structure (current session) ─────────

feesSetupRouter.get('/structure', anyFeePerm, async (req, res) => {
  const { sid } = authOf(req);
  const session = await currentSession(sid);
  const [heads, classes, items, enrolled, withDues] = await Promise.all([
    prisma.feeHead.findMany({
      where: { schoolId: sid },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { dues: true } } },
    }),
    prisma.class.findMany({ where: { schoolId: sid }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    prisma.feeStructure.findMany({ where: { schoolId: sid, sessionId: session.id } }),
    prisma.enrollment.findMany({
      where: { sessionId: session.id, student: { schoolId: sid, status: 'ACTIVE' } },
      select: { studentId: true, section: { select: { classId: true } } },
    }),
    prisma.studentFeeDue.groupBy({ by: ['studentId'], where: { schoolId: sid, sessionId: session.id } }),
  ]);
  const hasDues = new Set(withDues.map((r) => r.studentId));
  const view: FeeStructureView = {
    session: { id: session.id, name: session.name, startDate: toDateStr(session.startDate), endDate: toDateStr(session.endDate) },
    heads: heads.map((h) => ({ id: h.id, name: h.name, frequency: h.frequency, order: h.order, isActive: h.isActive, dues: h._count.dues })),
    classes: classes.map((c) => {
      const mine = enrolled.filter((e) => e.section.classId === c.id);
      return { ...c, students: mine.length, studentsWithDues: mine.filter((e) => hasDues.has(e.studentId)).length };
    }),
    items: items.map((i) => ({ classId: i.classId, feeHeadId: i.feeHeadId, amount: i.amount, dueDay: i.dueDay, lateFine: i.lateFine })),
  };
  res.json(view);
});

/** Upsert grid cells; amount 0 removes the head from that class. Run "Generate dues" afterwards to apply. */
feesSetupRouter.put('/structure', can('fees.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const { items } = parse(feeStructureSchema, req.body);
  const session = await currentSession(sid);
  const classIds = [...new Set(items.map((i) => i.classId))];
  const headIds = [...new Set(items.map((i) => i.feeHeadId))];
  const [okClasses, okHeads] = await Promise.all([
    prisma.class.count({ where: { schoolId: sid, id: { in: classIds } } }),
    prisma.feeHead.count({ where: { schoolId: sid, id: { in: headIds } } }),
  ]);
  if (okClasses !== classIds.length || okHeads !== headIds.length) throw badRequest('Unknown class or fee head');

  const existing = await prisma.feeStructure.findMany({ where: { schoolId: sid, sessionId: session.id } });
  const key = (c: string, h: string) => `${c}|${h}`;
  const byKey = new Map(existing.map((e) => [key(e.classId, e.feeHeadId), e]));
  const toDelete: string[] = [];
  const toCreate: typeof items = [];
  const toUpdate: { id: string; amount: number; dueDay: number; lateFine: number }[] = [];
  for (const i of items) {
    const e = byKey.get(key(i.classId, i.feeHeadId));
    if (i.amount <= 0) {
      if (e) toDelete.push(e.id);
    } else if (!e) toCreate.push(i);
    else if (e.amount !== i.amount || e.dueDay !== i.dueDay || e.lateFine !== i.lateFine) {
      toUpdate.push({ id: e.id, amount: i.amount, dueDay: i.dueDay, lateFine: i.lateFine });
    }
  }
  await prisma.$transaction(async (tx) => {
    if (toDelete.length) await tx.feeStructure.deleteMany({ where: { id: { in: toDelete } } });
    if (toCreate.length) {
      await tx.feeStructure.createMany({ data: toCreate.map((i) => ({ ...i, schoolId: sid, sessionId: session.id })) });
    }
    for (const u of toUpdate) await tx.feeStructure.update({ where: { id: u.id }, data: u });
  }, TX);
  audit(req, 'fees.structure.save', 'FeeStructure', undefined, {
    created: toCreate.length,
    updated: toUpdate.length,
    removed: toDelete.length,
  });
  res.json({ created: toCreate.length, updated: toUpdate.length, removed: toDelete.length });
});

// ───────── Generate dues ─────────

feesSetupRouter.post('/generate', can('fees.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const { classId } = parse(generateDuesSchema, req.body ?? {});
  if (classId && !(await prisma.class.findFirst({ where: { id: classId, schoolId: sid } }))) throw notFound('Class not found');
  const session = await currentSession(sid);
  const r = await generateDues(sid, session, { classId: classId ?? undefined });
  audit(req, 'fees.dues.generate', 'StudentFeeDue', undefined, { classId: classId ?? 'all', ...r });
  res.json(r);
});

// ───────── Concessions ─────────

feesSetupRouter.get('/concessions', anyFeePerm, async (req, res) => {
  const { sid } = authOf(req);
  const session = await currentSession(sid);
  const studentId = optStr(req.query.studentId);
  const rows = await prisma.concession.findMany({
    where: { schoolId: sid, sessionId: session.id, ...(studentId ? { studentId } : {}) },
    orderBy: { createdAt: 'desc' },
    include: concessionInclude(session.id),
  });
  res.json(rows.map(toConcessionRow));
});

feesSetupRouter.post('/concessions', can('fees.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const data = parse(concessionSchema, req.body);
  const session = await currentSession(sid);
  const [student, head] = await Promise.all([
    prisma.student.findFirst({ where: { id: data.studentId, schoolId: sid } }),
    data.feeHeadId ? prisma.feeHead.findFirst({ where: { id: data.feeHeadId, schoolId: sid } }) : null,
  ]);
  if (!student) throw notFound('Student not found');
  if (data.feeHeadId && !head) throw notFound('Fee head not found');
  const c = await prisma.concession.create({
    data: {
      schoolId: sid,
      sessionId: session.id,
      studentId: data.studentId,
      feeHeadId: data.feeHeadId ?? null,
      percent: data.percent ?? null,
      amount: data.amount ?? null,
      reason: data.reason,
    },
    include: concessionInclude(session.id),
  });
  // Apply to the student's unpaid dues right away.
  const applied = await generateDues(sid, session, { studentId: data.studentId });
  audit(req, 'fees.concession.create', 'Concession', c.id, { studentId: data.studentId, percent: c.percent, amount: c.amount });
  res.status(201).json({ ...toConcessionRow(c), applied });
});

feesSetupRouter.delete('/concessions/:id', can('fees.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const id = str(req.params.id);
  const c = await prisma.concession.findFirst({ where: { id, schoolId: sid } });
  if (!c) throw notFound('Concession not found');
  await prisma.concession.delete({ where: { id } });
  const session = await currentSession(sid);
  const applied = await generateDues(sid, session, { studentId: c.studentId });
  audit(req, 'fees.concession.delete', 'Concession', id, { studentId: c.studentId, reason: c.reason });
  res.json({ ok: true, applied });
});

// ───────── Waive a single due ─────────

feesSetupRouter.post('/dues/:id/waive', can('fees.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const id = str(req.params.id);
  const { reason } = parse(waiveDueSchema, req.body);
  const due = await prisma.studentFeeDue.findFirst({ where: { id, schoolId: sid } });
  if (!due) throw notFound('Due not found');
  if (due.status === 'PAID' || due.status === 'WAIVED') throw badRequest(`This due is already ${due.status.toLowerCase()}`);
  await prisma.studentFeeDue.update({ where: { id }, data: { status: 'WAIVED' } });
  audit(req, 'fees.due.waive', 'StudentFeeDue', id, { reason, label: due.label, balance: due.amount - due.concession + due.fine - due.paid });
  res.json({ ok: true });
});

feesSetupRouter.post('/dues/:id/unwaive', can('fees.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const id = str(req.params.id);
  const due = await prisma.studentFeeDue.findFirst({ where: { id, schoolId: sid } });
  if (!due) throw notFound('Due not found');
  if (due.status !== 'WAIVED') throw badRequest('This due is not waived');
  await prisma.studentFeeDue.update({ where: { id }, data: { status: dueStatusOf(due, due.paid) } });
  audit(req, 'fees.due.unwaive', 'StudentFeeDue', id, { label: due.label });
  res.json({ ok: true });
});
