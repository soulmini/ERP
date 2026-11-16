/**
 * Seed: real school setup + optional demo data.
 *   npm run db:seed                 → school, session, classes, subjects, roles, Principal
 *   SEED_DEMO=true npm run db:seed  → also demo teachers, students, parents, attendance
 * Safe to run repeatedly.
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLE_PERMISSIONS } from '@erp/shared';
import { prisma } from '../src/db';

const SCHOOL = { name: 'R.R.Y. Pre Sec School', city: 'Bumnagar', state: 'Uttar Pradesh' };
const PRINCIPAL = {
  firstName: 'Shivam',
  lastName: 'Jaiswal',
  email: process.env.SEED_PRINCIPAL_EMAIL ?? 'principal@rry.local',
  phone: process.env.SEED_PRINCIPAL_PHONE ?? '9000000001',
  password: process.env.SEED_PRINCIPAL_PASSWORD ?? 'Principal@123',
};
const CLASSES = ['Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8'];
const SUBJECTS: Record<string, string[]> = {
  pre: ['Hindi', 'English', 'Mathematics', 'Drawing', 'Rhymes & Stories'],
  primary: ['Hindi', 'English', 'Mathematics', 'EVS', 'Computer', 'GK', 'Drawing'],
  middle: ['Hindi', 'English', 'Mathematics', 'Science', 'Social Science', 'Sanskrit', 'Computer', 'GK'],
};
const subjectGroup = (c: string) => (['Nursery', 'LKG', 'UKG'].includes(c) ? 'pre' : Number(c) <= 5 ? 'primary' : 'middle');

async function seedSchool() {
  let school = await prisma.school.findFirst({ where: { name: SCHOOL.name } });
  if (school) {
    console.log('✓ School exists:', school.name);
    return school;
  }
  school = await prisma.school.create({ data: { ...SCHOOL, principalName: 'Shivam Jaiswal' } });

  await prisma.academicSession.create({
    data: {
      schoolId: school.id,
      name: '2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31'),
      isCurrent: true,
    },
  });

  const allSubjects = [...new Set(Object.values(SUBJECTS).flat())];
  await prisma.subject.createMany({
    data: allSubjects.map((name) => ({ schoolId: school!.id, name, type: name === 'Drawing' ? 'CO_SCHOLASTIC' : 'SCHOLASTIC' })),
  });
  const subjects = await prisma.subject.findMany({ where: { schoolId: school.id } });

  for (const [i, name] of CLASSES.entries()) {
    await prisma.class.create({
      data: {
        schoolId: school.id,
        name,
        order: i,
        sections: { create: [{ name: 'A', capacity: 40 }] },
        subjects: {
          create: SUBJECTS[subjectGroup(name)].map((s) => ({ subjectId: subjects.find((x) => x.name === s)!.id })),
        },
      },
    });
  }

  const principalRole = await prisma.role.create({
    data: { schoolId: school.id, name: 'Principal', kind: 'PRINCIPAL', isSystem: true, permissions: DEFAULT_ROLE_PERMISSIONS.PRINCIPAL, description: 'Full access to everything' },
  });
  await prisma.role.createMany({
    data: [
      { schoolId: school.id, name: 'Teacher', kind: 'TEACHER', isSystem: true, permissions: DEFAULT_ROLE_PERMISSIONS.TEACHER, description: 'Class teachers & subject teachers' },
      { schoolId: school.id, name: 'Parent', kind: 'PARENT', isSystem: true, permissions: [], description: 'Parents / students (view own child)' },
      { schoolId: school.id, name: 'Accountant', kind: 'STAFF', permissions: ['fees.view', 'fees.collect', 'fees.manage', 'accounts.manage', 'payroll.manage', 'students.view', 'reports.view'], description: 'Fees, accounts and salary' },
      { schoolId: school.id, name: 'Receptionist', kind: 'STAFF', permissions: ['students.view', 'students.manage', 'fees.view', 'fees.collect', 'certificates.issue'], description: 'Admissions & front office' },
    ],
  });

  await prisma.staff.create({
    data: {
      school: { connect: { id: school.id } },
      employeeCode: 'EMP001',
      firstName: PRINCIPAL.firstName,
      lastName: PRINCIPAL.lastName,
      gender: 'MALE',
      designation: 'Principal',
      phone: PRINCIPAL.phone,
      email: PRINCIPAL.email,
      user: {
        create: {
          schoolId: school.id,
          name: `${PRINCIPAL.firstName} ${PRINCIPAL.lastName}`,
          email: PRINCIPAL.email,
          phone: PRINCIPAL.phone,
          passwordHash: await bcrypt.hash(PRINCIPAL.password, 10),
          roles: { create: { roleId: principalRole.id } },
        },
      },
    },
  });
  console.log('✓ Created school, session 2026-27, classes, subjects, roles, Principal');
  return school;
}

// ───────────────────────── Demo data ─────────────────────────

const DEMO_TEACHERS = [
  { firstName: 'Anita', lastName: 'Verma', gender: 'FEMALE' as const, phone: '9000000011', cls: '5' },
  { firstName: 'Rakesh', lastName: 'Yadav', gender: 'MALE' as const, phone: '9000000012', cls: '3' },
];
const BOYS = ['Aarav', 'Vivaan', 'Aditya', 'Krishna', 'Arjun', 'Ishaan', 'Rohan', 'Kabir', 'Ayaan', 'Dev'];
const GIRLS = ['Ananya', 'Diya', 'Saanvi', 'Priya', 'Kavya', 'Riya', 'Aditi', 'Pooja', 'Neha', 'Sneha'];
const SURNAMES = ['Sharma', 'Gupta', 'Yadav', 'Singh', 'Mishra', 'Patel', 'Verma', 'Tiwari', 'Pandey', 'Maurya'];
const FATHERS = ['Ramesh', 'Suresh', 'Mahesh', 'Dinesh', 'Rajesh', 'Mukesh', 'Rakesh', 'Naresh', 'Umesh', 'Ganesh', 'Sanjay', 'Vijay', 'Ajay', 'Manoj', 'Anil', 'Sunil', 'Pankaj', 'Deepak', 'Ashok', 'Vinod'];

async function seedDemo(schoolId: string) {
  if (await prisma.user.findUnique({ where: { phone: DEMO_TEACHERS[0].phone } })) {
    console.log('✓ Demo data exists');
    return;
  }
  const session = await prisma.academicSession.findFirstOrThrow({ where: { schoolId, isCurrent: true } });
  const teacherRole = await prisma.role.findFirstOrThrow({ where: { schoolId, kind: 'TEACHER' } });
  const parentRole = await prisma.role.findFirstOrThrow({ where: { schoolId, kind: 'PARENT' } });
  const sectionOf = (cls: string) =>
    prisma.section.findFirstOrThrow({ where: { name: 'A', class: { schoolId, name: cls } } });

  let emp = await prisma.staff.count({ where: { schoolId } });
  for (const t of DEMO_TEACHERS) {
    const staff = await prisma.staff.create({
      data: {
        school: { connect: { id: schoolId } },
        employeeCode: `EMP${String(++emp).padStart(3, '0')}`,
        firstName: t.firstName,
        lastName: t.lastName,
        gender: t.gender,
        designation: 'Teacher',
        phone: t.phone,
        user: {
          create: {
            schoolId,
            name: `${t.firstName} ${t.lastName}`,
            phone: t.phone,
            passwordHash: await bcrypt.hash('Teacher@123', 10),
            roles: { create: { roleId: teacherRole.id } },
          },
        },
      },
    });
    await prisma.section.update({ where: { id: (await sectionOf(t.cls)).id }, data: { classTeacherId: staff.id } });
  }

  // Students: 12 in class 5-A, 8 in class 3-A. First guardian has two children (5-A and 3-A).
  let adm = await prisma.student.count({ where: { schoolId } });
  const plan = [...Array(12).fill('5'), ...Array(8).fill('3')];
  const passwordFor = new Map<string, string>();
  for (const [i, cls] of plan.entries()) {
    const section = await sectionOf(cls);
    const girl = i % 2 === 1;
    const surname = SURNAMES[i % SURNAMES.length];
    const phone = i === 12 ? '9000000100' : `90000001${String(i).padStart(2, '0')}`; // i=12 → sibling of i=0
    const guardianSurname = i === 12 ? SURNAMES[0] : surname;
    let guardian = await prisma.guardian.findFirst({ where: { schoolId, phone } });
    if (!guardian) {
      const hash = passwordFor.get(phone) ?? (await bcrypt.hash(phone, 10));
      passwordFor.set(phone, hash);
      guardian = await prisma.guardian.create({
        data: {
          school: { connect: { id: schoolId } },
          name: `${FATHERS[i]} ${guardianSurname}`,
          phone,
          relation: 'FATHER',
          user: {
            create: {
              schoolId,
              name: `${FATHERS[i]} ${guardianSurname}`,
              phone,
              passwordHash: hash,
              roles: { create: { roleId: parentRole.id } },
            },
          },
        },
      });
    }
    const age = cls === '5' ? 10 : 8;
    await prisma.student.create({
      data: {
        schoolId,
        admissionNo: `2026/${String(++adm).padStart(4, '0')}`,
        firstName: girl ? GIRLS[Math.floor(i / 2)] : BOYS[Math.floor(i / 2)],
        lastName: i === 12 ? SURNAMES[0] : surname,
        gender: girl ? 'FEMALE' : 'MALE',
        dob: new Date(Date.UTC(2026 - age, i % 12, 1 + (i % 27))),
        address: 'Bumnagar',
        guardians: { create: { guardianId: guardian.id, isPrimary: true } },
        enrollments: {
          create: { sessionId: session.id, sectionId: section.id, rollNo: cls === '5' ? i + 1 : i - 11 },
        },
      },
    });
  }

  // Past 6 school days of attendance for class 5-A so dashboards and reports have data.
  const section5 = await sectionOf('5');
  const enrolled = await prisma.enrollment.findMany({ where: { sectionId: section5.id, sessionId: session.id } });
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00Z');
  const days: Date[] = [];
  for (let d = 1; days.length < 6 && d < 14; d++) {
    const day = new Date(today.getTime() - d * 86_400_000);
    if (day.getUTCDay() !== 0) days.push(day); // skip Sundays
  }
  const teacher = section5.classTeacherId;
  await prisma.studentAttendance.createMany({
    data: days.flatMap((date, di) =>
      enrolled.map((e, ei) => ({
        schoolId,
        sessionId: session.id,
        sectionId: section5.id,
        studentId: e.studentId,
        date,
        status: (ei + di) % 9 === 0 ? 'ABSENT' : (ei + di) % 13 === 0 ? 'LATE' : 'PRESENT',
        source: di % 2 ? 'APP' : 'WEB',
        markedById: teacher,
      }) as const),
    ),
  });
  console.log('✓ Demo data: 2 teachers, 20 students, parents, 6 days of attendance for 5-A');
}

/**
 * Module demo data lives in prisma/demo/<module>.ts, each exporting an idempotent
 * `seedDemo<Module>(schoolId)` function. Run in dependency order; missing files are skipped.
 */
const DEMO_MODULES = ['admissions', 'fees', 'communication', 'exams', 'certificates', 'finance'];

async function seedModuleDemos(schoolId: string) {
  for (const name of DEMO_MODULES) {
    const file = new URL(`./demo/${name}.ts`, import.meta.url);
    if (!existsSync(file)) continue;
    const mod: Record<string, unknown> = await import(file.href);
    for (const [fnName, fn] of Object.entries(mod)) {
      if (fnName.startsWith('seedDemo') && typeof fn === 'function') {
        await (fn as (schoolId: string) => Promise<unknown>)(schoolId);
        console.log(`✓ Demo data: ${name}`);
      }
    }
  }
}

async function main() {
  const school = await seedSchool();
  if (process.env.SEED_DEMO === 'true') {
    await seedDemo(school.id);
    await seedModuleDemos(school.id);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
