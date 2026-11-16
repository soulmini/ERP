/** Demo data: periods, time tables for 5-A & 3-A, homework, notices, holidays. Idempotent. */
import { prisma } from '../../src/db';

const PERIODS = [
  ['Period 1', '08:00', '08:40', false],
  ['Period 2', '08:40', '09:20', false],
  ['Period 3', '09:20', '10:00', false],
  ['Period 4', '10:00', '10:40', false],
  ['Lunch', '10:40', '11:10', true],
  ['Period 5', '11:10', '11:50', false],
  ['Period 6', '11:50', '12:30', false],
  ['Period 7', '12:30', '13:10', false],
  ['Period 8', '13:10', '13:50', false],
] as const;

const HOLIDAYS: [string, string, string?][] = [
  ['Independence Day', '2026-08-15'],
  ['Janmashtami', '2026-09-04'],
  ['Gandhi Jayanti', '2026-10-02'],
  ['Dussehra', '2026-10-20'],
  ['Diwali', '2026-11-07', '2026-11-08'],
  ['Guru Nanak Jayanti', '2026-11-24'],
  ['Winter vacation', '2026-12-25', '2027-01-05'],
  ['Republic Day', '2027-01-26'],
  ['Holi', '2027-03-22', '2027-03-23'],
];

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const daysAgo = (n: number) => {
  const t = d(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  return new Date(t.getTime() - n * 86_400_000);
};

export async function seedDemoCommunication(schoolId: string) {
  const session = await prisma.academicSession.findFirstOrThrow({ where: { schoolId, isCurrent: true } });

  // Periods
  if (!(await prisma.period.count({ where: { schoolId } }))) {
    await prisma.period.createMany({
      data: PERIODS.map(([name, startTime, endTime, isBreak], order) => ({ schoolId, name, startTime, endTime, isBreak, order })),
    });
  }
  const periods = (await prisma.period.findMany({ where: { schoolId, isBreak: false }, orderBy: { order: 'asc' } })).slice(0, 8);

  // Class teachers teach their class's subjects; time table for each class-teacher section.
  const sections = await prisma.section.findMany({
    where: { class: { schoolId }, classTeacherId: { not: null } },
    include: { class: { include: { subjects: { include: { subject: true } } } } },
  });
  for (const [si, s] of sections.entries()) {
    await prisma.classSubject.updateMany({ where: { classId: s.classId, teacherId: null }, data: { teacherId: s.classTeacherId } });
    if (await prisma.timetableSlot.count({ where: { sectionId: s.id, sessionId: session.id } })) continue;
    const subjects = s.class.subjects.map((cs) => cs.subject).sort((a, b) => a.name.localeCompare(b.name));
    if (!subjects.length) continue;
    await prisma.timetableSlot.createMany({
      data: [1, 2, 3, 4, 5, 6].flatMap((day) =>
        periods.map((p, pi) => ({
          schoolId,
          sessionId: session.id,
          sectionId: s.id,
          periodId: p.id,
          day,
          subjectId: subjects[(day + pi + si) % subjects.length].id,
          teacherId: s.classTeacherId,
        })),
      ),
    });
  }

  // Homework
  const hw: [string, string, string, number, number?][] = [
    ['5', 'Mathematics', 'Learn tables 12 to 15', 0, 2],
    ['5', 'English', 'Write 10 sentences on "My School"', 1, 3],
    ['5', 'EVS', 'Draw and label the water cycle', 2, 4],
    ['3', 'Hindi', 'पाठ 5 के प्रश्न-उत्तर याद करें', 0, 1],
    ['3', 'Mathematics', 'Exercise 4.2 — all questions', 1, 3],
  ];
  for (const s of sections) {
    const user = await prisma.staff.findUnique({ where: { id: s.classTeacherId! }, select: { userId: true } });
    for (const [cls, subjectName, title, ago, due] of hw.filter((h) => h[0] === s.class.name)) {
      if (await prisma.homework.findFirst({ where: { sectionId: s.id, title } })) continue;
      const subject = s.class.subjects.find((cs) => cs.subject.name === subjectName)?.subject;
      await prisma.homework.create({
        data: {
          schoolId,
          sessionId: session.id,
          sectionId: s.id,
          subjectId: subject?.id ?? null,
          title,
          description: cls === '5' ? 'Complete in your homework notebook. Parents please check and sign.' : null,
          assignedDate: daysAgo(ago),
          dueDate: due ? new Date(daysAgo(ago).getTime() + due * 86_400_000) : null,
          createdById: user?.userId ?? null,
        },
      });
    }
  }

  // Notices
  const principal = await prisma.user.findFirst({ where: { schoolId, roles: { some: { role: { kind: 'PRINCIPAL' } } } } });
  const notices = [
    {
      title: 'Winter vacation from 25 December',
      body: 'The school will remain closed for winter vacation from 25 December 2026 to 5 January 2027.\nClasses resume on Wednesday, 6 January 2027.',
      audience: 'ALL' as const,
      pinned: true,
    },
    {
      title: 'Parent–teacher meeting on Saturday, 21 November',
      body: 'Dear parents, a parent–teacher meeting will be held on Saturday, 21 November from 9:00 am to 12:00 noon.\nPlease meet the class teacher to discuss your ward’s progress in the half-yearly exams.',
      audience: 'PARENTS' as const,
      pinned: false,
    },
    {
      title: 'Staff meeting after school on Friday',
      body: 'All teachers are requested to attend a short meeting in the staff room on Friday at 2:15 pm regarding annual exam planning.',
      audience: 'STAFF' as const,
      pinned: false,
    },
  ];
  for (const [i, n] of notices.entries()) {
    if (await prisma.notice.findFirst({ where: { schoolId, title: n.title } })) continue;
    await prisma.notice.create({ data: { ...n, schoolId, createdById: principal?.id ?? null, publishedAt: daysAgo(i) } });
  }

  // Holidays
  for (const [name, date, endDate] of HOLIDAYS) {
    if (await prisma.holiday.findFirst({ where: { schoolId, name, date: d(date) } })) continue;
    await prisma.holiday.create({ data: { schoolId, sessionId: session.id, name, date: d(date), endDate: endDate ? d(endDate) : null } });
  }
}
