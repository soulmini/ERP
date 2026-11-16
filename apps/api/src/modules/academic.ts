import { Router } from 'express';
import {
  classSchema,
  classSubjectSchema,
  sectionSchema,
  sessionSchema,
  subjectSchema,
} from '@erp/shared';
import { prisma } from '../db';
import { badRequest, notFound, parse, str } from '../lib/http';
import { audit } from '../lib/audit';
import { authOf, can } from '../middleware/auth';

export const academicRouter = Router();

/** The school's current academic session; most features require one. */
export async function currentSession(schoolId: string) {
  const s = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
  if (!s) throw badRequest('No current academic session. Ask the Principal to set one in Academic settings.');
  return s;
}

/** Ensure a section belongs to the school; returns it with its class. */
export async function sectionOfSchool(sectionId: string, schoolId: string) {
  const section = await prisma.section.findFirst({
    where: { id: sectionId, class: { schoolId } },
    include: { class: true },
  });
  if (!section) throw notFound('Section not found');
  return section;
}

// ───────── Sessions ─────────

academicRouter.get('/sessions', async (req, res) => {
  res.json(
    await prisma.academicSession.findMany({
      where: { schoolId: authOf(req).sid },
      orderBy: { startDate: 'desc' },
    }),
  );
});

academicRouter.post('/sessions', can('academic.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const data = parse(sessionSchema, req.body);
  if (data.endDate <= data.startDate) throw badRequest('End date must be after start date');
  const session = await prisma.$transaction(async (tx) => {
    if (data.isCurrent) {
      await tx.academicSession.updateMany({ where: { schoolId: sid }, data: { isCurrent: false } });
    }
    return tx.academicSession.create({ data: { ...data, schoolId: sid } });
  });
  audit(req, 'session.create', 'AcademicSession', session.id);
  res.status(201).json(session);
});

academicRouter.post('/sessions/:id/current', can('academic.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const id = str(req.params.id);
  const s = await prisma.academicSession.findFirst({ where: { id, schoolId: sid } });
  if (!s) throw notFound();
  await prisma.$transaction([
    prisma.academicSession.updateMany({ where: { schoolId: sid }, data: { isCurrent: false } }),
    prisma.academicSession.update({ where: { id }, data: { isCurrent: true } }),
  ]);
  audit(req, 'session.setCurrent', 'AcademicSession', id);
  res.json({ ok: true });
});

// ───────── Classes & sections ─────────

academicRouter.get('/classes', async (req, res) => {
  const { sid } = authOf(req);
  const session = await prisma.academicSession.findFirst({ where: { schoolId: sid, isCurrent: true } });
  const classes = await prisma.class.findMany({
    where: { schoolId: sid },
    orderBy: { order: 'asc' },
    include: {
      sections: {
        orderBy: { name: 'asc' },
        include: {
          classTeacher: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { enrollments: session ? { where: { sessionId: session.id } } : true } },
        },
      },
      subjects: { include: { subject: true } },
    },
  });
  res.json(
    classes.map((c) => ({
      ...c,
      sections: c.sections.map(({ _count, ...s }) => ({ ...s, studentCount: _count.enrollments })),
      subjects: c.subjects.map((cs) => cs.subject),
    })),
  );
});

academicRouter.post('/classes', can('academic.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const { sections, ...data } = parse(classSchema, req.body);
  const cls = await prisma.class.create({
    data: {
      ...data,
      schoolId: sid,
      sections: { create: (sections?.length ? sections : ['A']).map((name) => ({ name })) },
    },
    include: { sections: true },
  });
  audit(req, 'class.create', 'Class', cls.id);
  res.status(201).json(cls);
});

academicRouter.put('/classes/:id', can('academic.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const { sections: _s, ...data } = parse(classSchema, req.body);
  const r = await prisma.class.updateMany({ where: { id: str(req.params.id), schoolId: sid }, data });
  if (!r.count) throw notFound();
  res.json({ ok: true });
});

academicRouter.delete('/classes/:id', can('academic.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const id = str(req.params.id);
  const enrolled = await prisma.enrollment.count({ where: { section: { classId: id, class: { schoolId: sid } } } });
  if (enrolled) throw badRequest('This class has students. Move them before deleting.');
  const r = await prisma.class.deleteMany({ where: { id, schoolId: sid } });
  if (!r.count) throw notFound();
  audit(req, 'class.delete', 'Class', id);
  res.json({ ok: true });
});

academicRouter.put('/classes/:id/subjects', can('academic.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const classId = str(req.params.id);
  const { subjectIds } = parse(classSubjectSchema, req.body);
  const cls = await prisma.class.findFirst({ where: { id: classId, schoolId: sid } });
  if (!cls) throw notFound();
  const valid = await prisma.subject.findMany({ where: { id: { in: subjectIds }, schoolId: sid } });
  await prisma.$transaction([
    prisma.classSubject.deleteMany({ where: { classId, subjectId: { notIn: valid.map((s) => s.id) } } }),
    prisma.classSubject.createMany({
      data: valid.map((s) => ({ classId, subjectId: s.id })),
      skipDuplicates: true,
    }),
  ]);
  res.json({ ok: true });
});

academicRouter.post('/classes/:id/sections', can('academic.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const classId = str(req.params.id);
  const cls = await prisma.class.findFirst({ where: { id: classId, schoolId: sid } });
  if (!cls) throw notFound();
  const data = parse(sectionSchema, req.body);
  if (data.classTeacherId) await assertStaff(data.classTeacherId, sid);
  const section = await prisma.section.create({ data: { ...data, classId } });
  audit(req, 'section.create', 'Section', section.id);
  res.status(201).json(section);
});

academicRouter.put('/sections/:id', can('academic.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const section = await sectionOfSchool(str(req.params.id), sid);
  const data = parse(sectionSchema.partial(), req.body);
  if (data.classTeacherId) await assertStaff(data.classTeacherId, sid);
  const updated = await prisma.section.update({ where: { id: section.id }, data });
  audit(req, 'section.update', 'Section', section.id, data);
  res.json(updated);
});

academicRouter.delete('/sections/:id', can('academic.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const section = await sectionOfSchool(str(req.params.id), sid);
  if (await prisma.enrollment.count({ where: { sectionId: section.id } })) {
    throw badRequest('This section has students. Move them before deleting.');
  }
  await prisma.section.delete({ where: { id: section.id } });
  audit(req, 'section.delete', 'Section', section.id);
  res.json({ ok: true });
});

async function assertStaff(staffId: string, schoolId: string) {
  const s = await prisma.staff.findFirst({ where: { id: staffId, schoolId, isActive: true } });
  if (!s) throw badRequest('Selected teacher not found');
}

// ───────── Subjects ─────────

academicRouter.get('/subjects', async (req, res) => {
  res.json(await prisma.subject.findMany({ where: { schoolId: authOf(req).sid }, orderBy: { name: 'asc' } }));
});

academicRouter.post('/subjects', can('academic.manage'), async (req, res) => {
  const data = parse(subjectSchema, req.body);
  const subject = await prisma.subject.create({ data: { ...data, schoolId: authOf(req).sid } });
  res.status(201).json(subject);
});

academicRouter.put('/subjects/:id', can('academic.manage'), async (req, res) => {
  const data = parse(subjectSchema, req.body);
  const r = await prisma.subject.updateMany({ where: { id: str(req.params.id), schoolId: authOf(req).sid }, data });
  if (!r.count) throw notFound();
  res.json({ ok: true });
});

academicRouter.delete('/subjects/:id', can('academic.manage'), async (req, res) => {
  const r = await prisma.subject.deleteMany({ where: { id: str(req.params.id), schoolId: authOf(req).sid } });
  if (!r.count) throw notFound();
  res.json({ ok: true });
});
