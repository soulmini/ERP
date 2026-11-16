import { classInWords, dateInWords, formatINR, type CertType } from '@erp/shared';
import { prisma } from '../../db';
import type { Prisma } from '../../generated/prisma/client';
import { toDateStr, todayStr } from '../../lib/dates';

/** Everything the certificate forms need about a student. */
export const certStudentInclude = {
  guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' } },
  enrollments: {
    include: { session: true, section: { include: { class: true } } },
    orderBy: { session: { startDate: 'desc' } },
  },
} satisfies Prisma.StudentInclude;

export type CertStudent = Prisma.StudentGetPayload<{ include: typeof certStudentInclude }>;

/** Load a student of this school (any status) with guardians and enrollments, newest first. */
export function loadCertStudent(id: string, schoolId: string) {
  return prisma.student.findFirst({ where: { id, schoolId }, include: certStudentInclude });
}

export const fullName = (p: { firstName: string; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ');

export const classLabelOf = (e: { section: { name: string; class: { name: string } } } | null | undefined) =>
  e ? `${e.section.class.name}-${e.section.name}` : null;

/** Father's / mother's names from guardians (a GUARDIAN stands in for the father if no parent is linked). */
export function parentsOf(guardians: { guardian: { name: string; relation: string } }[]) {
  const gs = guardians.map((g) => g.guardian);
  const father = gs.find((g) => g.relation === 'FATHER')?.name;
  const mother = gs.find((g) => g.relation === 'MOTHER')?.name;
  const other = gs.find((g) => g.relation === 'GUARDIAN')?.name;
  return { father: father ?? (mother ? '' : (other ?? '')), mother: mother ?? '' };
}

/** "Month up to which fees are paid": last month of the unbroken run of fully paid monthly dues. */
function paidUpTo(dues: { period: string; label: string; status: string }[]): string {
  const months = new Map<string, { label: string; paid: boolean }>();
  for (const d of dues) {
    if (!/^\d{4}-\d{2}$/.test(d.period)) continue;
    const paid = d.status === 'PAID' || d.status === 'WAIVED';
    const cur = months.get(d.period);
    months.set(d.period, { label: d.label, paid: (cur?.paid ?? true) && paid });
  }
  let upTo = '';
  for (const [, m] of [...months.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!m.paid) break;
    upTo = m.label;
  }
  return upTo;
}

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Prefilled certificate fields (all strings, all editable in the form) from the student's records:
 * admission register, guardians, enrollments, attendance of the latest session, fee dues, concessions.
 */
export async function buildCertificateData(type: CertType, s: CertStudent, today = todayStr()): Promise<Record<string, string>> {
  const latest = s.enrollments[0];
  const first = s.enrollments[s.enrollments.length - 1];
  const parents = parentsOf(s.guardians);
  const dob = toDateStr(s.dob);
  const common = {
    studentName: fullName(s),
    gender: s.gender,
    fatherName: parents.father,
    motherName: parents.mother,
    admissionNo: s.admissionNo,
    srNo: s.srNo ?? '',
    className: classLabelOf(latest) ?? '',
    session: latest?.session.name ?? '',
    dob,
    dobWords: dateInWords(dob),
    issueDate: today,
    remarks: '',
  };

  if (type === 'DOB' || type === 'BONAFIDE') return { ...common, purpose: '' };
  if (type === 'CC') {
    return {
      ...common,
      studiedFrom: toDateStr(s.admissionDate),
      studiedTo: s.leftDate ? toDateStr(s.leftDate) : today,
      conduct: 'Good',
    };
  }

  // ── Transfer certificate ──
  const until = s.leftDate ? { lte: s.leftDate } : undefined;
  const [sectionDays, own, dues, concessions, subjects] = latest
    ? await Promise.all([
        prisma.studentAttendance.findMany({
          where: { schoolId: s.schoolId, sessionId: latest.sessionId, sectionId: latest.sectionId, status: { not: 'HOLIDAY' }, date: until },
          distinct: ['date'],
          select: { date: true },
        }),
        prisma.studentAttendance.findMany({
          where: { schoolId: s.schoolId, sessionId: latest.sessionId, studentId: s.id, date: until },
          select: { status: true },
        }),
        prisma.studentFeeDue.findMany({
          where: { schoolId: s.schoolId, sessionId: latest.sessionId, studentId: s.id },
          select: { period: true, label: true, status: true },
        }),
        prisma.concession.findMany({
          where: { schoolId: s.schoolId, sessionId: latest.sessionId, studentId: s.id },
          include: { feeHead: { select: { name: true } } },
        }),
        prisma.classSubject.findMany({
          where: { classId: latest.section.classId },
          include: { subject: true },
          orderBy: { subject: { name: 'asc' } },
        }),
      ])
    : [[], [], [], [], []];

  const present = own.reduce(
    (n, r) => n + (r.status === 'PRESENT' || r.status === 'LATE' ? 1 : r.status === 'HALF_DAY' ? 0.5 : 0),
    0,
  );
  const subjectNames = [
    ...subjects.filter((x) => x.subject.type === 'SCHOLASTIC'),
    ...subjects.filter((x) => x.subject.type !== 'SCHOLASTIC'),
  ].map((x) => x.subject.name);

  // Promotion from the previous enrollment implies the previous annual exam was passed.
  const prev = s.enrollments[1];
  const detained = !!(latest && prev && prev.section.classId === latest.section.classId);
  const lastExam =
    latest && prev
      ? `Annual Examination ${prev.session.name} (Class ${prev.section.class.name}) – ${detained ? 'Failed' : 'Passed'}`
      : '';
  const sessionOver = latest ? today > toDateStr(latest.session.endDate) : false;
  const lastClass = latest?.section.class.name ?? '';

  return {
    ...common,
    penNo: s.penNo ?? '',
    nationality: s.nationality || 'Indian',
    category: s.category ?? '',
    admissionDate: toDateStr(s.admissionDate),
    admissionClass: first?.section.class.name ?? '',
    lastClass,
    lastClassWords: classInWords(lastClass),
    lastExam,
    failedInClass: detained ? `Yes, once in Class ${prev!.section.class.name}` : 'No',
    subjects: subjectNames.join(', '),
    qualifiedForPromotion: sessionOver ? '' : 'N.A. (session in progress)',
    feesPaidUpTo: paidUpTo(dues),
    feeConcession: concessions.length
      ? concessions
          .map(
            (c) =>
              `${c.reason} (${c.percent != null ? `${c.percent}%` : formatINR(c.amount ?? 0)}${c.feeHead ? ` on ${c.feeHead.name}` : ''})`,
          )
          .join('; ')
      : 'No',
    workingDays: sectionDays.length ? String(sectionDays.length) : '',
    presentDays: sectionDays.length ? fmtDays(present) : '',
    nccScoutGuide: 'No',
    gamesActivities: '',
    conduct: 'Good',
    applicationDate: today,
    leavingReason: s.leftReason ?? '',
  };
}
