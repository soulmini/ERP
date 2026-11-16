import { DEFAULT_GRADE_SCALE, type GradeBand } from '@erp/shared';
import { prisma } from '../../db';
import { forbidden, notFound } from '../../lib/http';
import { toDateStr } from '../../lib/dates';
import type { AuthPayload } from '../../lib/tokens';
import { hasPerm } from '../../middleware/auth';
import { sectionOfSchool } from '../academic';

export const d2s = (d: Date | null | undefined) => (d ? toDateStr(d) : null);
export const fullName = (p: { firstName: string; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ');
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Exams of a session in display order. */
export const EXAM_ORDER = [{ order: 'asc' as const }, { startDate: 'asc' as const }, { createdAt: 'asc' as const }];

/** Exam admins (and admin-view users with marks.enter) may enter marks for any section & subject. */
export const marksAnywhere = (a: AuthPayload) =>
  hasPerm(a, 'exams.manage') || (a.view === 'admin' && hasPerm(a, 'marks.enter'));

export const isClassTeacher = (a: AuthPayload, section: { classTeacherId: string | null }) =>
  !!a.staffId && section.classTeacherId === a.staffId;

/** Results, remarks and report cards of a section: exam admins and the section's class teacher. */
export const canSeeResults = (a: AuthPayload, section: { classTeacherId: string | null }) =>
  hasPerm(a, 'exams.manage') || isClassTeacher(a, section);

/** Admit cards: exam admins, front office (certificates.issue) and the class teacher. */
export const canPrintAdmitCards = (a: AuthPayload, section: { classTeacherId: string | null }) =>
  hasPerm(a, 'exams.manage') || (a.view === 'admin' && hasPerm(a, 'certificates.issue')) || isClassTeacher(a, section);

export async function examOfSchool(id: string, schoolId: string) {
  const exam = await prisma.exam.findFirst({ where: { id, schoolId }, include: { session: true } });
  if (!exam) throw notFound('Exam not found');
  return exam;
}
export type ExamWithSession = Awaited<ReturnType<typeof examOfSchool>>;

export async function classOfSchool(id: string, schoolId: string) {
  const cls = await prisma.class.findFirst({ where: { id, schoolId } });
  if (!cls) throw notFound('Class not found');
  return cls;
}

/** Section of this school whose results the user may see. */
export async function resultsSection(a: AuthPayload, sectionId: string) {
  const section = await sectionOfSchool(sectionId, a.sid);
  if (!canSeeResults(a, section)) throw forbidden('Only the class teacher of this section or the exam admin can see this');
  return section;
}

/** Teachers: own class (any subject) or subjects assigned to them; exam admins: anything. */
export async function assertCanEnterMarks(
  a: AuthPayload,
  section: { classId: string; classTeacherId: string | null },
  subjectId: string,
) {
  if (marksAnywhere(a)) return;
  if (!hasPerm(a, 'marks.enter')) throw forbidden();
  if (isClassTeacher(a, section)) return;
  const cs = await prisma.classSubject.findUnique({
    where: { classId_subjectId: { classId: section.classId, subjectId } },
  });
  if (a.staffId && cs?.teacherId === a.staffId) return;
  throw forbidden('You can enter marks only for your own class or the subjects assigned to you');
}

/** Is this student one of the logged-in parent's children? */
export async function isMyChild(a: AuthPayload, studentId: string) {
  if (!a.guardianId) return false;
  const link = await prisma.studentGuardian.findUnique({
    where: { studentId_guardianId: { studentId, guardianId: a.guardianId } },
    include: { student: { select: { schoolId: true } } },
  });
  return !!link && link.student.schoolId === a.sid;
}

export async function assertMyChild(a: AuthPayload, studentId: string) {
  if (!(await isMyChild(a, studentId))) throw forbidden('This student is not linked to your account');
}

/** The school's grade scale (highest first). Creates the default CBSE-style scale if the school has none. */
export async function gradeScaleOf(schoolId: string): Promise<GradeBand[]> {
  const read = () => prisma.gradeScale.findMany({ where: { schoolId }, orderBy: { minPercent: 'desc' } });
  let rows = await read();
  if (!rows.length) {
    await prisma.gradeScale.createMany({
      data: DEFAULT_GRADE_SCALE.map((g) => ({ ...g, schoolId })),
      skipDuplicates: true,
    });
    rows = await read();
  }
  return rows.map(({ grade, minPercent, maxPercent, gradePoint, remark }) => ({ grade, minPercent, maxPercent, gradePoint, remark }));
}

/** Date sheet order: by date, then time, then subject name (undated last). */
export function byDateSheetOrder<T extends { date: Date | null; startTime: string | null; subject: { name: string } }>(a: T, b: T) {
  const da = a.date?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const db = b.date?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  const ta = a.startTime ?? '99:99';
  const tb = b.startTime ?? '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.subject.name.localeCompare(b.subject.name);
}

/** Father / mother / guardian names for printed documents. */
export function parentNames(links: { isPrimary: boolean; guardian: { name: string; relation: string } }[]) {
  const sorted = [...links].sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary));
  const father = sorted.find((l) => l.guardian.relation === 'FATHER')?.guardian.name ?? null;
  const mother = sorted.find((l) => l.guardian.relation === 'MOTHER')?.guardian.name ?? null;
  const guardian = sorted.find((l) => l.guardian.relation === 'GUARDIAN')?.guardian.name ?? sorted[0]?.guardian.name ?? null;
  return { fatherName: father, motherName: mother, guardianName: father || mother ? null : guardian };
}
