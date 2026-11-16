import { Router } from 'express';
import { markStaffAttendanceSchema, markStudentAttendanceSchema } from '@erp/shared';
import { prisma } from '../db';
import type { AttendanceStatus } from '../generated/prisma/enums';
import { badRequest, forbidden, optStr, parse, str } from '../lib/http';
import { currentMonthStr, dateOnly, daysBetween, monthRange, toDateStr, todayStr } from '../lib/dates';
import { audit } from '../lib/audit';
import type { AuthPayload } from '../lib/tokens';
import { authOf, can, hasPerm } from '../middleware/auth';
import { currentSession, sectionOfSchool } from './academic';
import { env } from '../env';
import { notifyAbsentees } from '../lib/sms';

export const attendanceRouter = Router();

/** Teachers may correct attendance for this many past days; admins any past day. */
const TEACHER_EDIT_DAYS = 3;
/** Staff checking in after this time (school timezone) are marked LATE. */
const STAFF_LATE_AFTER = process.env.STAFF_LATE_AFTER ?? '08:30';

const SHORT: Record<AttendanceStatus, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  LATE: 'L',
  HALF_DAY: 'H',
  LEAVE: 'LV',
  HOLIDAY: 'HO',
};

/** Admin-type users (Principal / staff role with attendance.mark) can mark any section. */
const marksAnySection = (a: AuthPayload) => a.view === 'admin' && hasPerm(a, 'attendance.mark');

async function assertCanMark(a: AuthPayload, sectionId: string) {
  const section = await sectionOfSchool(sectionId, a.sid);
  if (marksAnySection(a)) return section;
  if (hasPerm(a, 'attendance.mark') && a.staffId && section.classTeacherId === a.staffId) return section;
  throw forbidden('Only the class teacher of this section can mark attendance');
}

function assertEditableDate(a: AuthPayload, date: string) {
  const today = todayStr();
  const ago = daysBetween(date, today);
  if (ago < 0) throw badRequest('Cannot mark attendance for a future date');
  if (!marksAnySection(a) && ago > TEACHER_EDIT_DAYS) {
    throw forbidden(`Teachers can edit attendance only for the last ${TEACHER_EDIT_DAYS} days. Contact the Principal.`);
  }
}

function countByStatus(rows: { status: AttendanceStatus }[]) {
  const c: Record<string, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, LEAVE: 0, HOLIDAY: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

// ═════════════════════ Student attendance ═════════════════════

/** Sections this user can mark, with today's (or ?date=) marking status. */
attendanceRouter.get('/sections', can('attendance.mark', 'attendance.view'), async (req, res) => {
  const a = authOf(req);
  const date = optStr(req.query.date) ?? todayStr();
  const session = await currentSession(a.sid);
  const all = marksAnySection(a) || (a.view === 'admin' && hasPerm(a, 'attendance.view'));
  const sections = await prisma.section.findMany({
    where: { class: { schoolId: a.sid }, ...(all ? {} : { classTeacherId: a.staffId ?? '__none__' }) },
    orderBy: [{ class: { order: 'asc' } }, { name: 'asc' }],
    include: {
      class: { select: { name: true } },
      classTeacher: { select: { firstName: true, lastName: true } },
      _count: { select: { enrollments: { where: { sessionId: session.id } } } },
    },
  });
  const rows = await prisma.studentAttendance.groupBy({
    by: ['sectionId', 'status'],
    where: { schoolId: a.sid, date: dateOnly(date), sectionId: { in: sections.map((s) => s.id) } },
    _count: true,
  });
  res.json({
    date,
    sections: sections.map((s) => {
      const mine = rows.filter((r) => r.sectionId === s.id);
      const marked = mine.reduce((n, r) => n + r._count, 0);
      const get = (st: AttendanceStatus) => mine.find((r) => r.status === st)?._count ?? 0;
      return {
        id: s.id,
        label: `${s.class.name}-${s.name}`,
        classTeacher: s.classTeacher ? `${s.classTeacher.firstName} ${s.classTeacher.lastName ?? ''}`.trim() : null,
        isMine: s.classTeacherId === a.staffId,
        students: s._count.enrollments,
        marked,
        present: get('PRESENT') + get('LATE') + get('HALF_DAY'),
        absent: get('ABSENT'),
        leave: get('LEAVE'),
        canMark: marksAnySection(a) || (hasPerm(a, 'attendance.mark') && s.classTeacherId === a.staffId),
      };
    }),
  });
});

/** Roster for one section & date, with existing marks (null = not marked yet). */
attendanceRouter.get('/sections/:id', can('attendance.mark', 'attendance.view'), async (req, res) => {
  const a = authOf(req);
  const sectionId = str(req.params.id);
  const section = await sectionOfSchool(sectionId, a.sid);
  if (!(a.view === 'admin' || section.classTeacherId === a.staffId)) throw forbidden();
  const date = optStr(req.query.date) ?? todayStr();
  const session = await currentSession(a.sid);
  const [enrollments, marks] = await Promise.all([
    prisma.enrollment.findMany({
      where: { sectionId, sessionId: session.id, student: { status: 'ACTIVE' } },
      orderBy: [{ rollNo: 'asc' }],
      include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, gender: true } } },
    }),
    prisma.studentAttendance.findMany({
      where: { sectionId, date: dateOnly(date) },
      include: { markedBy: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const byStudent = new Map(marks.map((m) => [m.studentId, m]));
  const last = marks.sort((x, y) => +y.markedAt - +x.markedAt)[0];
  let editable = true;
  try {
    assertEditableDate(a, date);
    await assertCanMark(a, sectionId);
  } catch {
    editable = false;
  }
  res.json({
    date,
    section: { id: section.id, label: `${section.class.name}-${section.name}` },
    editable,
    markedAt: last?.markedAt ?? null,
    markedBy: last?.markedBy ? `${last.markedBy.firstName} ${last.markedBy.lastName ?? ''}`.trim() : null,
    summary: countByStatus(marks),
    students: enrollments.map((e) => {
      const m = byStudent.get(e.studentId);
      return {
        studentId: e.studentId,
        rollNo: e.rollNo,
        admissionNo: e.student.admissionNo,
        name: [e.student.firstName, e.student.lastName].filter(Boolean).join(' '),
        gender: e.student.gender,
        status: m?.status ?? null,
        remark: m?.remark ?? null,
      };
    }),
  });
});

/** Save attendance for a section & date (replaces existing marks for those students). */
attendanceRouter.put('/sections/:id', can('attendance.mark'), async (req, res) => {
  const a = authOf(req);
  const sectionId = str(req.params.id);
  const input = parse(markStudentAttendanceSchema, req.body);
  assertEditableDate(a, input.date);
  await assertCanMark(a, sectionId);
  const session = await currentSession(a.sid);
  const date = dateOnly(input.date);

  const enrolled = await prisma.enrollment.findMany({
    where: { sectionId, sessionId: session.id, studentId: { in: input.entries.map((e) => e.studentId) } },
    select: { studentId: true },
  });
  const valid = new Set(enrolled.map((e) => e.studentId));
  const invalid = input.entries.filter((e) => !valid.has(e.studentId));
  if (invalid.length) throw badRequest('Some students are not in this section', { studentIds: invalid.map((i) => i.studentId) });

  const ids = input.entries.map((e) => e.studentId);
  // Delete + insert in one batch: 2 round-trips for a whole class instead of one per student.
  await prisma.$transaction([
    prisma.studentAttendance.deleteMany({ where: { date, studentId: { in: ids } } }),
    prisma.studentAttendance.createMany({
      data: input.entries.map((e) => ({
        schoolId: a.sid,
        sessionId: session.id,
        sectionId,
        studentId: e.studentId,
        date,
        status: e.status,
        remark: e.remark || null,
        source: input.source,
        markedById: a.staffId,
      })),
    }),
  ]);
  const summary = countByStatus(input.entries);
  audit(req, 'attendance.mark', 'Section', sectionId, { date: input.date, source: input.source, summary });
  // Text parents of absent students (async; never slows or breaks the save).
  if (summary.ABSENT) void notifyAbsentees(a.sid, sectionId, input.date);
  res.json({ ok: true, date: input.date, summary });
});

/** Monthly register for a section: grid of days × students with totals. */
attendanceRouter.get('/sections/:id/report', can('attendance.view', 'attendance.mark'), async (req, res) => {
  const a = authOf(req);
  const sectionId = str(req.params.id);
  const section = await sectionOfSchool(sectionId, a.sid);
  if (!(a.view === 'admin' || section.classTeacherId === a.staffId)) throw forbidden();
  const month = optStr(req.query.month) ?? currentMonthStr();
  const { from, to, days } = monthRange(month);
  const session = await currentSession(a.sid);
  const [enrollments, marks] = await Promise.all([
    prisma.enrollment.findMany({
      where: { sectionId, sessionId: session.id },
      orderBy: { rollNo: 'asc' },
      include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    }),
    prisma.studentAttendance.findMany({ where: { sectionId, date: { gte: from, lt: to } } }),
  ]);
  const workingDays = [...new Set(marks.filter((m) => m.status !== 'HOLIDAY').map((m) => toDateStr(m.date)))].sort();
  res.json({
    month,
    days,
    section: { id: section.id, label: `${section.class.name}-${section.name}` },
    workingDays: workingDays.length,
    students: enrollments.map((e) => {
      const mine = marks.filter((m) => m.studentId === e.studentId);
      const grid: Record<number, string> = {};
      for (const m of mine) grid[m.date.getUTCDate()] = SHORT[m.status];
      const c = countByStatus(mine);
      const attended = c.PRESENT + c.LATE + c.HALF_DAY * 0.5;
      const counted = mine.filter((m) => m.status !== 'HOLIDAY').length;
      return {
        studentId: e.studentId,
        rollNo: e.rollNo,
        admissionNo: e.student.admissionNo,
        name: [e.student.firstName, e.student.lastName].filter(Boolean).join(' '),
        grid,
        totals: c,
        percent: counted ? Math.round((attended / counted) * 1000) / 10 : null,
      };
    }),
  });
});

// ═════════════════════ Staff attendance ═════════════════════

function nowHHMM() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: env.timezone, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** My own attendance: today's record + month list. */
attendanceRouter.get('/staff/me', async (req, res) => {
  const a = authOf(req);
  if (!a.staffId) throw forbidden('Only staff have staff attendance');
  const month = optStr(req.query.month) ?? currentMonthStr();
  const { from, to } = monthRange(month);
  const [today, records] = await Promise.all([
    prisma.staffAttendance.findUnique({ where: { staffId_date: { staffId: a.staffId, date: dateOnly(todayStr()) } } }),
    prisma.staffAttendance.findMany({
      where: { staffId: a.staffId, date: { gte: from, lt: to } },
      orderBy: { date: 'asc' },
    }),
  ]);
  res.json({ today, month, records, totals: countByStatus(records), lateAfter: STAFF_LATE_AFTER });
});

attendanceRouter.post('/staff/check-in', async (req, res) => {
  const a = authOf(req);
  if (!a.staffId) throw forbidden('Only staff can check in');
  const source = req.body?.source === 'APP' ? 'APP' : 'WEB';
  const date = dateOnly(todayStr());
  const existing = await prisma.staffAttendance.findUnique({ where: { staffId_date: { staffId: a.staffId, date } } });
  if (existing?.checkIn) throw badRequest('You have already checked in today');
  const status: AttendanceStatus = nowHHMM() > STAFF_LATE_AFTER ? 'LATE' : 'PRESENT';
  const row = await prisma.staffAttendance.upsert({
    where: { staffId_date: { staffId: a.staffId, date } },
    create: { schoolId: a.sid, staffId: a.staffId, date, status, checkIn: new Date(), source },
    update: { status, checkIn: new Date(), source },
  });
  res.json(row);
});

attendanceRouter.post('/staff/check-out', async (req, res) => {
  const a = authOf(req);
  if (!a.staffId) throw forbidden('Only staff can check out');
  const date = dateOnly(todayStr());
  const existing = await prisma.staffAttendance.findUnique({ where: { staffId_date: { staffId: a.staffId, date } } });
  if (!existing?.checkIn) throw badRequest('Check in first');
  if (existing.checkOut) throw badRequest('You have already checked out today');
  res.json(await prisma.staffAttendance.update({ where: { id: existing.id }, data: { checkOut: new Date() } }));
});

/** All staff with status for a date (Principal / admin). */
attendanceRouter.get('/staff', can('staff-attendance.manage'), async (req, res) => {
  const a = authOf(req);
  const date = optStr(req.query.date) ?? todayStr();
  const [staff, records] = await Promise.all([
    prisma.staff.findMany({
      where: { schoolId: a.sid, isActive: true },
      orderBy: { firstName: 'asc' },
      select: { id: true, firstName: true, lastName: true, designation: true, employeeCode: true },
    }),
    prisma.staffAttendance.findMany({ where: { schoolId: a.sid, date: dateOnly(date) } }),
  ]);
  const byStaff = new Map(records.map((r) => [r.staffId, r]));
  res.json({
    date,
    summary: countByStatus(records),
    staff: staff.map((s) => {
      const r = byStaff.get(s.id);
      return {
        staffId: s.id,
        name: `${s.firstName} ${s.lastName ?? ''}`.trim(),
        designation: s.designation,
        employeeCode: s.employeeCode,
        status: r?.status ?? null,
        checkIn: r?.checkIn ?? null,
        checkOut: r?.checkOut ?? null,
        source: r?.source ?? null,
        remark: r?.remark ?? null,
      };
    }),
  });
});

/** Principal marks / corrects staff attendance. Keeps any self check-in times. */
attendanceRouter.put('/staff', can('staff-attendance.manage'), async (req, res) => {
  const a = authOf(req);
  const input = parse(markStaffAttendanceSchema, req.body);
  if (daysBetween(input.date, todayStr()) < 0) throw badRequest('Cannot mark attendance for a future date');
  const date = dateOnly(input.date);
  const ids = input.entries.map((e) => e.staffId);
  const count = await prisma.staff.count({ where: { id: { in: ids }, schoolId: a.sid } });
  if (count !== ids.length) throw badRequest('Invalid staff in list');
  await prisma.$transaction(
    input.entries.map((e) =>
      prisma.staffAttendance.upsert({
        where: { staffId_date: { staffId: e.staffId, date } },
        create: { schoolId: a.sid, staffId: e.staffId, date, status: e.status, remark: e.remark, source: 'WEB', markedById: a.staffId },
        update: { status: e.status, remark: e.remark, markedById: a.staffId },
      }),
    ),
  );
  audit(req, 'staffAttendance.mark', 'StaffAttendance', undefined, { date: input.date, count: ids.length });
  res.json({ ok: true });
});

/** Monthly staff register. */
attendanceRouter.get('/staff/report', can('staff-attendance.manage'), async (req, res) => {
  const a = authOf(req);
  const month = optStr(req.query.month) ?? currentMonthStr();
  const { from, to, days } = monthRange(month);
  const [staff, records] = await Promise.all([
    prisma.staff.findMany({ where: { schoolId: a.sid, isActive: true }, orderBy: { firstName: 'asc' } }),
    prisma.staffAttendance.findMany({ where: { schoolId: a.sid, date: { gte: from, lt: to } } }),
  ]);
  res.json({
    month,
    days,
    staff: staff.map((s) => {
      const mine = records.filter((r) => r.staffId === s.id);
      const grid: Record<number, string> = {};
      for (const r of mine) grid[r.date.getUTCDate()] = SHORT[r.status];
      return {
        staffId: s.id,
        name: `${s.firstName} ${s.lastName ?? ''}`.trim(),
        designation: s.designation,
        grid,
        totals: countByStatus(mine),
      };
    }),
  });
});
