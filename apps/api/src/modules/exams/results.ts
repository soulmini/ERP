import { gradeForPercent, type ExamResultStatus, type GradeBand } from '@erp/shared';
import { prisma } from '../../db';
import { byDateSheetOrder, d2s, fullName, round2 } from './common';

export interface ResultSubject {
  scheduleId: string;
  subjectId: string;
  name: string;
  type: 'SCHOLASTIC' | 'CO_SCHOLASTIC';
  maxMarks: number;
  passMarks: number;
  date: string | null;
}

export interface MarkCell {
  marks: number | null;
  grade: string | null;
  isAbsent: boolean;
}

export interface StudentResult {
  studentId: string;
  rollNo: number | null;
  admissionNo: string;
  name: string;
  /** keyed by subjectId; null = not entered yet */
  marks: Record<string, MarkCell | null>;
  total: number;
  maxTotal: number;
  percent: number | null;
  grade: string | null;
  rank: number | null;
  result: ExamResultStatus;
  failedSubjects: string[];
  pendingSubjects: number;
}

/**
 * Class result for one exam & section.
 * Total / percentage use scholastic subjects only; absent counts as 0.
 * Fails if below pass marks in any scholastic subject. Rank is dense by total.
 */
export async function sectionResults(
  exam: { id: string; sessionId: string },
  section: { id: string; classId: string },
  scale: GradeBand[],
) {
  const [schedules, enrollments] = await Promise.all([
    prisma.examSchedule.findMany({ where: { examId: exam.id, classId: section.classId }, include: { subject: true } }),
    prisma.enrollment.findMany({
      where: { sectionId: section.id, sessionId: exam.sessionId, student: { status: 'ACTIVE' } },
      orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
      include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
    }),
  ]);
  schedules.sort((a, b) => {
    if (a.subject.type !== b.subject.type) return a.subject.type === 'SCHOLASTIC' ? -1 : 1;
    return byDateSheetOrder(a, b);
  });
  const marks = schedules.length && enrollments.length
    ? await prisma.mark.findMany({
        where: { scheduleId: { in: schedules.map((s) => s.id) }, studentId: { in: enrollments.map((e) => e.studentId) } },
      })
    : [];
  const markOf = new Map(marks.map((m) => [`${m.scheduleId}:${m.studentId}`, m]));

  const subjects: ResultSubject[] = schedules.map((s) => ({
    scheduleId: s.id,
    subjectId: s.subjectId,
    name: s.subject.name,
    type: s.subject.type,
    maxMarks: s.maxMarks,
    passMarks: s.passMarks,
    date: d2s(s.date),
  }));
  const scholastic = subjects.filter((s) => s.type === 'SCHOLASTIC');

  const students: StudentResult[] = enrollments.map((e) => {
    const cells: Record<string, MarkCell | null> = {};
    let total = 0;
    let maxTotal = 0;
    let pending = 0;
    const failed: string[] = [];
    for (const s of subjects) {
      const m = markOf.get(`${s.scheduleId}:${e.studentId}`);
      const entered = !!m && (m.isAbsent || m.marks != null || m.grade != null);
      cells[s.subjectId] = entered ? { marks: m!.marks, grade: m!.grade, isAbsent: m!.isAbsent } : null;
      if (s.type !== 'SCHOLASTIC') continue;
      maxTotal += s.maxMarks;
      if (!entered || (!m!.isAbsent && m!.marks == null)) {
        pending++;
        continue;
      }
      const got = m!.isAbsent ? 0 : m!.marks!;
      total += got;
      if (got < s.passMarks) failed.push(s.name);
      cells[s.subjectId]!.grade = gradeForPercent((got / s.maxMarks) * 100, scale);
    }
    const percent = maxTotal ? round2((total / maxTotal) * 100) : null;
    return {
      studentId: e.studentId,
      rollNo: e.rollNo,
      admissionNo: e.student.admissionNo,
      name: fullName(e.student),
      marks: cells,
      total: round2(total),
      maxTotal,
      percent,
      grade: gradeForPercent(percent, scale),
      rank: null,
      result: failed.length ? 'FAIL' : pending ? 'PENDING' : 'PASS',
      failedSubjects: failed,
      pendingSubjects: pending,
    };
  });

  // Dense ranking by total (equal totals share a rank).
  if (scholastic.length) {
    const distinct = [...new Set(students.map((s) => s.total))].sort((x, y) => y - x);
    for (const s of students) s.rank = distinct.indexOf(s.total) + 1;
  }

  const hasMarks = marks.some((m) => m.isAbsent || m.marks != null || m.grade != null);
  return { subjects, students, hasMarks };
}

export type SectionResults = Awaited<ReturnType<typeof sectionResults>>;

/** Pass %, averages, toppers and per-subject statistics for the result sheet. */
export function resultHighlights({ subjects, students }: SectionResults) {
  const decided = students.filter((s) => s.result !== 'PENDING');
  const passed = students.filter((s) => s.result === 'PASS').length;
  const failed = students.filter((s) => s.result === 'FAIL').length;
  const withPercent = students.filter((s) => s.percent != null && s.pendingSubjects < subjects.filter((x) => x.type === 'SCHOLASTIC').length);
  const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((n, x) => n + x, 0) / xs.length) : null);
  const toppers = students
    .filter((s) => s.rank === 1 && s.total > 0)
    .map((s) => ({ studentId: s.studentId, name: s.name, total: s.total, percent: s.percent }));
  const gradeCounts: Record<string, number> = {};
  for (const s of withPercent) if (s.grade) gradeCounts[s.grade] = (gradeCounts[s.grade] ?? 0) + 1;

  return {
    students: students.length,
    passed,
    failed,
    pending: students.length - decided.length,
    passPercent: decided.length ? round2((passed / decided.length) * 100) : null,
    classAverage: avg(withPercent.map((s) => s.percent!)),
    toppers,
    gradeCounts,
    subjects: subjects.map((sub) => {
      const cells = students.map((s) => s.marks[sub.subjectId]).filter((c): c is MarkCell => !!c);
      if (sub.type === 'CO_SCHOLASTIC') {
        const grades: Record<string, number> = {};
        for (const c of cells) if (c.grade) grades[c.grade] = (grades[c.grade] ?? 0) + 1;
        return { subjectId: sub.subjectId, name: sub.name, type: sub.type, entered: cells.length, grades };
      }
      const scores = cells.map((c) => (c.isAbsent ? 0 : c.marks ?? 0));
      return {
        subjectId: sub.subjectId,
        name: sub.name,
        type: sub.type,
        maxMarks: sub.maxMarks,
        entered: cells.length,
        absent: cells.filter((c) => c.isAbsent).length,
        average: avg(scores),
        highest: scores.length ? Math.max(...scores) : null,
        lowest: scores.length ? Math.min(...scores) : null,
        passed: scores.filter((x) => x >= sub.passMarks).length,
        failed: scores.filter((x) => x < sub.passMarks).length,
      };
    }),
  };
}

/**
 * Attendance for the session: working days = days attendance was taken for the section (holidays excluded);
 * present = present + late + ½ × half days.
 */
export async function sessionAttendance(sessionId: string, sectionId: string, studentIds: string[]) {
  const [sectionDays, mine] = await Promise.all([
    prisma.studentAttendance.findMany({
      where: { sessionId, sectionId, status: { not: 'HOLIDAY' } },
      distinct: ['date'],
      select: { date: true },
    }),
    prisma.studentAttendance.groupBy({
      by: ['studentId', 'status'],
      where: { sessionId, studentId: { in: studentIds } },
      _count: true,
    }),
  ]);
  const workingDays = sectionDays.length;
  const out = new Map<string, { workingDays: number; present: number; percent: number | null }>();
  for (const id of studentIds) {
    const rows = mine.filter((r) => r.studentId === id);
    const n = (st: string) => rows.find((r) => r.status === st)?._count ?? 0;
    const present = n('PRESENT') + n('LATE') + n('HALF_DAY') * 0.5;
    out.set(id, { workingDays, present, percent: workingDays ? round2((present / workingDays) * 100) : null });
  }
  return out;
}
