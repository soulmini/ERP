import { Router } from 'express';
import { WEEK_DAYS, periodSchema, timetableGridSchema } from '@erp/shared';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound, parse, str } from '../lib/http';
import { audit } from '../lib/audit';
import type { AuthPayload } from '../lib/tokens';
import { authOf, can } from '../middleware/auth';
import { currentSession } from './academic';
import { parentChildren, sectionLabel } from './scope';

/** Periods and class/teacher time tables. */
export const timetableRouter = Router();

const dayName = (d: number) => WEEK_DAYS.find((w) => w.day === d)?.name ?? `Day ${d}`;
const staffName = (s: { firstName: string; lastName: string | null }) => `${s.firstName} ${s.lastName ?? ''}`.trim();

const periodsOf = (schoolId: string) => prisma.period.findMany({ where: { schoolId }, orderBy: [{ order: 'asc' }, { startTime: 'asc' }] });

const slotInclude = {
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  section: { select: { id: true, name: true, class: { select: { name: true } } } },
} as const;

type SlotRow = Awaited<ReturnType<typeof loadSlots>>[number];
const loadSlots = (where: object) => prisma.timetableSlot.findMany({ where, include: slotInclude });

const presentSlot = (s: SlotRow) => ({
  id: s.id,
  day: s.day,
  periodId: s.periodId,
  room: s.room,
  subject: s.subject,
  teacher: s.teacher ? { id: s.teacher.id, name: staffName(s.teacher) } : null,
  section: { id: s.section.id, label: sectionLabel(s.section) },
});

// ───────── Periods ─────────

timetableRouter.get('/periods', async (req, res) => {
  res.json(await periodsOf(authOf(req).sid));
});

timetableRouter.post('/periods', can('timetable.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(periodSchema, req.body);
  const p = await prisma.period.create({ data: { ...input, schoolId: a.sid } });
  audit(req, 'period.create', 'Period', p.id);
  res.status(201).json(p);
});

timetableRouter.put('/periods/:id', can('timetable.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(periodSchema, req.body);
  const r = await prisma.period.updateMany({ where: { id: str(req.params.id), schoolId: a.sid }, data: input });
  if (!r.count) throw notFound('Period not found');
  // A period turned into a break can't hold classes.
  if (input.isBreak) await prisma.timetableSlot.deleteMany({ where: { periodId: str(req.params.id), schoolId: a.sid } });
  res.json({ ok: true });
});

timetableRouter.delete('/periods/:id', can('timetable.manage'), async (req, res) => {
  const a = authOf(req);
  const r = await prisma.period.deleteMany({ where: { id: str(req.params.id), schoolId: a.sid } });
  if (!r.count) throw notFound('Period not found');
  audit(req, 'period.delete', 'Period', str(req.params.id));
  res.json({ ok: true });
});

// ───────── Class time table ─────────

async function assertCanView(a: AuthPayload, sectionId: string) {
  if (a.view !== 'parent') return; // staff may view any class of their school
  const mine = (await parentChildren(a)).some((c) => c.sectionId === sectionId);
  if (!mine) throw forbidden();
}

/** One section's week: periods, slots, the class's subjects and active teachers (for the editor). */
timetableRouter.get('/section/:sectionId', async (req, res) => {
  const a = authOf(req);
  const sectionId = str(req.params.sectionId);
  const section = await prisma.section.findFirst({
    where: { id: sectionId, class: { schoolId: a.sid } },
    include: {
      class: { include: { subjects: { include: { subject: { select: { id: true, name: true } } } } } },
      classTeacher: { select: { firstName: true, lastName: true } },
    },
  });
  if (!section) throw notFound('Section not found');
  await assertCanView(a, sectionId);
  const session = await currentSession(a.sid);
  const [periods, slots, teachers] = await Promise.all([
    periodsOf(a.sid),
    loadSlots({ sectionId, sessionId: session.id }),
    a.view === 'admin'
      ? prisma.staff.findMany({ where: { schoolId: a.sid, isActive: true }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true, designation: true } })
      : Promise.resolve([]),
  ]);
  res.json({
    section: {
      id: section.id,
      label: sectionLabel(section),
      classTeacher: section.classTeacher ? staffName(section.classTeacher) : null,
    },
    periods,
    slots: slots.map(presentSlot),
    subjects: section.class.subjects.map((cs) => ({ ...cs.subject, teacherId: cs.teacherId })).sort((x, y) => x.name.localeCompare(y.name)),
    teachers: teachers.map((t) => ({ id: t.id, name: staffName(t), designation: t.designation })),
  });
});

/** Replace a section's whole week. Rejects teacher clashes with other sections. */
timetableRouter.put('/section/:sectionId', can('timetable.manage'), async (req, res) => {
  const a = authOf(req);
  const sectionId = str(req.params.sectionId);
  const section = await prisma.section.findFirst({ where: { id: sectionId, class: { schoolId: a.sid } }, include: { class: true } });
  if (!section) throw notFound('Section not found');
  const { slots: input } = parse(timetableGridSchema, req.body);
  const session = await currentSession(a.sid);

  const cells = input.filter((c) => c.subjectId || c.teacherId);
  const seen = new Set<string>();
  for (const c of cells) {
    const k = `${c.day}:${c.periodId}`;
    if (seen.has(k)) throw badRequest('Two entries for the same day and period');
    seen.add(k);
  }

  const [periods, classSubjects, staff] = await Promise.all([
    periodsOf(a.sid),
    prisma.classSubject.findMany({ where: { classId: section.classId }, select: { subjectId: true } }),
    prisma.staff.findMany({ where: { schoolId: a.sid, isActive: true }, select: { id: true } }),
  ]);
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const subjectOk = new Set(classSubjects.map((s) => s.subjectId));
  const staffOk = new Set(staff.map((s) => s.id));
  for (const c of cells) {
    const p = periodById.get(c.periodId);
    if (!p) throw badRequest('Unknown period');
    if (p.isBreak) throw badRequest(`${p.name} is a break`);
    if (c.subjectId && !subjectOk.has(c.subjectId)) throw badRequest('Subject is not taught in this class');
    if (c.teacherId && !staffOk.has(c.teacherId)) throw badRequest('Unknown teacher');
  }

  // Teacher clash: same teacher, same day + period, in another section this session.
  const withTeacher = cells.filter((c) => c.teacherId);
  if (withTeacher.length) {
    const others = await prisma.timetableSlot.findMany({
      where: {
        sessionId: session.id,
        sectionId: { not: sectionId },
        teacherId: { in: [...new Set(withTeacher.map((c) => c.teacherId!))] },
      },
      include: slotInclude,
    });
    for (const c of withTeacher) {
      const clash = others.find((o) => o.teacherId === c.teacherId && o.day === c.day && o.periodId === c.periodId);
      if (clash) {
        throw conflict(
          `${staffName(clash.teacher!)} already teaches ${sectionLabel(clash.section)} on ${dayName(c.day)}, ${periodById.get(c.periodId)!.name}`,
        );
      }
    }
  }

  await prisma.$transaction([
    prisma.timetableSlot.deleteMany({ where: { sectionId, sessionId: session.id } }),
    prisma.timetableSlot.createMany({
      data: cells.map((c) => ({
        schoolId: a.sid,
        sessionId: session.id,
        sectionId,
        periodId: c.periodId,
        day: c.day,
        subjectId: c.subjectId ?? null,
        teacherId: c.teacherId ?? null,
        room: c.room ?? null,
      })),
    }),
  ]);
  audit(req, 'timetable.save', 'Section', sectionId, { cells: cells.length });
  res.json({ ok: true, saved: cells.length });
});

// ───────── Teacher & parent views ─────────

/** Teacher's own week across all sections (?staffId= lets admins view any teacher). */
timetableRouter.get('/teacher', async (req, res) => {
  const a = authOf(req);
  const requested = typeof req.query.staffId === 'string' ? req.query.staffId : null;
  const staffId = requested && a.view === 'admin' ? requested : a.staffId;
  if (!staffId) throw forbidden('Only staff have a time table');
  const staff = await prisma.staff.findFirst({ where: { id: staffId, schoolId: a.sid }, select: { id: true, firstName: true, lastName: true } });
  if (!staff) throw notFound('Teacher not found');
  const session = await currentSession(a.sid);
  const [periods, slots] = await Promise.all([periodsOf(a.sid), loadSlots({ teacherId: staffId, sessionId: session.id })]);
  res.json({ teacher: { id: staff.id, name: staffName(staff) }, periods, slots: slots.map(presentSlot) });
});

/** Parent: their children with sections (the page then loads /section/:id). */
timetableRouter.get('/children', async (req, res) => {
  res.json(await parentChildren(authOf(req)));
});
