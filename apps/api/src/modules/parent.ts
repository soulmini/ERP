import { Router } from 'express';
import { prisma } from '../db';
import { forbidden, optStr, str } from '../lib/http';
import { currentMonthStr, dateOnly, monthRange, todayStr } from '../lib/dates';
import { signedUrl } from '../lib/storage';
import { authOf, requireKind } from '../middleware/auth';
import { currentSession } from './academic';

/** Parent / student portal: read-only views of their own children. */
export const parentRouter = Router();
parentRouter.use(requireKind('PARENT'));

async function assertMyChild(guardianId: string | null, studentId: string) {
  if (!guardianId) throw forbidden();
  const link = await prisma.studentGuardian.findUnique({
    where: { studentId_guardianId: { studentId, guardianId } },
  });
  if (!link) throw forbidden('This student is not linked to your account');
}

parentRouter.get('/children', async (req, res) => {
  const a = authOf(req);
  if (!a.guardianId) return res.json([]);
  const session = await currentSession(a.sid);
  const { from, to } = monthRange(currentMonthStr());
  const links = await prisma.studentGuardian.findMany({
    where: { guardianId: a.guardianId, student: { status: 'ACTIVE' } },
    include: {
      student: {
        include: {
          enrollments: {
            where: { sessionId: session.id },
            include: { section: { include: { class: true, classTeacher: true } } },
          },
          attendance: { where: { date: { gte: from, lt: to } }, select: { date: true, status: true } },
        },
      },
    },
  });
  const today = dateOnly(todayStr()).getTime();
  res.json(
    await Promise.all(
      links.map(async ({ student: s }) => {
        const e = s.enrollments[0];
        const counted = s.attendance.filter((x) => x.status !== 'HOLIDAY');
        const attended = counted.reduce(
          (n, x) => n + (x.status === 'PRESENT' || x.status === 'LATE' ? 1 : x.status === 'HALF_DAY' ? 0.5 : 0),
          0,
        );
        return {
          id: s.id,
          name: [s.firstName, s.lastName].filter(Boolean).join(' '),
          admissionNo: s.admissionNo,
          photoUrl: await signedUrl(s.photoKey),
          classLabel: e ? `${e.section.class.name}-${e.section.name}` : null,
          rollNo: e?.rollNo ?? null,
          classTeacher: e?.section.classTeacher
            ? `${e.section.classTeacher.firstName} ${e.section.classTeacher.lastName ?? ''}`.trim()
            : null,
          todayStatus: s.attendance.find((x) => x.date.getTime() === today)?.status ?? null,
          monthPercent: counted.length ? Math.round((attended / counted.length) * 1000) / 10 : null,
        };
      }),
    ),
  );
});

parentRouter.get('/children/:id/attendance', async (req, res) => {
  const a = authOf(req);
  const studentId = str(req.params.id);
  await assertMyChild(a.guardianId, studentId);
  const month = optStr(req.query.month) ?? currentMonthStr();
  const { from, to, days } = monthRange(month);
  const records = await prisma.studentAttendance.findMany({
    where: { studentId, date: { gte: from, lt: to } },
    orderBy: { date: 'asc' },
    select: { date: true, status: true, remark: true },
  });
  const totals: Record<string, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, LEAVE: 0, HOLIDAY: 0 };
  for (const r of records) totals[r.status]++;
  res.json({ month, days, records, totals });
});
