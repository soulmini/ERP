import type { Router } from 'express';
import { examRemarksSchema, marksEntrySchema } from '@erp/shared';
import { prisma } from '../../db';
import { HttpError, badRequest, forbidden, notFound, parse, str } from '../../lib/http';
import { audit } from '../../lib/audit';
import { authOf, can, hasPerm } from '../../middleware/auth';
import { sectionOfSchool } from '../academic';
import {
  assertCanEnterMarks,
  canSeeResults,
  d2s,
  examOfSchool,
  fullName,
  gradeScaleOf,
  isClassTeacher,
  marksAnywhere,
  resultsSection,
} from './common';
import { examJson, staffOnly } from './setup';
import { sectionResults } from './results';

const PUBLISHED_LOCK = 'Results are published. Ask the exam admin to unpublish the result before making changes.';

const rosterOf = (sectionId: string, sessionId: string) =>
  prisma.enrollment.findMany({
    where: { sectionId, sessionId, student: { status: 'ACTIVE' } },
    orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
    include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
  });

export function registerMarksRoutes(r: Router) {
  /** Marks grid for one exam, section & subject. */
  r.get('/:id/marks', staffOnly, async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const section = await sectionOfSchool(str(req.query.sectionId, 'sectionId'), a.sid);
    const subjectId = str(req.query.subjectId, 'subjectId');
    const cs = await prisma.classSubject.findUnique({
      where: { classId_subjectId: { classId: section.classId, subjectId } },
      include: { subject: true },
    });
    if (!cs || cs.subject.schoolId !== a.sid) throw notFound('This subject is not taught in this class');
    const canEnter = await assertCanEnterMarks(a, section, subjectId).then(
      () => true,
      () => false,
    );
    if (!canEnter && !canSeeResults(a, section)) {
      throw forbidden('You can enter marks only for your own class or the subjects assigned to you');
    }
    const [schedule, roster, scale] = await Promise.all([
      prisma.examSchedule.findUnique({
        where: { examId_classId_subjectId: { examId: exam.id, classId: section.classId, subjectId } },
      }),
      rosterOf(section.id, exam.sessionId),
      gradeScaleOf(a.sid),
    ]);
    const marks = schedule
      ? await prisma.mark.findMany({ where: { scheduleId: schedule.id, studentId: { in: roster.map((e) => e.studentId) } } })
      : [];
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    const last = [...marks].sort((x, y) => +y.updatedAt - +x.updatedAt)[0];
    const savedBy = last?.enteredById
      ? await prisma.staff.findFirst({ where: { id: last.enteredById, schoolId: a.sid }, select: { firstName: true, lastName: true } })
      : null;
    const label = `${section.class.name}-${section.name}`;
    const locked = exam.resultPublished && !hasPerm(a, 'exams.manage');
    res.json({
      exam: examJson(exam),
      section: { id: section.id, label },
      subject: { id: cs.subjectId, name: cs.subject.name, type: cs.subject.type },
      schedule: schedule
        ? {
            id: schedule.id,
            date: d2s(schedule.date),
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            maxMarks: schedule.maxMarks,
            passMarks: schedule.passMarks,
          }
        : null,
      scale,
      editable: canEnter && !!schedule && !locked,
      lockedReason: !schedule
        ? `${cs.subject.name} is not in the ${exam.name} date sheet for Class ${section.class.name} yet. Ask the exam admin to add it.`
        : !canEnter
          ? 'You can view these marks but not change them.'
          : locked
            ? PUBLISHED_LOCK
            : null,
      savedAt: last?.updatedAt ?? null,
      savedBy: savedBy ? fullName(savedBy) : null,
      students: roster.map((e) => {
        const m = byStudent.get(e.studentId);
        return {
          studentId: e.studentId,
          rollNo: e.rollNo,
          admissionNo: e.student.admissionNo,
          name: fullName(e.student),
          marks: m?.marks ?? null,
          grade: m?.grade ?? null,
          isAbsent: m?.isAbsent ?? false,
        };
      }),
    });
  });

  /** Save marks for one subject of a section (rows sent replace existing ones; empty rows are cleared). */
  r.put('/:id/marks', can('marks.enter', 'exams.manage'), staffOnly, async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const input = parse(marksEntrySchema, req.body);
    const section = await sectionOfSchool(input.sectionId, a.sid);
    await assertCanEnterMarks(a, section, input.subjectId);
    if (exam.resultPublished && !hasPerm(a, 'exams.manage')) throw forbidden(PUBLISHED_LOCK);
    const cs = await prisma.classSubject.findUnique({
      where: { classId_subjectId: { classId: section.classId, subjectId: input.subjectId } },
      include: { subject: true },
    });
    if (!cs || cs.subject.schoolId !== a.sid) throw badRequest('This subject is not taught in this class');
    const schedule = await prisma.examSchedule.findUnique({
      where: { examId_classId_subjectId: { examId: exam.id, classId: section.classId, subjectId: input.subjectId } },
    });
    if (!schedule) {
      throw badRequest(`Add ${cs.subject.name} to the ${exam.name} date sheet for Class ${section.class.name} first`);
    }

    const ids = input.entries.map((e) => e.studentId);
    const enrolled = await prisma.enrollment.findMany({
      where: { sectionId: section.id, sessionId: exam.sessionId, studentId: { in: ids } },
      include: { student: { select: { firstName: true, lastName: true } } },
    });
    const who = new Map(enrolled.map((e) => [e.studentId, fullName(e.student)]));
    const invalid = ids.filter((id) => !who.has(id));
    if (invalid.length) throw badRequest('Some students are not in this section', { studentIds: invalid });

    const coScholastic = cs.subject.type === 'CO_SCHOLASTIC';
    const letters = coScholastic ? new Set((await gradeScaleOf(a.sid)).map((g) => g.grade.toUpperCase())) : new Set<string>();
    const errors: string[] = [];
    const rows: { scheduleId: string; studentId: string; marks: number | null; grade: string | null; isAbsent: boolean; enteredById: string | null }[] = [];
    let cleared = 0;
    for (const e of input.entries) {
      const base = { scheduleId: schedule.id, studentId: e.studentId, enteredById: a.staffId };
      if (e.isAbsent) {
        rows.push({ ...base, marks: null, grade: null, isAbsent: true });
      } else if (!coScholastic) {
        if (e.marks == null) cleared++;
        else if (e.marks > schedule.maxMarks) errors.push(`${who.get(e.studentId)}: ${e.marks} is more than the max marks (${schedule.maxMarks})`);
        else rows.push({ ...base, marks: e.marks, grade: null, isAbsent: false });
      } else {
        const g = e.grade?.toUpperCase() ?? null;
        if (!g) cleared++;
        else if (!letters.has(g)) errors.push(`${who.get(e.studentId)}: "${e.grade}" is not a grade in the grade scale`);
        else rows.push({ ...base, marks: null, grade: g, isAbsent: false });
      }
    }
    if (errors.length) {
      const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : '';
      throw new HttpError(422, errors[0] + more, { errors });
    }

    // Replace in one batch: 2 round-trips for a whole class.
    await prisma.$transaction([
      prisma.mark.deleteMany({ where: { scheduleId: schedule.id, studentId: { in: ids } } }),
      prisma.mark.createMany({ data: rows }),
    ]);
    const absent = rows.filter((x) => x.isAbsent).length;
    audit(req, 'marks.save', 'ExamSchedule', schedule.id, {
      exam: exam.name,
      section: `${section.class.name}-${section.name}`,
      subject: cs.subject.name,
      saved: rows.length,
      absent,
      cleared,
    });
    res.json({ ok: true, saved: rows.length, absent, cleared });
  });

  /** Marks entry progress: sections × subjects (only what this user may enter, or everything for exam admins). */
  r.get('/:id/progress', staffOnly, async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const anywhere = marksAnywhere(a);
    const [sections, schedules, enrollments, marks, remarks] = await Promise.all([
      prisma.section.findMany({
        where: { class: { schoolId: a.sid } },
        orderBy: [{ class: { order: 'asc' } }, { name: 'asc' }],
        include: { class: { include: { subjects: { include: { subject: true } } } } },
      }),
      prisma.examSchedule.findMany({ where: { examId: exam.id }, select: { id: true, classId: true, subjectId: true, date: true } }),
      prisma.enrollment.findMany({
        where: { sessionId: exam.sessionId, student: { schoolId: a.sid, status: 'ACTIVE' } },
        select: { studentId: true, sectionId: true },
      }),
      prisma.mark.findMany({ where: { schedule: { examId: exam.id } }, select: { scheduleId: true, studentId: true } }),
      prisma.examRemark.findMany({ where: { examId: exam.id, remark: { not: null } }, select: { studentId: true } }),
    ]);
    const sectionOfStudent = new Map(enrollments.map((e) => [e.studentId, e.sectionId]));
    const counts = new Map<string, number>();
    for (const m of marks) {
      const sec = sectionOfStudent.get(m.studentId);
      if (sec) counts.set(`${m.scheduleId}:${sec}`, (counts.get(`${m.scheduleId}:${sec}`) ?? 0) + 1);
    }
    const remarked = new Map<string, number>();
    for (const rm of remarks) {
      const sec = sectionOfStudent.get(rm.studentId);
      if (sec) remarked.set(sec, (remarked.get(sec) ?? 0) + 1);
    }
    res.json({
      exam: examJson(exam),
      sections: sections
        .map((s) => {
          const mine = isClassTeacher(a, s);
          const subjects = s.class.subjects
            .filter((cs) => anywhere || mine || (!!a.staffId && cs.teacherId === a.staffId))
            .map((cs) => {
              const sch = schedules.find((x) => x.classId === s.classId && x.subjectId === cs.subjectId);
              return {
                subjectId: cs.subjectId,
                name: cs.subject.name,
                type: cs.subject.type,
                scheduled: !!sch,
                date: d2s(sch?.date),
                entered: sch ? (counts.get(`${sch.id}:${s.id}`) ?? 0) : 0,
              };
            })
            .sort((x, y) => (x.type === y.type ? x.name.localeCompare(y.name) : x.type === 'SCHOLASTIC' ? -1 : 1));
          return {
            id: s.id,
            label: `${s.class.name}-${s.name}`,
            classId: s.classId,
            isClassTeacher: mine,
            canViewResults: canSeeResults(a, s),
            students: enrollments.filter((e) => e.sectionId === s.id).length,
            remarks: canSeeResults(a, s) ? (remarked.get(s.id) ?? 0) : null,
            subjects,
          };
        })
        .filter((s) => s.subjects.length > 0 && s.students > 0),
    });
  });

  // ───────── Class-teacher remarks ─────────

  r.get('/:id/remarks', staffOnly, async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const section = await resultsSection(a, str(req.query.sectionId, 'sectionId'));
    const [results, remarks] = await Promise.all([
      sectionResults(exam, section, await gradeScaleOf(a.sid)),
      prisma.examRemark.findMany({ where: { examId: exam.id, student: { schoolId: a.sid } } }),
    ]);
    const locked = exam.resultPublished && !hasPerm(a, 'exams.manage');
    res.json({
      exam: examJson(exam),
      section: { id: section.id, label: `${section.class.name}-${section.name}` },
      editable: !locked,
      lockedReason: locked ? PUBLISHED_LOCK : null,
      students: results.students.map((s) => ({
        studentId: s.studentId,
        rollNo: s.rollNo,
        admissionNo: s.admissionNo,
        name: s.name,
        percent: s.percent,
        grade: s.grade,
        result: s.result,
        failedSubjects: s.failedSubjects,
        remark: remarks.find((r) => r.studentId === s.studentId)?.remark ?? null,
      })),
    });
  });

  r.put('/:id/remarks', staffOnly, async (req, res) => {
    const a = authOf(req);
    const exam = await examOfSchool(str(req.params.id), a.sid);
    const input = parse(examRemarksSchema, req.body);
    const section = await resultsSection(a, input.sectionId);
    if (exam.resultPublished && !hasPerm(a, 'exams.manage')) throw forbidden(PUBLISHED_LOCK);
    const ids = input.entries.map((e) => e.studentId);
    if (new Set(ids).size !== ids.length) throw badRequest('A student is listed twice');
    const enrolled = await prisma.enrollment.count({ where: { sectionId: section.id, sessionId: exam.sessionId, studentId: { in: ids } } });
    if (enrolled !== ids.length) throw badRequest('Some students are not in this section');
    await prisma.$transaction([
      prisma.examRemark.deleteMany({ where: { examId: exam.id, studentId: { in: ids } } }),
      prisma.examRemark.createMany({
        data: input.entries.filter((e) => e.remark).map((e) => ({ examId: exam.id, studentId: e.studentId, remark: e.remark })),
      }),
    ]);
    const saved = input.entries.filter((e) => e.remark).length;
    audit(req, 'exam.remarks', 'Exam', exam.id, { section: `${section.class.name}-${section.name}`, saved });
    res.json({ ok: true, saved });
  });
}
