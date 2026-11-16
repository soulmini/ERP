import bcrypt from 'bcryptjs';
import type { Prisma } from '../generated/prisma/client';
import { conflict } from '../lib/http';

type Tx = Prisma.TransactionClient;

export const fullName = (p: { firstName: string; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ');

/**
 * Next free admission number "YYYY/NNNN" for a session. The counter starts from the highest existing
 * number with that prefix (demo / imported students), and skips numbers already taken.
 */
export async function nextAdmissionNo(tx: Tx, schoolId: string, sessionName: string): Promise<string> {
  const year = sessionName.slice(0, 4);
  const key = `admission:${sessionName}`;
  const existing = await tx.counter.findUnique({ where: { schoolId_key: { schoolId, key } } });
  if (!existing) {
    const rows = await tx.student.findMany({ where: { schoolId, admissionNo: { startsWith: `${year}/` } }, select: { admissionNo: true } });
    const max = rows.reduce((m, r) => Math.max(m, Number(r.admissionNo.slice(year.length + 1)) || 0), 0);
    await tx.counter.upsert({ where: { schoolId_key: { schoolId, key } }, create: { schoolId, key, value: max }, update: {} });
  }
  for (let i = 0; i < 50; i++) {
    const c = await tx.counter.update({ where: { schoolId_key: { schoolId, key } }, data: { value: { increment: 1 } } });
    const no = `${year}/${String(c.value).padStart(4, '0')}`;
    if (!(await tx.student.findUnique({ where: { schoolId_admissionNo: { schoolId, admissionNo: no } } }))) return no;
  }
  throw conflict('Could not find a free admission number');
}

export async function assertAdmissionNoFree(tx: Tx, schoolId: string, admissionNo: string, exceptId?: string) {
  const s = await tx.student.findUnique({ where: { schoolId_admissionNo: { schoolId, admissionNo } } });
  if (s && s.id !== exceptId) throw conflict(`Admission no. ${admissionNo} is already used by ${fullName(s)}`);
}

/** Next roll number in a section for a session. */
export async function nextRollNo(tx: Tx, sectionId: string, sessionId: string): Promise<number> {
  const max = await tx.enrollment.aggregate({ where: { sectionId, sessionId }, _max: { rollNo: true } });
  return (max._max.rollNo ?? 0) + 1;
}

export interface GuardianData {
  name: string;
  relation: 'FATHER' | 'MOTHER' | 'GUARDIAN';
  phone?: string | null;
  email?: string | null;
  occupation?: string | null;
  qualification?: string | null;
  annualIncome?: number | null;
  aadhaarNo?: string | null;
  address?: string | null;
}

/**
 * Find a guardian of this school by phone (siblings share one), or create one.
 * With `login`, makes sure the guardian has a parent app login: mobile number, initial password = mobile.
 * Returns whether a NEW login was created (so the office can tell the parent).
 */
export async function ensureGuardian(tx: Tx, schoolId: string, g: GuardianData, login: boolean) {
  const details = {
    name: g.name,
    relation: g.relation,
    email: g.email ?? null,
    occupation: g.occupation ?? null,
    qualification: g.qualification ?? null,
    annualIncome: g.annualIncome ?? null,
    aadhaarNo: g.aadhaarNo ?? null,
    address: g.address ?? null,
  };
  // Siblings share a guardian: same mobile AND same relation (a mother without her own mobile
  // is saved with the family number but must stay a separate person from the father).
  let guardian = g.phone ? await tx.guardian.findFirst({ where: { schoolId, phone: g.phone, relation: g.relation } }) : null;
  let loginCreated = false;
  if (!guardian) {
    guardian = await tx.guardian.create({ data: { ...details, schoolId, phone: g.phone ?? '' } });
  }
  if (login && g.phone && !guardian.userId) {
    const parentRole = await tx.role.findFirstOrThrow({ where: { schoolId, kind: 'PARENT' } });
    let user = await tx.user.findUnique({ where: { phone: g.phone } });
    if (user && user.schoolId !== schoolId) throw conflict('This mobile number is registered with another school');
    if (!user) {
      user = await tx.user.create({
        data: { schoolId, name: g.name, phone: g.phone, passwordHash: await bcrypt.hash(g.phone, 10), roles: { create: { roleId: parentRole.id } } },
      });
      loginCreated = true;
    } else {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: parentRole.id } },
        create: { userId: user.id, roleId: parentRole.id },
        update: {},
      });
    }
    // One login can belong to one guardian record; a staff member who is also a parent keeps their login.
    if (!(await tx.guardian.findUnique({ where: { userId: user.id } }))) {
      guardian = await tx.guardian.update({ where: { id: guardian.id }, data: { userId: user.id } });
    }
  }
  return { guardian, loginCreated };
}
