/**
 * Every permission key in the system. Routes declare which key they need,
 * and the Principal ticks keys on custom roles (Accountant, Receptionist ...).
 */
export const PERMISSION_GROUPS = {
  School: {
    'school.manage': 'Edit school profile & settings',
    'academic.manage': 'Manage sessions, classes, sections & subjects',
  },
  Users: {
    'users.view': 'View staff & users',
    'users.manage': 'Create / edit staff users, reset passwords',
    'roles.manage': 'Create roles & assign permissions',
  },
  Students: {
    'students.view': 'View students',
    'students.manage': 'Add / edit students & admissions',
  },
  Fees: {
    'fees.view': 'View fees & dues',
    'fees.collect': 'Collect fees & print receipts',
    'fees.manage': 'Set up fee heads & structures',
  },
  Attendance: {
    'attendance.mark': 'Mark attendance',
    'attendance.view': 'View attendance reports',
    'staff-attendance.manage': 'Mark / edit staff attendance',
  },
  Homework: { 'homework.manage': 'Post homework' },
  Exams: {
    'exams.manage': 'Create exams & date sheets',
    'marks.enter': 'Enter marks',
  },
  Certificates: { 'certificates.issue': 'Issue TC / CC / DOB certificates, I-cards, admit cards' },
  Timetable: { 'timetable.manage': 'Manage timetable' },
  Staff: { 'payroll.manage': 'Manage salary & payslips' },
  Accounts: {
    'accounts.manage': 'Manage income / expense ledger',
    'inventory.manage': 'Manage inventory',
  },
  Communication: { 'notices.manage': 'Publish notices & send SMS' },
  Reports: { 'reports.view': 'View & export reports' },
} as const;

type Groups = typeof PERMISSION_GROUPS;
export type Permission = { [G in keyof Groups]: keyof Groups[G] }[keyof Groups];

export const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flatMap((g) =>
  Object.keys(g),
) as Permission[];

/** The three fixed views of the app. Custom roles are always STAFF kind. */
export const ROLE_KINDS = ['PRINCIPAL', 'TEACHER', 'PARENT', 'STAFF'] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

export const DEFAULT_ROLE_PERMISSIONS: Record<'PRINCIPAL' | 'TEACHER' | 'PARENT', Permission[]> = {
  PRINCIPAL: ALL_PERMISSIONS,
  TEACHER: ['students.view', 'attendance.mark', 'attendance.view', 'homework.manage', 'marks.enter'],
  PARENT: [],
};
