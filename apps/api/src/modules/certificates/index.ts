import { Router } from 'express';
import {
  CERT_DATA_SCHEMAS,
  CERT_TYPES,
  cancelCertificateSchema,
  certSerial,
  gatePassSchema,
  gatePassSerial,
  issueCertificateSchema,
  type CertType,
} from '@erp/shared';
import { prisma } from '../../db';
import type { Prisma } from '../../generated/prisma/client';
import { badRequest, conflict, notFound, optStr, parse, str } from '../../lib/http';
import { dateOnly, toDateStr, todayStr } from '../../lib/dates';
import { nextNumber } from '../../lib/counters';
import { signedUrl } from '../../lib/storage';
import { audit } from '../../lib/audit';
import { authOf, can } from '../../middleware/auth';
import { buildCertificateData, classLabelOf, fullName, loadCertStudent, parentsOf } from './prefill';
import { zonedDayRange, zonedInstant } from './time';

/** TC / CC / DOB / Bonafide certificates, I-cards, gate passes. */
export const certificatesRouter = Router();
certificatesRouter.use(can('certificates.issue'));

const certType = (v: unknown): CertType => {
  const t = String(v ?? '').toUpperCase();
  if (!(CERT_TYPES as readonly string[]).includes(t)) throw badRequest('Unknown certificate type');
  return t as CertType;
};

// ───────── Student search & prefill ─────────

certificatesRouter.get('/students', async (req, res) => {
  const { sid } = authOf(req);
  const search = optStr(req.query.search)?.trim();
  if (!search || search.length < 2) return res.json([]);
  const students = await prisma.student.findMany({
    where: {
      schoolId: sid,
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { admissionNo: { contains: search, mode: 'insensitive' } },
        { srNo: { contains: search, mode: 'insensitive' } },
      ],
    },
    take: 20,
    orderBy: { firstName: 'asc' },
    include: {
      enrollments: { include: { section: { include: { class: true } } }, orderBy: { session: { startDate: 'desc' } }, take: 1 },
      guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' } },
    },
  });
  res.json(
    students.map((s) => ({
      id: s.id,
      name: fullName(s),
      admissionNo: s.admissionNo,
      classLabel: classLabelOf(s.enrollments[0]),
      status: s.status,
      fatherName: parentsOf(s.guardians).father,
    })),
  );
});

certificatesRouter.get('/prefill/:type/:studentId', async (req, res) => {
  const { sid } = authOf(req);
  const type = certType(req.params.type);
  const s = await loadCertStudent(str(req.params.studentId), sid);
  if (!s) throw notFound('Student not found');
  const issued = await prisma.issuedCertificate.findMany({
    where: { studentId: s.id, type, cancelledAt: null },
    select: { id: true, serialNo: true, issueDate: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    student: { id: s.id, name: fullName(s), admissionNo: s.admissionNo, status: s.status, classLabel: classLabelOf(s.enrollments[0]) },
    alreadyIssued: issued.map((c) => ({ ...c, issueDate: toDateStr(c.issueDate) })),
    data: await buildCertificateData(type, s),
  });
});

// ───────── Issue / register / view / cancel ─────────

certificatesRouter.post('/', async (req, res) => {
  const a = authOf(req);
  const input = parse(issueCertificateSchema, req.body);
  const data = parse(CERT_DATA_SCHEMAS[input.type], input.data);
  const student = await prisma.student.findFirst({ where: { id: input.studentId, schoolId: a.sid } });
  if (!student) throw notFound('Student not found');
  const markLeft = input.type === 'TC' && student.status === 'ACTIVE';
  if (markLeft && !input.confirmLeft) {
    throw badRequest('Issuing a TC marks the student as LEFT. Please confirm.', { needsConfirm: true });
  }
  if (input.type === 'BONAFIDE' && student.status !== 'ACTIVE') {
    throw badRequest('A bonafide certificate can only be issued to a current student');
  }

  const cert = await prisma.$transaction(async (tx) => {
    const n = await nextNumber(tx, a.sid, `cert:${input.type}`);
    const created = await tx.issuedCertificate.create({
      data: {
        schoolId: a.sid,
        type: input.type,
        serialNo: certSerial(input.type, data.issueDate.slice(0, 4), n),
        studentId: student.id,
        issueDate: dateOnly(data.issueDate),
        data: { ...data, currentStudent: student.status === 'ACTIVE' && input.type !== 'TC' } as Prisma.InputJsonValue,
        issuedById: a.sub,
      },
    });
    if (markLeft) {
      const leavingReason = 'leavingReason' in data ? data.leavingReason : null;
      await tx.student.update({
        where: { id: student.id },
        data: { status: 'LEFT', leftDate: dateOnly(data.issueDate), leftReason: leavingReason },
      });
    }
    return created;
  });
  audit(req, 'certificate.issue', 'IssuedCertificate', cert.id, { type: cert.type, serialNo: cert.serialNo, studentId: student.id, markedLeft: markLeft });
  res.status(201).json({ id: cert.id, serialNo: cert.serialNo });
});

certificatesRouter.get('/', async (req, res) => {
  const { sid } = authOf(req);
  const type = optStr(req.query.type);
  const from = optStr(req.query.from);
  const to = optStr(req.query.to);
  const search = optStr(req.query.search)?.trim();
  const certs = await prisma.issuedCertificate.findMany({
    where: {
      schoolId: sid,
      ...(type ? { type: certType(type) } : {}),
      ...(from || to ? { issueDate: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lte: dateOnly(to) } : {}) } } : {}),
      ...(search
        ? {
            OR: [
              { serialNo: { contains: search, mode: 'insensitive' } },
              { student: { firstName: { contains: search, mode: 'insensitive' } } },
              { student: { lastName: { contains: search, mode: 'insensitive' } } },
              { student: { admissionNo: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    include: { student: { select: { firstName: true, lastName: true, admissionNo: true } }, issuedBy: { select: { name: true } } },
  });
  res.json(
    certs.map((c) => ({
      id: c.id,
      type: c.type,
      serialNo: c.serialNo,
      issueDate: toDateStr(c.issueDate),
      student: { name: fullName(c.student), admissionNo: c.student.admissionNo },
      className: (c.data as { className?: string })?.className ?? null,
      issuedBy: c.issuedBy?.name ?? null,
      cancelledAt: c.cancelledAt,
      cancelReason: c.cancelReason,
    })),
  );
});

certificatesRouter.get('/view/:id', async (req, res) => {
  const { sid } = authOf(req);
  const c = await prisma.issuedCertificate.findFirst({
    where: { id: str(req.params.id), schoolId: sid },
    include: { issuedBy: { select: { name: true } }, student: { select: { photoKey: true } } },
  });
  if (!c) throw notFound('Certificate not found');
  res.json({
    id: c.id,
    type: c.type,
    serialNo: c.serialNo,
    issueDate: toDateStr(c.issueDate),
    data: c.data,
    issuedBy: c.issuedBy?.name ?? null,
    cancelledAt: c.cancelledAt,
    cancelReason: c.cancelReason,
    photoUrl: await signedUrl(c.student.photoKey),
  });
});

certificatesRouter.post('/view/:id/cancel', async (req, res) => {
  const a = authOf(req);
  const input = parse(cancelCertificateSchema, req.body);
  const c = await prisma.issuedCertificate.findFirst({ where: { id: str(req.params.id), schoolId: a.sid } });
  if (!c) throw notFound('Certificate not found');
  if (c.cancelledAt) throw conflict('Already cancelled');
  await prisma.$transaction(async (tx) => {
    await tx.issuedCertificate.update({ where: { id: c.id }, data: { cancelledAt: new Date(), cancelReason: input.reason } });
    if (c.type === 'TC' && input.restoreStudent) {
      await tx.student.update({ where: { id: c.studentId }, data: { status: 'ACTIVE', leftDate: null, leftReason: null } });
    }
  });
  audit(req, 'certificate.cancel', 'IssuedCertificate', c.id, { reason: input.reason, restoreStudent: !!input.restoreStudent });
  res.json({ ok: true });
});

// ───────── I-cards ─────────

certificatesRouter.get('/id-cards/students', async (req, res) => {
  const { sid } = authOf(req);
  const sectionId = optStr(req.query.sectionId);
  const ids = optStr(req.query.ids)?.split(',').filter(Boolean);
  if (!sectionId && !ids?.length) throw badRequest('Choose a class or students');
  const session = await prisma.academicSession.findFirst({ where: { schoolId: sid, isCurrent: true } });
  if (!session) throw badRequest('No current session');
  const enrollments = await prisma.enrollment.findMany({
    where: {
      sessionId: session.id,
      student: { schoolId: sid, status: 'ACTIVE' },
      ...(sectionId ? { sectionId } : {}),
      ...(ids?.length ? { studentId: { in: ids } } : {}),
    },
    orderBy: [{ section: { class: { order: 'asc' } } }, { rollNo: 'asc' }],
    include: {
      section: { include: { class: true } },
      student: { include: { guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' } } } },
    },
  });
  res.json({
    session: session.name,
    cards: await Promise.all(
      enrollments.map(async (e) => {
        const s = e.student;
        const g = s.guardians[0]?.guardian;
        return {
          id: s.id,
          name: fullName(s),
          classLabel: classLabelOf(e),
          rollNo: e.rollNo,
          admissionNo: s.admissionNo,
          dob: toDateStr(s.dob),
          bloodGroup: s.bloodGroup,
          fatherName: parentsOf(s.guardians).father || g?.name || '',
          phone: g?.phone ?? s.phone ?? '',
          address: [s.address, s.city].filter(Boolean).join(', '),
          photoUrl: await signedUrl(s.photoKey),
        };
      }),
    ),
  });
});

certificatesRouter.get('/id-cards/staff', async (req, res) => {
  const { sid } = authOf(req);
  const staff = await prisma.staff.findMany({ where: { schoolId: sid, isActive: true }, orderBy: { employeeCode: 'asc' } });
  const session = await prisma.academicSession.findFirst({ where: { schoolId: sid, isCurrent: true } });
  res.json({
    session: session?.name ?? '',
    cards: await Promise.all(
      staff.map(async (s) => ({
        id: s.id,
        name: fullName(s),
        designation: s.designation,
        employeeCode: s.employeeCode,
        phone: s.phone,
        address: s.address,
        photoUrl: await signedUrl(s.photoKey),
      })),
    ),
  });
});

// ───────── Gate pass ─────────

const passInclude = {
  student: {
    select: {
      firstName: true,
      lastName: true,
      admissionNo: true,
      enrollments: { include: { section: { include: { class: true } } }, orderBy: { session: { startDate: 'desc' } }, take: 1 },
    },
  },
} as const satisfies Prisma.GatePassInclude;

const passOut = (p: Prisma.GatePassGetPayload<{ include: typeof passInclude }>) => ({
  id: p.id,
  serialNo: p.serialNo,
  kind: p.studentId ? 'STUDENT' : 'VISITOR',
  student: p.student ? { name: fullName(p.student), admissionNo: p.student.admissionNo, classLabel: classLabelOf(p.student.enrollments[0]) } : null,
  visitorName: p.visitorName,
  personName: p.personName,
  relation: p.relation,
  phone: p.phone,
  reason: p.reason,
  outTime: p.outTime,
  returnTime: p.returnTime,
});

certificatesRouter.get('/gate-passes', async (req, res) => {
  const { sid } = authOf(req);
  const date = optStr(req.query.date) ?? todayStr();
  const { from, to } = zonedDayRange(date);
  const passes = await prisma.gatePass.findMany({
    where: { schoolId: sid, outTime: { gte: from, lt: to } },
    orderBy: { outTime: 'desc' },
    include: passInclude,
  });
  res.json(passes.map(passOut));
});

certificatesRouter.get('/gate-passes/:id', async (req, res) => {
  const { sid } = authOf(req);
  const p = await prisma.gatePass.findFirst({ where: { id: str(req.params.id), schoolId: sid }, include: passInclude });
  if (!p) throw notFound('Gate pass not found');
  res.json(passOut(p));
});

certificatesRouter.post('/gate-passes', async (req, res) => {
  const a = authOf(req);
  const input = parse(gatePassSchema, req.body);
  if (input.kind === 'STUDENT') {
    const s = await prisma.student.findFirst({ where: { id: input.studentId, schoolId: a.sid, status: 'ACTIVE' } });
    if (!s) throw notFound('Student not found');
  }
  const outTime = input.outTime ? zonedInstant(todayStr(), input.outTime) : new Date();
  const pass = await prisma.$transaction(async (tx) => {
    const n = await nextNumber(tx, a.sid, 'gatepass');
    return tx.gatePass.create({
      data:
        input.kind === 'STUDENT'
          ? {
              schoolId: a.sid,
              serialNo: gatePassSerial(n),
              studentId: input.studentId,
              personName: input.personName,
              relation: input.relation,
              phone: input.phone,
              reason: input.reason,
              outTime,
              issuedById: a.sub,
            }
          : {
              schoolId: a.sid,
              serialNo: gatePassSerial(n),
              visitorName: input.visitorName,
              personName: input.whomToMeet, // whom the visitor meets
              phone: input.phone,
              reason: input.reason,
              outTime,
              issuedById: a.sub,
            },
      include: passInclude,
    });
  });
  audit(req, 'gatepass.issue', 'GatePass', pass.id, { serialNo: pass.serialNo });
  res.status(201).json(passOut(pass));
});

certificatesRouter.post('/gate-passes/:id/return', async (req, res) => {
  const { sid } = authOf(req);
  const r = await prisma.gatePass.updateMany({ where: { id: str(req.params.id), schoolId: sid, returnTime: null }, data: { returnTime: new Date() } });
  if (!r.count) throw badRequest('Gate pass not found or already returned');
  res.json({ ok: true });
});
