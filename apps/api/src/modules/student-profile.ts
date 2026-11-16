import { Router } from 'express';
import {
  admissionGuardianSchema,
  studentGuardianUpdateSchema,
  studentLeaveSchema,
  studentReactivateSchema,
  studentUpdateSchema,
} from '@erp/shared';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound, optStr, parse, str } from '../lib/http';
import { currentMonthStr, dateOnly, monthRange, toDateStr } from '../lib/dates';
import { DOC_TYPES, IMAGE_TYPES, storeUpload, upload } from '../lib/upload';
import { signedUrl } from '../lib/storage';
import { audit } from '../lib/audit';
import type { AuthPayload } from '../lib/tokens';
import { authOf, can, hasPerm } from '../middleware/auth';
import { currentSession, sectionOfSchool } from './academic';
import { assertAdmissionNoFree, ensureGuardian, fullName, nextRollNo } from './student-records';

/** Student profile: details, guardians, documents, photo, status. Mounted inside studentsRouter. */
export const studentProfileRouter = Router();

const TX = { timeout: 30_000, maxWait: 15_000 };

/** Students the user may open: admins with students.view; teachers only their class-teacher sections. */
async function studentFor(a: AuthPayload, id: string) {
  const s = await prisma.student.findFirst({ where: { id, schoolId: a.sid } });
  if (!s) throw notFound('Student not found');
  if (a.view === 'teacher' && !hasPerm(a, 'students.manage')) {
    const mine = await prisma.enrollment.findFirst({ where: { studentId: id, session: { isCurrent: true }, section: { classTeacherId: a.staffId ?? '__none__' } } });
    if (!mine) throw forbidden('You can open profiles of students in your own class only');
  }
  return s;
}

/** CSV export of the student list (all matching rows). */
studentProfileRouter.get('/export', can('students.view'), async (req, res) => {
  const { sid } = authOf(req);
  const session = await currentSession(sid);
  const sectionId = optStr(req.query.sectionId);
  const rows = await prisma.enrollment.findMany({
    where: { sessionId: session.id, student: { schoolId: sid, status: 'ACTIVE' }, ...(sectionId ? { sectionId } : {}) },
    orderBy: [{ section: { class: { order: 'asc' } } }, { section: { name: 'asc' } }, { rollNo: 'asc' }],
    include: {
      section: { include: { class: true } },
      student: { include: { guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' } } } },
    },
  });
  res.json(
    rows.map((e) => {
      const s = e.student;
      const father = s.guardians.find((g) => g.guardian.relation === 'FATHER')?.guardian;
      const mother = s.guardians.find((g) => g.guardian.relation === 'MOTHER')?.guardian;
      const primary = s.guardians[0]?.guardian;
      return {
        admissionNo: s.admissionNo,
        srNo: s.srNo,
        name: fullName(s),
        class: e.section.class.name,
        section: e.section.name,
        rollNo: e.rollNo,
        gender: s.gender,
        dob: toDateStr(s.dob),
        category: s.category,
        aadhaarNo: s.aadhaarNo,
        fatherName: father?.name ?? '',
        motherName: mother?.name ?? '',
        phone: primary?.phone ?? '',
        address: [s.address, s.city].filter(Boolean).join(', '),
        admissionDate: toDateStr(s.admissionDate),
      };
    }),
  );
});

studentProfileRouter.get('/:id', can('students.view'), async (req, res) => {
  const a = authOf(req);
  const base = await studentFor(a, str(req.params.id));
  const s = await prisma.student.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' } },
      enrollments: { include: { section: { include: { class: true } }, session: true }, orderBy: { session: { startDate: 'desc' } } },
      documents: { orderBy: { uploadedAt: 'desc' } },
    },
  });
  const session = await prisma.academicSession.findFirst({ where: { schoolId: a.sid, isCurrent: true } });
  const { from, to } = monthRange(currentMonthStr());
  const att = session
    ? await prisma.studentAttendance.findMany({ where: { studentId: s.id, sessionId: session.id }, select: { date: true, status: true } })
    : [];
  const summarize = (rows: typeof att) => {
    const counted = rows.filter((r) => r.status !== 'HOLIDAY');
    const present = counted.reduce((n, r) => n + (r.status === 'PRESENT' || r.status === 'LATE' ? 1 : r.status === 'HALF_DAY' ? 0.5 : 0), 0);
    return {
      days: counted.length,
      present,
      absent: counted.filter((r) => r.status === 'ABSENT').length,
      leave: counted.filter((r) => r.status === 'LEAVE').length,
      percent: counted.length ? Math.round((present / counted.length) * 1000) / 10 : null,
    };
  };
  const current = s.enrollments.find((e) => e.sessionId === session?.id);
  res.json({
    ...s,
    dob: toDateStr(s.dob),
    admissionDate: toDateStr(s.admissionDate),
    leftDate: s.leftDate ? toDateStr(s.leftDate) : null,
    name: fullName(s),
    photoUrl: await signedUrl(s.photoKey),
    current: current ? { sectionId: current.sectionId, classLabel: `${current.section.class.name}-${current.section.name}`, rollNo: current.rollNo } : null,
    enrollments: s.enrollments.map((e) => ({ id: e.id, session: e.session.name, classLabel: `${e.section.class.name}-${e.section.name}`, rollNo: e.rollNo })),
    guardians: s.guardians.map((g) => ({ ...g.guardian, isPrimary: g.isPrimary, hasLogin: !!g.guardian.userId })),
    documents: await Promise.all(s.documents.map(async (d) => ({ ...d, url: await signedUrl(d.fileKey) }))),
    attendance: { session: summarize(att), month: summarize(att.filter((r) => r.date >= from && r.date < to)) },
    canEdit: hasPerm(a, 'students.manage'),
  });
});

studentProfileRouter.put('/:id', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const input = parse(studentUpdateSchema, req.body);
  const session = await currentSession(a.sid);
  if (input.sectionId) await sectionOfSchool(input.sectionId, a.sid);
  await prisma.$transaction(async (tx) => {
    await assertAdmissionNoFree(tx, a.sid, input.admissionNo, s.id);
    const { sectionId, rollNo, dob, admissionDate, ...profile } = input;
    await tx.student.update({
      where: { id: s.id },
      data: { ...profile, dob: dateOnly(dob), ...(admissionDate ? { admissionDate: dateOnly(admissionDate) } : {}) },
    });
    const enr = await tx.enrollment.findUnique({ where: { studentId_sessionId: { studentId: s.id, sessionId: session.id } } });
    if (enr && (sectionId || rollNo != null)) {
      const moving = !!sectionId && sectionId !== enr.sectionId;
      const target = sectionId ?? enr.sectionId;
      const newRoll = rollNo ?? (moving ? await nextRollNo(tx, target, session.id) : enr.rollNo);
      await tx.enrollment.update({ where: { id: enr.id }, data: { sectionId: target, rollNo: newRoll } });
    }
  }, TX);
  audit(req, 'student.update', 'Student', s.id);
  res.json({ ok: true });
});

studentProfileRouter.post('/:id/photo', can('students.manage'), upload.single('file'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const file = await storeUpload(req.file, a.sid, 'students', IMAGE_TYPES);
  await prisma.student.update({ where: { id: s.id }, data: { photoKey: file.key } });
  res.json({ photoUrl: await signedUrl(file.key) });
});

// ───────── Documents ─────────

studentProfileRouter.post('/:id/documents', can('students.manage'), upload.single('file'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const name = String(req.body?.name ?? '').trim().slice(0, 100) || req.file?.originalname || 'Document';
  const file = await storeUpload(req.file, a.sid, 'student-documents', DOC_TYPES);
  const doc = await prisma.studentDocument.create({
    data: { studentId: s.id, name, fileKey: file.key, contentType: file.contentType, size: file.size },
  });
  audit(req, 'student.document.add', 'Student', s.id, { name });
  res.status(201).json(doc);
});

studentProfileRouter.delete('/:id/documents/:docId', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const r = await prisma.studentDocument.deleteMany({ where: { id: str(req.params.docId), studentId: s.id } });
  if (!r.count) throw notFound('Document not found');
  res.json({ ok: true });
});

// ───────── Guardians ─────────

async function linkedGuardian(studentId: string, guardianId: string) {
  const link = await prisma.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId } }, include: { guardian: true } });
  if (!link) throw notFound('Guardian not linked to this student');
  return link;
}

studentProfileRouter.put('/:id/guardians/:guardianId', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const { guardian } = await linkedGuardian(s.id, str(req.params.guardianId));
  const input = parse(studentGuardianUpdateSchema, req.body);
  await prisma.$transaction(async (tx) => {
    if (guardian.userId && input.phone !== guardian.phone) {
      const clash = await tx.user.findUnique({ where: { phone: input.phone } });
      if (clash && clash.id !== guardian.userId) throw conflict('Another login already uses this mobile number');
      await tx.user.update({ where: { id: guardian.userId }, data: { phone: input.phone, name: input.name } });
    }
    await tx.guardian.update({ where: { id: guardian.id }, data: input });
  }, TX);
  audit(req, 'guardian.update', 'Guardian', guardian.id);
  res.json({ ok: true });
});

studentProfileRouter.post('/:id/guardians', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const input = parse(admissionGuardianSchema, req.body);
  if (!input.phone) throw badRequest('Enter the mobile number');
  const result = await prisma.$transaction(async (tx) => {
    const r = await ensureGuardian(tx, a.sid, { ...input, phone: input.phone }, input.isPrimary);
    if (input.isPrimary) await tx.studentGuardian.updateMany({ where: { studentId: s.id }, data: { isPrimary: false } });
    await tx.studentGuardian.upsert({
      where: { studentId_guardianId: { studentId: s.id, guardianId: r.guardian.id } },
      create: { studentId: s.id, guardianId: r.guardian.id, isPrimary: input.isPrimary },
      update: { isPrimary: input.isPrimary },
    });
    return r;
  }, TX);
  res.status(201).json({ parentLogin: result.loginCreated ? { username: input.phone, initialPassword: input.phone } : null });
});

studentProfileRouter.post('/:id/guardians/:guardianId/primary', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const { guardian } = await linkedGuardian(s.id, str(req.params.guardianId));
  const result = await prisma.$transaction(async (tx) => {
    await tx.studentGuardian.updateMany({ where: { studentId: s.id }, data: { isPrimary: false } });
    await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId: s.id, guardianId: guardian.id } }, data: { isPrimary: true } });
    return ensureGuardian(tx, a.sid, { ...guardian, relation: guardian.relation }, true);
  }, TX);
  res.json({ parentLogin: result.loginCreated ? { username: guardian.phone, initialPassword: guardian.phone } : null });
});

studentProfileRouter.delete('/:id/guardians/:guardianId', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const link = await linkedGuardian(s.id, str(req.params.guardianId));
  if (link.isPrimary) throw badRequest('Make another guardian primary first');
  await prisma.studentGuardian.delete({ where: { studentId_guardianId: { studentId: s.id, guardianId: link.guardianId } } });
  res.json({ ok: true });
});

// ───────── Status ─────────

studentProfileRouter.post('/:id/leave', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const input = parse(studentLeaveSchema, req.body);
  await prisma.student.update({ where: { id: s.id }, data: { status: input.status, leftDate: dateOnly(input.leftDate), leftReason: input.leftReason } });
  audit(req, 'student.leave', 'Student', s.id, input);
  res.json({ ok: true });
});

studentProfileRouter.post('/:id/reactivate', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const s = await studentFor(a, str(req.params.id));
  const input = parse(studentReactivateSchema, req.body ?? {});
  const session = await currentSession(a.sid);
  await prisma.$transaction(async (tx) => {
    const enr = await tx.enrollment.findUnique({ where: { studentId_sessionId: { studentId: s.id, sessionId: session.id } } });
    if (!enr) {
      if (!input.sectionId) throw badRequest('Choose a class for this session');
      await sectionOfSchool(input.sectionId, a.sid);
      await tx.enrollment.create({
        data: { studentId: s.id, sessionId: session.id, sectionId: input.sectionId, rollNo: input.rollNo ?? (await nextRollNo(tx, input.sectionId, session.id)) },
      });
    }
    await tx.student.update({ where: { id: s.id }, data: { status: 'ACTIVE', leftDate: null, leftReason: null } });
  }, TX);
  audit(req, 'student.reactivate', 'Student', s.id);
  res.json({ ok: true });
});

