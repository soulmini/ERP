/** Demo data: a Bonafide and a DOB certificate, one gate pass. Idempotent. (No TC — that would mark a student as left.) */
import { certSerial, gatePassSerial } from '@erp/shared';
import { prisma } from '../../src/db';
import { nextNumber } from '../../src/lib/counters';
import { buildCertificateData, loadCertStudent } from '../../src/modules/certificates/prefill';

export async function seedDemoCertificates(schoolId: string) {
  const principal = await prisma.user.findFirst({ where: { schoolId, roles: { some: { role: { kind: 'PRINCIPAL' } } } } });
  const plan: [string, 'BONAFIDE' | 'DOB', string][] = [
    ['2026/0002', 'BONAFIDE', 'opening a bank account'],
    ['2026/0003', 'DOB', 'Aadhaar enrolment'],
  ];
  for (const [admissionNo, type, purpose] of plan) {
    const s = await prisma.student.findFirst({ where: { schoolId, admissionNo } });
    if (!s || (await prisma.issuedCertificate.findFirst({ where: { studentId: s.id, type } }))) continue;
    const full = await loadCertStudent(s.id, schoolId);
    const base = await buildCertificateData(type, full!);
    const issueDate = base.issueDate;
    const data = { ...base, purpose, currentStudent: true };
    await prisma.$transaction(async (tx) => {
      const n = await nextNumber(tx, schoolId, `cert:${type}`);
      await tx.issuedCertificate.create({
        data: {
          schoolId,
          type,
          serialNo: certSerial(type, issueDate.slice(0, 4), n),
          studentId: s.id,
          issueDate: new Date(`${issueDate}T00:00:00Z`),
          data,
          issuedById: principal?.id ?? null,
        },
      });
    });
  }

  const student = await prisma.student.findFirst({ where: { schoolId, admissionNo: '2026/0004' }, include: { guardians: { include: { guardian: true } } } });
  if (student && !(await prisma.gatePass.findFirst({ where: { schoolId, studentId: student.id } }))) {
    const g = student.guardians[0]?.guardian;
    await prisma.$transaction(async (tx) => {
      const n = await nextNumber(tx, schoolId, 'gatepass');
      await tx.gatePass.create({
        data: {
          schoolId,
          serialNo: gatePassSerial(n),
          studentId: student.id,
          personName: g?.name ?? 'Parent',
          relation: 'Father',
          phone: g?.phone ?? null,
          reason: 'Doctor appointment',
          outTime: new Date(Date.now() - 2 * 3_600_000),
          issuedById: principal?.id ?? null,
        },
      });
    });
  }
}
