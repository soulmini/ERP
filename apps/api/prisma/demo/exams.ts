/**
 * Demo exams: default grade scale; "Half Yearly" (Sep–Oct 2026, results published, marks for 5-A and 3-A
 * including co-scholastic grades and a few remarks); "Annual" (Mar 2027, date sheet only).
 * Idempotent — a second run creates nothing.
 */
import { DEFAULT_GRADE_SCALE } from '@erp/shared';
import { prisma } from '../../src/db';
import { dateOnly } from '../../src/lib/dates';

/** Exam days (Sundays skipped) for the date sheet. */
function examDays(from: string, n: number) {
  const out: string[] = [];
  const d = dateOnly(from);
  while (out.length < n) {
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Small subjects are marked out of 50. */
const maxOf = (subject: string) => (['GK', 'Computer', 'Drawing', 'Rhymes & Stories', 'Sanskrit'].includes(subject) ? 50 : 100);

/** Deterministic 0..1 from a string (so re-seeding a fresh DB gives the same marks). */
function rand(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

async function createExamWithDateSheet(schoolId: string, sessionId: string, name: string, order: number, start: string, published: boolean) {
  const classes = await prisma.class.findMany({
    where: { schoolId },
    orderBy: { order: 'asc' },
    include: { subjects: { include: { subject: true } } },
  });
  const maxSubjects = Math.max(...classes.map((c) => c.subjects.length), 1);
  const days = examDays(start, maxSubjects);
  const exam = await prisma.exam.create({
    data: {
      schoolId,
      sessionId,
      name,
      order,
      startDate: dateOnly(days[0]),
      endDate: dateOnly(days[days.length - 1]),
      resultPublished: published,
    },
  });
  const fixedOrder = ['Hindi', 'English', 'Mathematics', 'Science', 'EVS', 'Social Science', 'Sanskrit', 'Computer', 'GK', 'Rhymes & Stories', 'Drawing'];
  await prisma.examSchedule.createMany({
    data: classes.flatMap((c) => {
      const subs = [...c.subjects].sort((x, y) => {
        const ix = fixedOrder.indexOf(x.subject.name);
        const iy = fixedOrder.indexOf(y.subject.name);
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
      });
      const junior = ['Nursery', 'LKG', 'UKG'].includes(c.name);
      return subs.map((cs, i) => {
        const max = maxOf(cs.subject.name);
        return {
          examId: exam.id,
          classId: c.id,
          subjectId: cs.subjectId,
          date: dateOnly(days[i]),
          startTime: junior ? '09:00' : '08:30',
          endTime: junior ? '10:30' : '11:30',
          maxMarks: max,
          passMarks: max === 50 ? 17 : 33,
        };
      });
    }),
  });
  return exam;
}

const REMARKS = [
  'Excellent performance. Keep it up!',
  'Good effort. Needs to focus more on Mathematics.',
  'Regular and attentive in class. Can do even better.',
  'Very good in languages. Practise handwriting daily.',
  'Must improve attendance and complete homework on time.',
];

export async function seedDemoExams(schoolId: string) {
  const session = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
  if (!session) return;

  // Grade scale
  if (!(await prisma.gradeScale.count({ where: { schoolId } }))) {
    await prisma.gradeScale.createMany({ data: DEFAULT_GRADE_SCALE.map((g) => ({ ...g, schoolId })), skipDuplicates: true });
  }

  // Annual: date sheet only
  if (!(await prisma.exam.findFirst({ where: { sessionId: session.id, name: 'Annual' } }))) {
    await createExamWithDateSheet(schoolId, session.id, 'Annual', 2, '2027-03-02', false);
  }

  // Half Yearly: date sheet + marks for 5-A & 3-A + remarks, results published
  if (await prisma.exam.findFirst({ where: { sessionId: session.id, name: 'Half Yearly' } })) return;
  const exam = await createExamWithDateSheet(schoolId, session.id, 'Half Yearly', 1, '2026-09-21', true);

  const sections = await prisma.section.findMany({
    where: { class: { schoolId, name: { in: ['5', '3'] } }, name: 'A' },
    include: { class: true },
  });
  const schedules = await prisma.examSchedule.findMany({ where: { examId: exam.id }, include: { subject: true } });
  const marks: { scheduleId: string; studentId: string; marks: number | null; grade: string | null; isAbsent: boolean; enteredById: string | null }[] = [];
  const remarks: { examId: string; studentId: string; remark: string }[] = [];
  for (const section of sections) {
    const roster = await prisma.enrollment.findMany({
      where: { sectionId: section.id, sessionId: session.id, student: { status: 'ACTIVE' } },
      orderBy: { rollNo: 'asc' },
    });
    for (const [i, e] of roster.entries()) {
      const ability = 0.45 + rand(`${e.studentId}:ability`) * 0.5; // 45%–95%
      for (const s of schedules.filter((x) => x.classId === section.classId)) {
        const base = { scheduleId: s.id, studentId: e.studentId, enteredById: section.classTeacherId };
        if (s.subject.type === 'CO_SCHOLASTIC') {
          const g = ['A1', 'A2', 'B1', 'B2'][Math.floor(rand(`${e.studentId}:${s.subjectId}`) * 4)];
          marks.push({ ...base, marks: null, grade: g, isAbsent: false });
          continue;
        }
        // One absentee and one weak paper per section, for realistic results.
        if (i === roster.length - 1 && s.subject.name === 'GK') {
          marks.push({ ...base, marks: null, grade: null, isAbsent: true });
          continue;
        }
        let pct = ability + (rand(`${e.studentId}:${s.subjectId}`) - 0.5) * 0.24;
        if (i === roster.length - 2 && s.subject.name === 'Mathematics') pct = 0.27;
        pct = Math.min(1, Math.max(0.15, pct));
        marks.push({ ...base, marks: Math.round(pct * s.maxMarks * 2) / 2, grade: null, isAbsent: false });
      }
      if (i < REMARKS.length) remarks.push({ examId: exam.id, studentId: e.studentId, remark: REMARKS[(i + section.class.order) % REMARKS.length] });
    }
  }
  await prisma.mark.createMany({ data: marks, skipDuplicates: true });
  await prisma.examRemark.createMany({ data: remarks, skipDuplicates: true });
}
