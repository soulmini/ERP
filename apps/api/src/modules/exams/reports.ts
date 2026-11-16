import type { Router } from 'express';
import { prisma } from '../../db';
import { badRequest, forbidden, notFound, optStr, str } from '../../lib/http';
import type { AuthPayload } from '../../lib/tokens';
import { signedUrl } from '../../lib/storage';
import { authOf, hasPerm, requireKind } from '../../middleware/auth';
import { sectionOfSchool } from '../academic';
import {
  EXAM_ORDER,
  assertMyChild,
  byDateSheetOrder,
  canPrintAdmitCards,
  d2s,
  examOfSchool,
  fullName,
  gradeScaleOf,
  parentNames,
  resultsSection,
  type ExamWithSession,
} from './common';
import { examJson, staffOnly } from './setup';
import { resultHighlights, sessionAttendance, sectionResults, type MarkCell } from './results';

const isParent = (a: AuthPayload) => a.view === 'parent' || (!a.staffId && !!a.guardianId);

/** Section (of the exam's session) a student is enrolled in. */
async function enrollmentOf(studentId: string, sessionId: string, schoolId: string) {
  const e = await prisma.enrollment.findFirst({
    where: { studentId, sessionId, student: { schoolId } },
    include: { section: { include: { class: true } } },
  });
  if (!e) throw notFound('This student is not enrolled in this session');
  return e;
}

/** Printable student details (photo, parents, DOB) for a set of students. */
async function studentDetails(studentIds: string[], schoolId: string) {
  const rows = await prisma.student.findMany({
    where: { id: { in: studentIds }, schoolId },
    include: { guardians: { include: { guardian: { select: { name: true, relation: true } } } } },
  });
  const out = new Map<
    string,
    { dob: string | null; gender: string; photoUrl: string | null; fatherName: string | null; motherName: string | null; guardianName: string | null }
  >();
  await Promise.all(
    rows.map(async (s) => {
      out.set(s.id, {
        dob: d2s(s.dob),
        gender: s.gender,
        photoUrl: await signedUrl(s.photoKey).catch(() => null),
        ...parentNames(s.guardians),
      });
    }),
  );
  return out;
}

const classTeacherName = async (classTeacherId: string | null) => {
  if (!classTeacherId) return null;
  const t = await prisma.staff.findUnique({ where: { id: classTeacherId }, select: { firstName: true, lastName: true } });
  return t ? fullName(t) : null;
};

/**
 * Resolve who the report card / admit card is for.
 * Parents: ?studentId= of their own child. Staff: ?sectionId= (whole section) or ?studentId=.
 */
async function resolveTarget(a: AuthPayload, exam: ExamWithSession, q: Record<string, unknown>) {
  const studentId = optStr(q.studentId);
  const sectionId = optStr(q.sectionId);
  if (isParent(a)) {
    if (!studentId) throw badRequest('Missing studentId');
    await assertMyChild(a, studentId);
    const e = await enrollmentOf(studentId, exam.sessionId, a.sid);
    return { parent: true, section: e.section, studentId };
  }
  if (!a.staffId && !a.kinds.includes('PRINCIPAL')) throw forbidden();
  if (studentId) {
    const e = await enrollmentOf(studentId, exam.sessionId, a.sid);
    return { parent: false, section: e.section, studentId };
  }
  if (!sectionId) throw badRequest('Choose a class');
  return { parent: false, section: await sectionOfSchool(sectionId, a.sid), studentId: null as string | null };
}

export function registerReportRoutes(r: Router) {
  // ───────── Parent: exams & date sheets of a child ─────────
  r.get('/child/:studentId', requireKind('PARENT'), async (req, res) => {
    const a = authOf(req);
    const studentId = str(req.params.studentId);
    await assertMyChild(a, studentId);
    const session = await prisma.academicSession.findFirst({ where: { schoolId: a.sid, isCurrent: true } });
    if (!session) return res.json({ session: null, exams: [] });
    const e = await prisma.enrollment.findFirst({
      where: { studentId, sessionId: session.id },
      include: { section: { include: { class: true } } },
    });
    if (!e) return res.json({ session: { id: session.id, name: session.name }, exams: [] });
    const exams = await prisma.exam.findMany({
      where: { schoolId: a.sid, sessionId: session.id },
      orderBy: EXAM_ORDER,
      include: { schedules: { where: { classId: e.section.classId }, include: { subject: true } } },
    });
    res.json({
      session: { id: session.id, name: session.name },
      classLabel: `${e.section.class.name}-${e.section.name}`,
      exams: exams
        .filter((x) => x.schedules.length || x.resultPublished)
        .map((x) => ({
          ...examJson(x),
          dateSheet: [...x.schedules].sort(byDateSheetOrder).map((s) => ({
            subjectId: s.subjectId,
            name: s.subject.name,
            type: s.subject.type,
            date: d2s(s.date),
            startTime: s.startTime,
            endTime: s.endTime,
            maxMarks: s.maxMarks,
          })),
        })),
    });
  });

  // ───────── Result sheet of a section ─────────
  r.get('/:id/results', staffOnly, async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const section = await resultsSection(a, str(req.query.sectionId, 'sectionId'));
    const scale = await gradeScaleOf(a.sid);
    const results = await sectionResults(exam, section, scale);
    res.json({
      exam: examJson(exam),
      session: { id: exam.session.id, name: exam.session.name },
      section: { id: section.id, label: `${section.class.name}-${section.name}` },
      classTeacher: await classTeacherName(section.classTeacherId),
      canManage: hasPerm(a, 'exams.manage'),
      scale,
      ...results,
      highlights: resultHighlights(results),
    });
  });

  // ───────── Report cards (one student or a whole section) ─────────
  r.get('/:id/report-cards', async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const t = await resolveTarget(a, exam, req.query);
    if (t.parent) {
      if (!exam.resultPublished) throw forbidden(`${exam.name} results are not published yet`);
    } else {
      await resultsSection(a, t.section.id);
    }
    // Column groups: this exam, or (cumulative=1) every exam of the session up to this one.
    const cumulative = optStr(req.query.cumulative) === '1';
    const sessionExams = await prisma.exam.findMany({ where: { sessionId: exam.sessionId, schoolId: a.sid }, orderBy: EXAM_ORDER });
    const idx = sessionExams.findIndex((x) => x.id === exam.id);
    let groupExams = cumulative ? sessionExams.slice(0, idx + 1) : [exam];
    if (t.parent) groupExams = groupExams.filter((x) => x.resultPublished);

    const scale = await gradeScaleOf(a.sid);
    const groups = await Promise.all(groupExams.map((x) => sectionResults(x, t.section, scale)));
    const main = groups[groupExams.findIndex((x) => x.id === exam.id)];
    const students = t.studentId ? main.students.filter((s) => s.studentId === t.studentId) : main.students;
    if (t.studentId && !students.length) throw notFound('This student is not in this class');

    // Subjects across all groups (scholastic first, in the main exam's date sheet order).
    const subjects: { subjectId: string; name: string; type: 'SCHOLASTIC' | 'CO_SCHOLASTIC' }[] = [];
    for (const g of [main, ...groups]) {
      for (const s of g.subjects) {
        if (!subjects.some((x) => x.subjectId === s.subjectId)) subjects.push({ subjectId: s.subjectId, name: s.name, type: s.type });
      }
    }
    subjects.sort((x, y) => (x.type === y.type ? 0 : x.type === 'SCHOLASTIC' ? -1 : 1));

    const ids = students.map((s) => s.studentId);
    const [details, attendance, remarks, classTeacher] = await Promise.all([
      studentDetails(ids, a.sid),
      sessionAttendance(exam.sessionId, t.section.id, ids),
      prisma.examRemark.findMany({ where: { examId: exam.id, studentId: { in: ids } } }),
      classTeacherName(t.section.classTeacherId),
    ]);

    res.json({
      exam: examJson(exam),
      session: { id: exam.session.id, name: exam.session.name },
      section: { id: t.section.id, label: `${t.section.class.name}-${t.section.name}`, className: t.section.class.name },
      classTeacher,
      cumulative,
      scale,
      exams: groupExams.map((x, i) => ({
        ...examJson(x),
        subjects: Object.fromEntries(groups[i].subjects.map((s) => [s.subjectId, { maxMarks: s.maxMarks, passMarks: s.passMarks }])),
      })),
      subjects,
      cards: students.map((s) => {
        const d = details.get(s.studentId);
        return {
          studentId: s.studentId,
          name: s.name,
          rollNo: s.rollNo,
          admissionNo: s.admissionNo,
          dob: d?.dob ?? null,
          photoUrl: d?.photoUrl ?? null,
          fatherName: d?.fatherName ?? null,
          motherName: d?.motherName ?? null,
          guardianName: d?.guardianName ?? null,
          results: groupExams.map((x, i) => {
            const row = groups[i].students.find((z) => z.studentId === s.studentId);
            return {
              examId: x.id,
              marks: (row?.marks ?? {}) as Record<string, MarkCell | null>,
              total: row?.total ?? 0,
              maxTotal: row?.maxTotal ?? 0,
              percent: row?.percent ?? null,
              grade: row?.grade ?? null,
              rank: row?.rank ?? null,
              result: row?.result ?? 'PENDING',
              failedSubjects: row?.failedSubjects ?? [],
            };
          }),
          attendance: attendance.get(s.studentId) ?? null,
          remark: remarks.find((x) => x.studentId === s.studentId)?.remark ?? null,
        };
      }),
    });
  });

  // ───────── Admit cards ─────────
  r.get('/:id/admit-cards', async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const t = await resolveTarget(a, exam, req.query);
    if (!t.parent && !canPrintAdmitCards(a, t.section)) {
      throw forbidden('Only the class teacher of this section or the office can print admit cards');
    }
    const [schedules, enrollments] = await Promise.all([
      prisma.examSchedule.findMany({ where: { examId: exam.id, classId: t.section.classId }, include: { subject: true } }),
      prisma.enrollment.findMany({
        where: {
          sectionId: t.section.id,
          sessionId: exam.sessionId,
          student: { status: 'ACTIVE' },
          ...(t.studentId ? { studentId: t.studentId } : {}),
        },
        orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
        include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
      }),
    ]);
    if (!schedules.length) throw badRequest(`The ${exam.name} date sheet for Class ${t.section.class.name} is not ready yet`);
    const details = await studentDetails(
      enrollments.map((e) => e.studentId),
      a.sid,
    );
    res.json({
      exam: examJson(exam),
      session: { id: exam.session.id, name: exam.session.name },
      section: { id: t.section.id, label: `${t.section.class.name}-${t.section.name}` },
      dateSheet: schedules.sort(byDateSheetOrder).map((s) => ({
        subjectId: s.subjectId,
        name: s.subject.name,
        type: s.subject.type,
        date: d2s(s.date),
        startTime: s.startTime,
        endTime: s.endTime,
      })),
      cards: enrollments.map((e) => {
        const d = details.get(e.studentId);
        return {
          studentId: e.studentId,
          name: fullName(e.student),
          rollNo: e.rollNo,
          admissionNo: e.student.admissionNo,
          dob: d?.dob ?? null,
          photoUrl: d?.photoUrl ?? null,
          fatherName: d?.fatherName ?? d?.guardianName ?? null,
        };
      }),
    });
  });
}
