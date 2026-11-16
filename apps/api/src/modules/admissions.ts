import { Router } from 'express';
import {
  admissionSchema,
  enquirySchema,
  studentImportRowSchema,
  studentImportSchema,
  studentPassOutSchema,
  studentPromotionSchema,
  type StudentImportRow,
} from '@erp/shared';
import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import { badRequest, notFound, optStr, parse, str } from '../lib/http';
import { dateOnly, toDateStr, todayStr } from '../lib/dates';
import { audit } from '../lib/audit';
import { authOf, can } from '../middleware/auth';
import { currentSession, sectionOfSchool } from './academic';
import { assertAdmissionNoFree, ensureGuardian, fullName, nextAdmissionNo, nextRollNo } from './student-records';

/** Admissions: enquiries, full admission form, promotion, pass-out, CSV import. */
export const admissionsRouter = Router();

const TX = { timeout: 60_000, maxWait: 15_000 };

// ───────── Enquiries ─────────

admissionsRouter.get('/enquiries', can('students.view', 'students.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const status = optStr(req.query.status);
  const search = optStr(req.query.search)?.trim();
  const rows = await prisma.enquiry.findMany({
    where: {
      schoolId: sid,
      ...(status ? { status: status as Prisma.EnquiryWhereInput['status'] } : {}),
      ...(search
        ? { OR: [{ studentName: { contains: search, mode: 'insensitive' } }, { guardianName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
    include: { class: { select: { id: true, name: true } }, student: { select: { id: true, admissionNo: true } } },
  });
  const today = todayStr();
  res.json(
    rows.map((e) => ({
      ...e,
      dob: e.dob ? toDateStr(e.dob) : null,
      followUpDate: e.followUpDate ? toDateStr(e.followUpDate) : null,
      followUpDue: !!e.followUpDate && toDateStr(e.followUpDate) <= today && (e.status === 'NEW' || e.status === 'FOLLOW_UP'),
    })),
  );
});

function enquiryData(input: ReturnType<typeof enquirySchema.parse>) {
  return {
    studentName: input.studentName,
    gender: input.gender ?? null,
    dob: input.dob ? dateOnly(input.dob) : null,
    classId: input.classId ?? null,
    guardianName: input.guardianName,
    phone: input.phone,
    email: input.email ?? null,
    address: input.address ?? null,
    source: input.source ?? null,
    notes: input.notes ?? null,
    followUpDate: input.followUpDate ? dateOnly(input.followUpDate) : null,
    ...(input.status ? { status: input.status } : {}),
  };
}

async function assertClass(schoolId: string, classId: string | null | undefined) {
  if (classId && !(await prisma.class.findFirst({ where: { id: classId, schoolId } }))) throw badRequest('Unknown class');
}

admissionsRouter.post('/enquiries', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(enquirySchema, req.body);
  await assertClass(a.sid, input.classId);
  const e = await prisma.enquiry.create({ data: { ...enquiryData(input), schoolId: a.sid, createdById: a.sub } });
  audit(req, 'enquiry.create', 'Enquiry', e.id);
  res.status(201).json(e);
});

admissionsRouter.put('/enquiries/:id', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(enquirySchema, req.body);
  await assertClass(a.sid, input.classId);
  const existing = await prisma.enquiry.findFirst({ where: { id: str(req.params.id), schoolId: a.sid } });
  if (!existing) throw notFound('Enquiry not found');
  const data = enquiryData(input);
  if (existing.status === 'CONVERTED') delete (data as { status?: string }).status;
  await prisma.enquiry.update({ where: { id: existing.id }, data });
  res.json({ ok: true });
});

admissionsRouter.delete('/enquiries/:id', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const r = await prisma.enquiry.deleteMany({ where: { id: str(req.params.id), schoolId: a.sid } });
  if (!r.count) throw notFound('Enquiry not found');
  res.json({ ok: true });
});

// ───────── Full admission ─────────

/** Next admission number preview (not reserved). */
admissionsRouter.get('/next-number', can('students.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const session = await currentSession(sid);
  const year = session.name.slice(0, 4);
  const counter = await prisma.counter.findUnique({ where: { schoolId_key: { schoolId: sid, key: `admission:${session.name}` } } });
  const rows = counter ? [] : await prisma.student.findMany({ where: { schoolId: sid, admissionNo: { startsWith: `${year}/` } }, select: { admissionNo: true } });
  const base = counter?.value ?? rows.reduce((m, r) => Math.max(m, Number(r.admissionNo.slice(5)) || 0), 0);
  res.json({ admissionNo: `${year}/${String(base + 1).padStart(4, '0')}` });
});

admissionsRouter.post('/admit', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(admissionSchema, req.body);
  const session = await currentSession(a.sid);
  await sectionOfSchool(input.sectionId, a.sid);
  const enquiry = input.enquiryId ? await prisma.enquiry.findFirst({ where: { id: input.enquiryId, schoolId: a.sid } }) : null;
  if (input.enquiryId && !enquiry) throw badRequest('Enquiry not found');
  if (enquiry?.studentId) throw badRequest('This enquiry is already converted to an admission');
  const primaryPhone = input.guardians.find((g) => g.isPrimary)!.phone!;

  const result = await prisma.$transaction(async (tx) => {
    const admissionNo = input.admissionNo ?? (await nextAdmissionNo(tx, a.sid, session.name));
    await assertAdmissionNoFree(tx, a.sid, admissionNo);
    const rollNo = input.rollNo ?? (await nextRollNo(tx, input.sectionId, session.id));
    const links: { guardianId: string; isPrimary: boolean }[] = [];
    let loginCreated = false;
    for (const g of input.guardians) {
      const r = await ensureGuardian(tx, a.sid, { ...g, phone: g.phone ?? primaryPhone }, g.isPrimary);
      if (!links.some((l) => l.guardianId === r.guardian.id)) links.push({ guardianId: r.guardian.id, isPrimary: g.isPrimary });
      loginCreated ||= r.loginCreated;
    }
    const { sectionId: _s, rollNo: _r, admissionNo: _a, enquiryId: _e, guardians: _g, dob, admissionDate, ...profile } = input;
    const student = await tx.student.create({
      data: {
        ...profile,
        schoolId: a.sid,
        admissionNo,
        dob: dateOnly(dob),
        admissionDate: dateOnly(admissionDate ?? todayStr()),
        nationality: profile.nationality ?? 'Indian',
        guardians: { create: links },
        enrollments: { create: { sessionId: session.id, sectionId: input.sectionId, rollNo } },
      },
    });
    if (enquiry) await tx.enquiry.update({ where: { id: enquiry.id }, data: { status: 'CONVERTED', studentId: student.id } });
    return { student, loginCreated };
  }, TX);

  audit(req, 'student.admit', 'Student', result.student.id, { admissionNo: result.student.admissionNo });
  res.status(201).json({
    id: result.student.id,
    admissionNo: result.student.admissionNo,
    name: fullName(result.student),
    parentLogin: result.loginCreated ? { username: primaryPhone, initialPassword: primaryPhone } : null,
  });
});

// ───────── Promotion & pass-out ─────────

/** Students of a section (current session) and whether they already have a class in the target session. */
admissionsRouter.get('/promote/students', can('students.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const section = await sectionOfSchool(str(req.query.sectionId, 'sectionId'), sid);
  const session = await currentSession(sid);
  const target = optStr(req.query.targetSessionId);
  const rows = await prisma.enrollment.findMany({
    where: { sectionId: section.id, sessionId: session.id, student: { status: 'ACTIVE' } },
    orderBy: { rollNo: 'asc' },
    include: { student: { include: { enrollments: target ? { where: { sessionId: target }, include: { section: { include: { class: true } } } } : false } } },
  });
  res.json(
    rows.map((e) => {
      const t = (e.student as typeof e.student & { enrollments?: { section: { name: string; class: { name: string } } }[] }).enrollments?.[0];
      return {
        studentId: e.studentId,
        name: fullName(e.student),
        admissionNo: e.student.admissionNo,
        rollNo: e.rollNo,
        alreadyIn: t ? `${t.section.class.name}-${t.section.name}` : null,
      };
    }),
  );
});

admissionsRouter.post('/promote', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(studentPromotionSchema, req.body);
  const session = await currentSession(a.sid);
  const target = await prisma.academicSession.findFirst({ where: { id: input.targetSessionId, schoolId: a.sid } });
  if (!target) throw badRequest('Target session not found');
  if (target.id === session.id) throw badRequest('Choose a different session to promote into');
  await sectionOfSchool(input.sourceSectionId, a.sid);
  await sectionOfSchool(input.targetSectionId, a.sid);

  const result = await prisma.$transaction(async (tx) => {
    const source = await tx.enrollment.findMany({
      where: { sectionId: input.sourceSectionId, sessionId: session.id, studentId: { in: input.studentIds }, student: { status: 'ACTIVE' } },
      include: { student: true },
    });
    const already = new Set(
      (await tx.enrollment.findMany({ where: { sessionId: target.id, studentId: { in: source.map((s) => s.studentId) } }, select: { studentId: true } })).map(
        (e) => e.studentId,
      ),
    );
    const todo = source.filter((s) => !already.has(s.studentId));
    const taken = new Set(
      (await tx.enrollment.findMany({ where: { sectionId: input.targetSectionId, sessionId: target.id }, select: { rollNo: true } })).map((e) => e.rollNo),
    );
    let next = Math.max(0, ...[...taken].map((r) => r ?? 0)) + 1;
    const ordered = input.rollMode === 'ALPHA' ? [...todo].sort((x, y) => fullName(x.student).localeCompare(fullName(y.student))) : todo;
    const data = ordered.map((s) => {
      let rollNo: number;
      if (input.rollMode === 'KEEP' && s.rollNo && !taken.has(s.rollNo)) rollNo = s.rollNo;
      else rollNo = next++;
      taken.add(rollNo);
      return { studentId: s.studentId, sessionId: target.id, sectionId: input.targetSectionId, rollNo };
    });
    await tx.enrollment.createMany({ data });
    return { promoted: data.length, skipped: source.length - data.length };
  }, TX);
  audit(req, 'students.promote', 'Section', input.targetSectionId, { ...result, targetSession: target.name });
  res.json(result);
});

admissionsRouter.post('/pass-out', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(studentPassOutSchema, req.body);
  const session = await currentSession(a.sid);
  await sectionOfSchool(input.sourceSectionId, a.sid);
  const r = await prisma.student.updateMany({
    where: {
      schoolId: a.sid,
      id: { in: input.studentIds },
      status: 'ACTIVE',
      enrollments: { some: { sectionId: input.sourceSectionId, sessionId: session.id } },
    },
    data: { status: 'PASSED_OUT', leftDate: dateOnly(input.date), leftReason: input.reason ?? 'Passed out' },
  });
  audit(req, 'students.passOut', 'Section', input.sourceSectionId, { count: r.count });
  res.json({ passedOut: r.count });
});

// ───────── CSV import ─────────

type CheckedRow = { line: number; ok: boolean; errors: string[]; data?: StudentImportRow & { sectionId: string; classLabel: string } };

async function checkRows(schoolId: string, rows: { line: number; data: Record<string, string | null | undefined> }[]) {
  const classes = await prisma.class.findMany({ where: { schoolId }, include: { sections: true } });
  const norm = (s: string) => s.trim().toUpperCase().replace(/^CLASS\s+/, '');
  const existingAdm = new Set(
    (await prisma.student.findMany({ where: { schoolId }, select: { admissionNo: true } })).map((s) => s.admissionNo.toUpperCase()),
  );
  const seenAdm = new Set<string>();
  const seenKey = new Set<string>();
  return rows.map<CheckedRow>((r) => {
    const parsed = studentImportRowSchema.safeParse(r.data);
    if (!parsed.success) return { line: r.line, ok: false, errors: parsed.error.issues.map((i) => i.message) };
    const d = parsed.data;
    const errors: string[] = [];
    const cls = classes.find((c) => norm(c.name) === norm(d.class));
    const section = cls ? (d.section ? cls.sections.find((s) => s.name.toUpperCase() === d.section) : cls.sections.length === 1 ? cls.sections[0] : undefined) : undefined;
    if (!cls) errors.push(`Unknown class "${d.class}"`);
    else if (!section) errors.push(d.section ? `Class ${cls.name} has no section "${d.section}"` : `Class ${cls.name} has several sections — fill the section column`);
    if (d.admissionNo) {
      const k = d.admissionNo.toUpperCase();
      if (existingAdm.has(k)) errors.push(`Admission no. ${d.admissionNo} already exists`);
      if (seenAdm.has(k)) errors.push(`Admission no. ${d.admissionNo} appears twice in the file`);
      seenAdm.add(k);
    }
    const key = `${d.firstName.toLowerCase()}|${(d.lastName ?? '').toLowerCase()}|${d.dob}|${d.guardianPhone}`;
    if (seenKey.has(key)) errors.push('Same student appears twice in the file');
    seenKey.add(key);
    return errors.length
      ? { line: r.line, ok: false, errors }
      : { line: r.line, ok: true, errors: [], data: { ...d, sectionId: section!.id, classLabel: `${cls!.name}-${section!.name}` } };
  });
}

admissionsRouter.post('/import', can('students.manage'), async (req, res) => {
  const a = authOf(req);
  const { rows } = parse(studentImportSchema, req.body);
  const checked = await checkRows(a.sid, rows);
  const valid = checked.filter((c) => c.ok);
  if (req.query.dryRun === '1') return res.json({ rows: checked, valid: valid.length, invalid: checked.length - valid.length });
  if (!valid.length) throw badRequest('No valid rows to import');
  const session = await currentSession(a.sid);

  let created = 0;
  let logins = 0;
  // Batches keep each transaction short on a remote database.
  for (let i = 0; i < valid.length; i += 25) {
    const batch = valid.slice(i, i + 25);
    await prisma.$transaction(async (tx) => {
      for (const { data: d } of batch) {
        const g = await ensureGuardian(tx, a.sid, { name: d!.guardianName, relation: d!.guardianRelation, phone: d!.guardianPhone, address: d!.address }, true);
        const admissionNo = d!.admissionNo ?? (await nextAdmissionNo(tx, a.sid, session.name));
        await assertAdmissionNoFree(tx, a.sid, admissionNo);
        await tx.student.create({
          data: {
            schoolId: a.sid,
            admissionNo,
            firstName: d!.firstName,
            lastName: d!.lastName,
            gender: d!.gender,
            dob: dateOnly(d!.dob),
            address: d!.address,
            guardians: { create: { guardianId: g.guardian.id, isPrimary: true } },
            enrollments: { create: { sessionId: session.id, sectionId: d!.sectionId, rollNo: d!.rollNo ?? (await nextRollNo(tx, d!.sectionId, session.id)) } },
          },
        });
        created++;
        if (g.loginCreated) logins++;
      }
    }, TX);
  }
  audit(req, 'students.import', 'Student', undefined, { created, logins });
  res.json({ created, parentLogins: logins, skipped: checked.length - valid.length });
});
