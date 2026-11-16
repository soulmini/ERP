import { Router } from 'express';
import { prisma } from '../db';
import { forbidden } from '../lib/http';
import { dateOnly, toDateStr, todayStr } from '../lib/dates';
import { authOf } from '../middleware/auth';
import { currentSession } from './academic';

export const dashboardRouter = Router();

/** Principal / admin overview. */
dashboardRouter.get('/admin', async (req, res) => {
  const a = authOf(req);
  if (a.view !== 'admin') throw forbidden();
  const session = await currentSession(a.sid);
  const today = dateOnly(todayStr());
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000);

  const [students, boys, staffCount, sections, todayStudent, todayStaff, week, classes] = await Promise.all([
    prisma.enrollment.count({ where: { sessionId: session.id, student: { status: 'ACTIVE' } } }),
    prisma.enrollment.count({ where: { sessionId: session.id, student: { status: 'ACTIVE', gender: 'MALE' } } }),
    prisma.staff.count({ where: { schoolId: a.sid, isActive: true } }),
    prisma.section.count({ where: { class: { schoolId: a.sid } } }),
    prisma.studentAttendance.groupBy({ by: ['status'], where: { schoolId: a.sid, date: today }, _count: true }),
    prisma.staffAttendance.groupBy({ by: ['status'], where: { schoolId: a.sid, date: today }, _count: true }),
    prisma.studentAttendance.groupBy({
      by: ['date', 'status'],
      where: { schoolId: a.sid, date: { gte: weekAgo, lte: today } },
      _count: true,
    }),
    prisma.class.findMany({
      where: { schoolId: a.sid },
      orderBy: { order: 'asc' },
      select: {
        name: true,
        sections: { select: { _count: { select: { enrollments: { where: { sessionId: session.id } } } } } },
      },
    }),
  ]);
  const markedSections = await prisma.studentAttendance.findMany({
    where: { schoolId: a.sid, date: today },
    distinct: ['sectionId'],
    select: { sectionId: true },
  });
  const pick = (rows: { status: string; _count: number }[], ...st: string[]) =>
    rows.filter((r) => st.includes(r.status)).reduce((n, r) => n + r._count, 0);

  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekAgo.getTime() + i * 86_400_000);
    const rows = week.filter((w) => w.date.getTime() === d.getTime());
    const total = pick(rows, 'PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE');
    const present = pick(rows, 'PRESENT', 'LATE', 'HALF_DAY');
    return { date: toDateStr(d), percent: total ? Math.round((present / total) * 1000) / 10 : null };
  });

  res.json({
    session: session.name,
    date: todayStr(),
    students: { total: students, boys, girls: students - boys },
    staff: {
      total: staffCount,
      present: pick(todayStaff, 'PRESENT', 'LATE', 'HALF_DAY'),
      late: pick(todayStaff, 'LATE'),
      absent: pick(todayStaff, 'ABSENT'),
      leave: pick(todayStaff, 'LEAVE'),
    },
    studentAttendance: {
      sectionsMarked: markedSections.length,
      sectionsTotal: sections,
      present: pick(todayStudent, 'PRESENT', 'LATE', 'HALF_DAY'),
      absent: pick(todayStudent, 'ABSENT'),
      leave: pick(todayStudent, 'LEAVE'),
    },
    trend,
    classStrength: classes.map((c) => ({
      name: c.name,
      students: c.sections.reduce((n, s) => n + s._count.enrollments, 0),
    })),
  });
});

/** Class teacher's home screen. */
dashboardRouter.get('/teacher', async (req, res) => {
  const a = authOf(req);
  if (!a.staffId) throw forbidden();
  const session = await currentSession(a.sid);
  const today = dateOnly(todayStr());
  const [mySections, myAttendance, subjects] = await Promise.all([
    prisma.section.findMany({
      where: { classTeacherId: a.staffId },
      include: {
        class: { select: { name: true } },
        _count: { select: { enrollments: { where: { sessionId: session.id } } } },
      },
    }),
    prisma.staffAttendance.findUnique({ where: { staffId_date: { staffId: a.staffId, date: today } } }),
    prisma.classSubject.findMany({
      where: { teacherId: a.staffId },
      include: { class: { select: { name: true } }, subject: { select: { name: true } } },
    }),
  ]);
  const marks = await prisma.studentAttendance.groupBy({
    by: ['sectionId', 'status'],
    where: { date: today, sectionId: { in: mySections.map((s) => s.id) } },
    _count: true,
  });
  res.json({
    date: todayStr(),
    myAttendance,
    sections: mySections.map((s) => {
      const rows = marks.filter((m) => m.sectionId === s.id);
      return {
        id: s.id,
        label: `${s.class.name}-${s.name}`,
        students: s._count.enrollments,
        marked: rows.reduce((n, r) => n + r._count, 0) > 0,
        present: rows.filter((r) => ['PRESENT', 'LATE', 'HALF_DAY'].includes(r.status)).reduce((n, r) => n + r._count, 0),
        absent: rows.filter((r) => r.status === 'ABSENT').reduce((n, r) => n + r._count, 0),
      };
    }),
    subjects: subjects.map((s) => ({ class: s.class.name, subject: s.subject.name })),
  });
});
