import { prisma } from '../db';
import type { AuthPayload } from '../lib/tokens';
import { forbidden } from '../lib/http';
import { hasPerm } from '../middleware/auth';

/**
 * Who can see / act on which class-sections. Shared by homework, notices and time table.
 */

export const sectionLabel = (s: { name: string; class: { name: string } }) => `${s.class.name}-${s.name}`;

/** Sections a teacher works with: class teacher of, or a subject of that class is assigned to them. */
export async function teacherSectionIds(a: AuthPayload): Promise<Set<string>> {
  if (!a.staffId) return new Set();
  const sections = await prisma.section.findMany({
    where: {
      class: { schoolId: a.sid },
      OR: [{ classTeacherId: a.staffId }, { class: { subjects: { some: { teacherId: a.staffId } } } }],
    },
    select: { id: true },
  });
  return new Set(sections.map((s) => s.id));
}

/** The parent's active children with their section in the current session. */
export async function parentChildren(a: AuthPayload) {
  if (!a.guardianId) return [];
  const links = await prisma.studentGuardian.findMany({
    where: { guardianId: a.guardianId, student: { schoolId: a.sid, status: 'ACTIVE' } },
    select: {
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          enrollments: {
            where: { session: { isCurrent: true } },
            select: { sectionId: true, section: { select: { name: true, class: { select: { name: true } } } } },
          },
        },
      },
    },
  });
  return links
    .map(({ student: s }) => ({
      studentId: s.id,
      name: [s.firstName, s.lastName].filter(Boolean).join(' '),
      sectionId: s.enrollments[0]?.sectionId ?? null,
      sectionLabel: s.enrollments[0] ? sectionLabel(s.enrollments[0].section) : null,
    }))
    .filter((c) => c.sectionId);
}

/** Section of one of the parent's children (403 if the student isn't theirs). */
export async function childSection(a: AuthPayload, studentId: string) {
  const child = (await parentChildren(a)).find((c) => c.studentId === studentId);
  if (!child) throw forbidden('This student is not linked to your account');
  return child;
}

/** Admin-type users that manage a module see every section. */
export const managesAll = (a: AuthPayload, perm: Parameters<typeof hasPerm>[1]) => a.view === 'admin' && hasPerm(a, perm);
