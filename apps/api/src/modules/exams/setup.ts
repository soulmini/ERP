import type { Router } from 'express';
import {
  copyDateSheetSchema,
  dateSheetSchema,
  examSchema,
  gradeScaleSchema,
  publishResultSchema,
  type ExamInput,
} from '@erp/shared';
import { prisma } from '../../db';
import { badRequest, conflict, notFound, parse, str, optStr } from '../../lib/http';
import { dateOnly } from '../../lib/dates';
import { audit } from '../../lib/audit';
import { authOf, can, hasPerm, requireKind } from '../../middleware/auth';
import { currentSession } from '../academic';
import {
  EXAM_ORDER,
  byDateSheetOrder,
  canPrintAdmitCards,
  canSeeResults,
  classOfSchool,
  d2s,
  examOfSchool,
  gradeScaleOf,
  isClassTeacher,
  marksAnywhere,
} from './common';

export const staffOnly = requireKind('PRINCIPAL', 'TEACHER', 'STAFF');

export const examJson = (e: {
  id: string;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  order: number;
  resultPublished: boolean;
}) => ({
  id: e.id,
  name: e.name,
  startDate: d2s(e.startDate),
  endDate: d2s(e.endDate),
  order: e.order,
  resultPublished: e.resultPublished,
});

function assertWithinSession(input: ExamInput, session: { name: string; startDate: Date; endDate: Date }) {
  const from = d2s(session.startDate)!;
  const to = d2s(session.endDate)!;
  for (const d of [input.startDate, input.endDate]) {
    if (d && (d < from || d > to)) throw badRequest(`Exam dates must fall within session ${session.name} (${from} to ${to})`);
  }
}

async function assertUniqueName(sessionId: string, name: string, exceptId?: string) {
  const dup = await prisma.exam.findFirst({
    where: { sessionId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (dup) throw conflict(`An exam named "${dup.name}" already exists in this session`);
}

/** Refuse to lower max marks below marks that are already entered. */
async function assertMaxNotBelowMarks(changes: { scheduleId: string; maxMarks: number; label: string }[]) {
  if (!changes.length) return;
  const top = await prisma.mark.groupBy({
    by: ['scheduleId'],
    where: { scheduleId: { in: changes.map((c) => c.scheduleId) } },
    _max: { marks: true },
  });
  const bad = changes.filter((c) => (top.find((t) => t.scheduleId === c.scheduleId)?._max.marks ?? 0) > c.maxMarks);
  if (bad.length) {
    throw conflict(`Some students already have more marks than the new max marks in ${bad.map((b) => b.label).join(', ')}`);
  }
}

export function registerSetupRoutes(r: Router) {
  // ───────── What this user can do: exams, sections & subjects in scope ─────────
  r.get('/scope', staffOnly, async (req, res) => {
    const a = authOf(req);
    const session = await currentSession(a.sid);
    const anywhere = marksAnywhere(a);
    const enter = anywhere || hasPerm(a, 'marks.enter');
    const [exams, sections, counts] = await Promise.all([
      prisma.exam.findMany({ where: { schoolId: a.sid, sessionId: session.id }, orderBy: EXAM_ORDER }),
      prisma.section.findMany({
        where: { class: { schoolId: a.sid } },
        orderBy: [{ class: { order: 'asc' } }, { name: 'asc' }],
        include: { class: { include: { subjects: { include: { subject: true } } } } },
      }),
      prisma.enrollment.groupBy({
        by: ['sectionId'],
        where: { sessionId: session.id, student: { status: 'ACTIVE' } },
        _count: true,
      }),
    ]);
    res.json({
      session: { id: session.id, name: session.name },
      canManage: hasPerm(a, 'exams.manage'),
      marksAnywhere: anywhere,
      exams: exams.map(examJson),
      sections: sections
        .map((s) => {
          const mine = isClassTeacher(a, s);
          const subjects = s.class.subjects
            .filter((cs) => anywhere || mine || (!!a.staffId && cs.teacherId === a.staffId))
            .map((cs) => ({ id: cs.subjectId, name: cs.subject.name, type: cs.subject.type, canEnter: enter }))
            .sort((x, y) => (x.type === y.type ? x.name.localeCompare(y.name) : x.type === 'SCHOLASTIC' ? -1 : 1));
          return {
            id: s.id,
            label: `${s.class.name}-${s.name}`,
            classId: s.classId,
            className: s.class.name,
            isClassTeacher: mine,
            canViewResults: canSeeResults(a, s),
            canPrintAdmitCards: canPrintAdmitCards(a, s),
            students: counts.find((c) => c.sectionId === s.id)?._count ?? 0,
            subjects,
          };
        })
        .filter((s) => anywhere || s.subjects.length > 0 || s.canViewResults || s.canPrintAdmitCards),
    });
  });

  // ───────── Grade scale ─────────
  r.get('/grades', async (req, res) => {
    res.json(await gradeScaleOf(authOf(req).sid));
  });

  r.put('/grades', can('exams.manage'), async (req, res) => {
    const a = authOf(req);
    const { grades } = parse(gradeScaleSchema, req.body);
    await prisma.$transaction([
      prisma.gradeScale.deleteMany({ where: { schoolId: a.sid } }),
      prisma.gradeScale.createMany({
        data: grades.map((g) => ({ ...g, grade: g.grade.toUpperCase(), schoolId: a.sid })),
      }),
    ]);
    audit(req, 'exam.gradeScale', 'GradeScale', undefined, { grades: grades.map((g) => `${g.grade} ${g.minPercent}-${g.maxPercent}`) });
    res.json(await gradeScaleOf(a.sid));
  });

  // ───────── Exams of the current session ─────────
  r.get('/', staffOnly, async (req, res) => {
    const a = authOf(req);
    const session = await currentSession(a.sid);
    const [exams, schedules, classCount, enrolled] = await Promise.all([
      prisma.exam.findMany({ where: { schoolId: a.sid, sessionId: session.id }, orderBy: EXAM_ORDER }),
      prisma.examSchedule.findMany({
        where: { exam: { schoolId: a.sid, sessionId: session.id } },
        select: { examId: true, classId: true, date: true, _count: { select: { marks: true } } },
      }),
      prisma.class.count({ where: { schoolId: a.sid } }),
      prisma.enrollment.findMany({
        where: { sessionId: session.id, student: { schoolId: a.sid, status: 'ACTIVE' } },
        select: { section: { select: { classId: true } } },
      }),
    ]);
    const perClass = new Map<string, number>();
    for (const e of enrolled) perClass.set(e.section.classId, (perClass.get(e.section.classId) ?? 0) + 1);
    res.json({
      session: { id: session.id, name: session.name },
      exams: exams.map((e) => {
        const mine = schedules.filter((s) => s.examId === e.id);
        const expected = mine.reduce((n, s) => n + (perClass.get(s.classId) ?? 0), 0);
        const entered = mine.reduce((n, s) => n + s._count.marks, 0);
        const dates = mine.flatMap((s) => (s.date ? [d2s(s.date)!] : [])).sort();
        return {
          ...examJson(e),
          classesScheduled: new Set(mine.map((s) => s.classId)).size,
          totalClasses: classCount,
          papers: mine.length,
          marksExpected: expected,
          marksEntered: Math.min(entered, expected),
          firstPaper: dates[0] ?? null,
          lastPaper: dates[dates.length - 1] ?? null,
        };
      }),
    });
  });

  r.post('/', can('exams.manage'), async (req, res) => {
    const a = authOf(req);
    const input = parse(examSchema, req.body);
    const session = await currentSession(a.sid);
    assertWithinSession(input, session);
    await assertUniqueName(session.id, input.name);
    const exam = await prisma.exam.create({
      data: {
        schoolId: a.sid,
        sessionId: session.id,
        name: input.name,
        startDate: input.startDate ? dateOnly(input.startDate) : null,
        endDate: input.endDate ? dateOnly(input.endDate) : null,
        order: input.order,
      },
    });
    audit(req, 'exam.create', 'Exam', exam.id, { name: exam.name });
    res.status(201).json(examJson(exam));
  });

  r.get('/:id', staffOnly, async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const [classes, schedules, sessionExams] = await Promise.all([
      prisma.class.findMany({
        where: { schoolId: a.sid },
        orderBy: { order: 'asc' },
        include: { sections: { orderBy: { name: 'asc' } }, _count: { select: { subjects: true } } },
      }),
      prisma.examSchedule.findMany({
        where: { examId: exam.id },
        select: { classId: true, date: true, _count: { select: { marks: true } } },
      }),
      prisma.exam.findMany({ where: { sessionId: exam.sessionId }, orderBy: EXAM_ORDER, select: { id: true } }),
    ]);
    const dates = schedules.flatMap((s) => (s.date ? [d2s(s.date)!] : [])).sort();
    res.json({
      ...examJson(exam),
      session: { id: exam.session.id, name: exam.session.name, startDate: d2s(exam.session.startDate), endDate: d2s(exam.session.endDate) },
      isFinal: sessionExams[sessionExams.length - 1]?.id === exam.id,
      firstPaper: dates[0] ?? null,
      lastPaper: dates[dates.length - 1] ?? null,
      canManage: hasPerm(a, 'exams.manage'),
      classes: classes.map((c) => {
        const mine = schedules.filter((s) => s.classId === c.id);
        return {
          id: c.id,
          name: c.name,
          subjects: c._count.subjects,
          scheduled: mine.length,
          marks: mine.reduce((n, s) => n + s._count.marks, 0),
          sections: c.sections.map((s) => ({ id: s.id, label: `${c.name}-${s.name}` })),
        };
      }),
    });
  });

  r.put('/:id', can('exams.manage'), async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const input = parse(examSchema, req.body);
    assertWithinSession(input, exam.session);
    await assertUniqueName(exam.sessionId, input.name, exam.id);
    const updated = await prisma.exam.update({
      where: { id: exam.id },
      data: {
        name: input.name,
        startDate: input.startDate ? dateOnly(input.startDate) : null,
        endDate: input.endDate ? dateOnly(input.endDate) : null,
        order: input.order,
      },
    });
    audit(req, 'exam.update', 'Exam', exam.id, input);
    res.json(examJson(updated));
  });

  r.delete('/:id', can('exams.manage'), async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const marks = await prisma.mark.count({ where: { schedule: { examId: exam.id } } });
    const force = optStr(req.query.force) === 'true';
    if (marks && !force) {
      throw conflict(`${marks} marks have been entered for ${exam.name}. Delete the exam with all its marks?`);
    }
    await prisma.exam.delete({ where: { id: exam.id } });
    audit(req, 'exam.delete', 'Exam', exam.id, { name: exam.name, marks });
    res.json({ ok: true });
  });

  r.post('/:id/publish', can('exams.manage'), async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const { published } = parse(publishResultSchema, req.body);
    const updated = await prisma.exam.update({ where: { id: exam.id }, data: { resultPublished: published } });
    audit(req, published ? 'exam.publish' : 'exam.unpublish', 'Exam', exam.id, { name: exam.name });
    res.json(examJson(updated));
  });

  // ───────── Date sheet ─────────

  /** ?classId= → that class's subjects with their schedule; otherwise every scheduled class. */
  r.get('/:id/schedule', staffOnly, async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const classId = optStr(req.query.classId);
    if (!classId) {
      const [classes, schedules] = await Promise.all([
        prisma.class.findMany({ where: { schoolId: a.sid }, orderBy: { order: 'asc' } }),
        prisma.examSchedule.findMany({ where: { examId: exam.id }, include: { subject: true } }),
      ]);
      return res.json({
        exam: examJson(exam),
        classes: classes
          .map((c) => ({
            classId: c.id,
            className: c.name,
            entries: schedules
              .filter((s) => s.classId === c.id)
              .sort(byDateSheetOrder)
              .map((s) => ({
                subjectId: s.subjectId,
                name: s.subject.name,
                type: s.subject.type,
                date: d2s(s.date),
                startTime: s.startTime,
                endTime: s.endTime,
                maxMarks: s.maxMarks,
                passMarks: s.passMarks,
              })),
          }))
          .filter((c) => c.entries.length),
      });
    }
    const cls = await classOfSchool(classId, a.sid);
    const [classSubjects, schedules] = await Promise.all([
      prisma.classSubject.findMany({ where: { classId: cls.id }, include: { subject: true } }),
      prisma.examSchedule.findMany({
        where: { examId: exam.id, classId: cls.id },
        include: { subject: true, _count: { select: { marks: true } } },
      }),
    ]);
    const bySubject = new Map(schedules.map((s) => [s.subjectId, s]));
    const rows = [
      ...classSubjects.map((cs) => ({ subject: cs.subject, s: bySubject.get(cs.subjectId), inClass: true })),
      // Scheduled subjects that were later removed from the class.
      ...schedules
        .filter((s) => !classSubjects.some((cs) => cs.subjectId === s.subjectId))
        .map((s) => ({ subject: s.subject, s, inClass: false })),
    ];
    rows.sort((x, y) =>
      byDateSheetOrder(
        { date: x.s?.date ?? null, startTime: x.s?.startTime ?? null, subject: x.subject },
        { date: y.s?.date ?? null, startTime: y.s?.startTime ?? null, subject: y.subject },
      ),
    );
    res.json({
      exam: examJson(exam),
      class: { id: cls.id, name: cls.name },
      canEdit: hasPerm(a, 'exams.manage'),
      subjects: rows.map(({ subject, s, inClass }) => ({
        subjectId: subject.id,
        name: subject.name,
        type: subject.type,
        inClass,
        scheduled: !!s,
        date: d2s(s?.date),
        startTime: s?.startTime ?? null,
        endTime: s?.endTime ?? null,
        maxMarks: s?.maxMarks ?? 100,
        passMarks: s?.passMarks ?? 33,
        marksCount: s?._count.marks ?? 0,
      })),
    });
  });

  /** Save one class's date sheet. Subjects left out are removed (unless marks exist). */
  r.put('/:id/schedule', can('exams.manage'), async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const input = parse(dateSheetSchema, req.body);
    const cls = await classOfSchool(input.classId, a.sid);
    const [classSubjects, existing] = await Promise.all([
      prisma.classSubject.findMany({ where: { classId: cls.id }, include: { subject: true } }),
      prisma.examSchedule.findMany({
        where: { examId: exam.id, classId: cls.id },
        include: { subject: true, _count: { select: { marks: true } } },
      }),
    ]);
    const allowed = new Set(classSubjects.map((cs) => cs.subjectId));
    const bad = input.entries.filter((e) => !allowed.has(e.subjectId) && !existing.some((s) => s.subjectId === e.subjectId));
    if (bad.length) throw badRequest('Some subjects are not taught in this class', { subjectIds: bad.map((b) => b.subjectId) });

    const keep = new Set(input.entries.map((e) => e.subjectId));
    const removing = existing.filter((s) => !keep.has(s.subjectId));
    const locked = removing.filter((s) => s._count.marks > 0);
    if (locked.length) {
      throw conflict(
        `Marks are already entered for ${locked.map((s) => s.subject.name).join(', ')}. Keep these subjects, or clear their marks first.`,
      );
    }
    const updates = input.entries.flatMap((e) => {
      const s = existing.find((x) => x.subjectId === e.subjectId);
      return s ? [{ s, e }] : [];
    });
    await assertMaxNotBelowMarks(updates.map(({ s, e }) => ({ scheduleId: s.id, maxMarks: e.maxMarks, label: s.subject.name })));
    const creates = input.entries.filter((e) => !existing.some((x) => x.subjectId === e.subjectId));
    const fields = (e: (typeof input.entries)[number]) => ({
      date: e.date ? dateOnly(e.date) : null,
      startTime: e.startTime,
      endTime: e.endTime,
      maxMarks: e.maxMarks,
      passMarks: e.passMarks,
    });
    await prisma.$transaction([
      prisma.examSchedule.deleteMany({ where: { id: { in: removing.map((s) => s.id) } } }),
      prisma.examSchedule.createMany({
        data: creates.map((e) => ({ examId: exam.id, classId: cls.id, subjectId: e.subjectId, ...fields(e) })),
      }),
      ...updates.map(({ s, e }) => prisma.examSchedule.update({ where: { id: s.id }, data: fields(e) })),
    ]);
    audit(req, 'exam.dateSheet', 'Exam', exam.id, {
      classId: cls.id,
      class: cls.name,
      subjects: input.entries.length,
      removed: removing.map((s) => s.subject.name),
    });
    res.json({ ok: true, saved: input.entries.length, removed: removing.length });
  });

  /** Copy one class's date sheet (dates, times, max/pass marks) to other classes, for subjects they share. */
  r.post('/:id/schedule/copy', can('exams.manage'), async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const input = parse(copyDateSheetSchema, req.body);
    const from = await classOfSchool(input.fromClassId, a.sid);
    const targetIds = [...new Set(input.toClassIds)].filter((id) => id !== from.id);
    if (!targetIds.length) throw badRequest('Choose a different class to copy to');
    const targets = await prisma.class.findMany({
      where: { id: { in: targetIds }, schoolId: a.sid },
      orderBy: { order: 'asc' },
      include: { subjects: { include: { subject: true } } },
    });
    if (targets.length !== targetIds.length) throw notFound('Class not found');
    const source = await prisma.examSchedule.findMany({ where: { examId: exam.id, classId: from.id }, include: { subject: true } });
    if (!source.length) throw badRequest(`Class ${from.name} has no date sheet for ${exam.name} yet`);
    const existing = await prisma.examSchedule.findMany({
      where: { examId: exam.id, classId: { in: targets.map((t) => t.id) } },
      include: { subject: true, class: true },
    });

    const creates: { examId: string; classId: string; subjectId: string; date: Date | null; startTime: string | null; endTime: string | null; maxMarks: number; passMarks: number }[] = [];
    const updates: { id: string; label: string; data: { date: Date | null; startTime: string | null; endTime: string | null; maxMarks: number; passMarks: number } }[] = [];
    const summary = targets.map((t) => {
      const taught = new Set(t.subjects.map((cs) => cs.subjectId));
      const lines = source.filter((s) => taught.has(s.subjectId));
      for (const s of lines) {
        const data = { date: s.date, startTime: s.startTime, endTime: s.endTime, maxMarks: s.maxMarks, passMarks: s.passMarks };
        const ex = existing.find((x) => x.classId === t.id && x.subjectId === s.subjectId);
        if (ex) updates.push({ id: ex.id, label: `${t.name} ${s.subject.name}`, data });
        else creates.push({ examId: exam.id, classId: t.id, subjectId: s.subjectId, ...data });
      }
      return {
        classId: t.id,
        className: t.name,
        copied: lines.length,
        skipped: source.filter((s) => !taught.has(s.subjectId)).map((s) => s.subject.name),
      };
    });
    await assertMaxNotBelowMarks(updates.map((u) => ({ scheduleId: u.id, maxMarks: u.data.maxMarks, label: u.label })));
    await prisma.$transaction([
      prisma.examSchedule.createMany({ data: creates, skipDuplicates: true }),
      ...updates.map((u) => prisma.examSchedule.update({ where: { id: u.id }, data: u.data })),
    ]);
    audit(req, 'exam.dateSheetCopy', 'Exam', exam.id, { from: from.name, to: targets.map((t) => t.name) });
    res.json({ ok: true, classes: summary });
  });
}
