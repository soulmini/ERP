import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { studentQuickSchema } from '@erp/shared';
import { prisma } from '../db';
import { conflict, notFound, optStr, parse, str } from '../lib/http';
import { dateOnly } from '../lib/dates';
import { signedUrl } from '../lib/storage';
import { audit } from '../lib/audit';
import { authOf, can } from '../middleware/auth';
import { currentSession, sectionOfSchool } from './academic';
import { studentProfileRouter } from './student-profile';

export const studentsRouter = Router();

studentsRouter.get('/', can('students.view'), async (req, res) => {
  const { sid } = authOf(req);
  const session = await currentSession(sid);
  const sectionId = optStr(req.query.sectionId);
  const classId = optStr(req.query.classId);
  const search = optStr(req.query.search)?.trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 50));

  const where = {
    schoolId: sid,
    status: 'ACTIVE' as const,
    enrollments: {
      some: {
        sessionId: session.id,
        ...(sectionId ? { sectionId } : {}),
        ...(classId ? { section: { classId } } : {}),
      },
    },
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
            { admissionNo: { contains: search, mode: 'insensitive' as const } },
            { guardians: { some: { guardian: { phone: { contains: search } } } } },
          ],
        }
      : {}),
  };
  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: [{ firstName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        enrollments: {
          where: { sessionId: session.id },
          include: { section: { include: { class: true } } },
        },
        guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' }, take: 1 },
      },
    }),
  ]);
  res.json({
    total,
    page,
    pageSize,
    items: await Promise.all(
      students.map(async (s) => {
        const e = s.enrollments[0];
        const g = s.guardians[0]?.guardian;
        return {
          id: s.id,
          admissionNo: s.admissionNo,
          name: [s.firstName, s.lastName].filter(Boolean).join(' '),
          gender: s.gender,
          dob: s.dob,
          photoUrl: await signedUrl(s.photoKey),
          classLabel: e ? `${e.section.class.name}-${e.section.name}` : null,
          sectionId: e?.sectionId ?? null,
          rollNo: e?.rollNo ?? null,
          guardian: g ? { name: g.name, phone: g.phone, relation: g.relation } : null,
        };
      }),
    ),
  });
});

/**
 * Quick admission: student + enrollment in current session + guardian + parent login.
 * Parent logs in with their mobile number; initial password = mobile number.
 */
studentsRouter.post('/', can('students.manage'), async (req, res) => {
  const { sid } = authOf(req);
  const input = parse(studentQuickSchema, req.body);
  const session = await currentSession(sid);
  await sectionOfSchool(input.sectionId, sid);

  const result = await prisma.$transaction(async (tx) => {
    let admissionNo = input.admissionNo;
    if (!admissionNo) {
      const count = await tx.student.count({ where: { schoolId: sid } });
      admissionNo = `${session.name.slice(0, 4)}/${String(count + 1).padStart(4, '0')}`;
    }
    if (await tx.student.findUnique({ where: { schoolId_admissionNo: { schoolId: sid, admissionNo } } })) {
      throw conflict(`Admission no. ${admissionNo} already exists`);
    }

    let rollNo = input.rollNo;
    if (!rollNo) {
      const max = await tx.enrollment.aggregate({
        where: { sectionId: input.sectionId, sessionId: session.id },
        _max: { rollNo: true },
      });
      rollNo = (max._max.rollNo ?? 0) + 1;
    }

    // Reuse guardian (siblings) by phone, else create guardian + parent login.
    let guardian = await tx.guardian.findFirst({ where: { schoolId: sid, phone: input.guardianPhone } });
    let parentLoginCreated = false;
    if (!guardian) {
      const parentRole = await tx.role.findFirstOrThrow({ where: { schoolId: sid, kind: 'PARENT' } });
      const existingUser = await tx.user.findUnique({ where: { phone: input.guardianPhone } });
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            schoolId: sid,
            name: input.guardianName,
            phone: input.guardianPhone,
            passwordHash: await bcrypt.hash(input.guardianPhone, 10),
            roles: { create: { roleId: parentRole.id } },
          },
        }));
      if (existingUser) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: parentRole.id } },
          create: { userId: user.id, roleId: parentRole.id },
          update: {},
        });
      }
      parentLoginCreated = !existingUser;
      guardian = await tx.guardian.create({
        data: {
          schoolId: sid,
          name: input.guardianName,
          relation: input.guardianRelation,
          phone: input.guardianPhone,
          // A staff member who is also a parent keeps one login; link only if free.
          userId: (await tx.guardian.findUnique({ where: { userId: user.id } })) ? null : user.id,
        },
      });
    }

    const student = await tx.student.create({
      data: {
        schoolId: sid,
        admissionNo,
        firstName: input.firstName,
        lastName: input.lastName,
        gender: input.gender,
        dob: dateOnly(input.dob),
        address: input.address,
        guardians: { create: { guardianId: guardian.id, isPrimary: true } },
        enrollments: { create: { sessionId: session.id, sectionId: input.sectionId, rollNo } },
      },
    });
    return { student, parentLoginCreated };
  });

  audit(req, 'student.create', 'Student', result.student.id);
  res.status(201).json({
    ...result.student,
    parentLogin: result.parentLoginCreated
      ? { username: input.guardianPhone, initialPassword: input.guardianPhone }
      : null,
  });
});

// Profile, documents, guardians, status (GET/PUT /:id …) live in student-profile.ts.
studentsRouter.use(studentProfileRouter);
