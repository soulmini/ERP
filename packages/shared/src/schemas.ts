import { z } from 'zod';
import { ALL_PERMISSIONS } from './permissions';

const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
const optionalStr = z.string().trim().optional().or(z.literal('').transform(() => undefined));

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter email or mobile number'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const schoolSchema = z.object({
  name: z.string().trim().min(2),
  code: optionalStr,
  affiliation: optionalStr,
  address: optionalStr,
  city: optionalStr,
  state: optionalStr,
  pincode: optionalStr,
  phone: optionalStr,
  email: z.string().trim().email().optional().or(z.literal('').transform(() => undefined)),
  website: optionalStr,
  principalName: optionalStr,
});
export type SchoolInput = z.infer<typeof schoolSchema>;

export const sessionSchema = z.object({
  name: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Format: 2026-27'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isCurrent: z.boolean().optional(),
});
export type SessionInput = z.infer<typeof sessionSchema>;

export const classSchema = z.object({
  name: z.string().trim().min(1),
  order: z.coerce.number().int().min(0),
  sections: z.array(z.string().trim().min(1)).optional(),
});
export type ClassInput = z.infer<typeof classSchema>;

export const sectionSchema = z.object({
  name: z.string().trim().min(1),
  capacity: z.coerce.number().int().positive().optional(),
  classTeacherId: z.string().nullable().optional(),
});
export type SectionInput = z.infer<typeof sectionSchema>;

export const subjectSchema = z.object({
  name: z.string().trim().min(1),
  code: optionalStr,
  type: z.enum(['SCHOLASTIC', 'CO_SCHOLASTIC']).default('SCHOLASTIC'),
});
export type SubjectInput = z.infer<typeof subjectSchema>;

export const classSubjectSchema = z.object({
  subjectIds: z.array(z.string()),
});

export const roleSchema = z.object({
  name: z.string().trim().min(2),
  description: optionalStr,
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
});
export type RoleInput = z.infer<typeof roleSchema>;

export const staffUserSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: optionalStr,
  phone,
  email: z.string().trim().email().optional().or(z.literal('').transform(() => undefined)),
  designation: z.string().trim().min(1),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  joiningDate: z.union([z.literal('').transform(() => undefined), z.coerce.date()]).optional(),
  roleIds: z.array(z.string()).min(1, 'Select at least one role'),
  password: z.string().min(6).optional(),
});
export type StaffUserInput = z.infer<typeof staffUserSchema>;

export const resetPasswordSchema = z.object({ password: z.string().min(6) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'At least 6 characters'),
});

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM');
export const monthSchema = month;
export const dateOnlySchema = dateOnly;

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_SOURCES = ['WEB', 'APP', 'SELF'] as const;

export const markStudentAttendanceSchema = z.object({
  date: dateOnly,
  source: z.enum(ATTENDANCE_SOURCES).default('WEB'),
  entries: z
    .array(
      z.object({
        studentId: z.string(),
        status: z.enum(ATTENDANCE_STATUSES),
        remark: z.string().trim().max(200).optional(),
      }),
    )
    .min(1),
});
export type MarkStudentAttendanceInput = z.infer<typeof markStudentAttendanceSchema>;

export const markStaffAttendanceSchema = z.object({
  date: dateOnly,
  entries: z
    .array(
      z.object({
        staffId: z.string(),
        status: z.enum(ATTENDANCE_STATUSES),
        remark: z.string().trim().max(200).optional(),
      }),
    )
    .min(1),
});
export type MarkStaffAttendanceInput = z.infer<typeof markStaffAttendanceSchema>;

/** Quick admission (full admission form arrives in Phase 2). */
export const studentQuickSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: optionalStr,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dob: dateOnly,
  sectionId: z.string().min(1, 'Select class & section'),
  rollNo: z.coerce.number().int().positive().optional(),
  admissionNo: optionalStr,
  address: optionalStr,
  guardianName: z.string().trim().min(1),
  guardianRelation: z.enum(['FATHER', 'MOTHER', 'GUARDIAN']).default('FATHER'),
  guardianPhone: phone,
});
export type StudentQuickInput = z.infer<typeof studentQuickSchema>;
