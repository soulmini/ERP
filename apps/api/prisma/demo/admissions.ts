/** Demo data: a few admission enquiries for next session. Idempotent. */
import { prisma } from '../../src/db';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const ENQUIRIES = [
  { studentName: 'Arnav Tiwari', cls: 'Nursery', guardianName: 'Sunil Tiwari', phone: '9000000301', source: 'walk-in', status: 'NEW' as const, followUpDate: '2026-11-16', notes: 'Wants to see classrooms; asked about van facility.' },
  { studentName: 'Ishita Maurya', cls: 'LKG', guardianName: 'Pankaj Maurya', phone: '9000000302', source: 'reference', status: 'FOLLOW_UP' as const, followUpDate: '2026-11-18', notes: 'Referred by Gupta family. Fee structure shared on WhatsApp.' },
  { studentName: 'Yash Pandey', cls: '1', guardianName: 'Deepak Pandey', phone: '9000000303', source: 'phone', status: 'NEW' as const, followUpDate: '2026-11-20', notes: null },
  { studentName: 'Anushka Singh', cls: '6', guardianName: 'Vijay Singh', phone: '9000000304', source: 'social media', status: 'CLOSED' as const, followUpDate: null, notes: 'Chose another school closer to home.' },
];

export async function seedDemoAdmissions(schoolId: string) {
  const classes = await prisma.class.findMany({ where: { schoolId } });
  for (const e of ENQUIRIES) {
    if (await prisma.enquiry.findFirst({ where: { schoolId, phone: e.phone } })) continue;
    await prisma.enquiry.create({
      data: {
        schoolId,
        studentName: e.studentName,
        classId: classes.find((c) => c.name === e.cls)?.id ?? null,
        guardianName: e.guardianName,
        phone: e.phone,
        source: e.source,
        status: e.status,
        followUpDate: e.followUpDate ? d(e.followUpDate) : null,
        notes: e.notes,
      },
    });
  }
}
