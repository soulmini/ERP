import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface ClassRow {
  id: string;
  name: string;
  order: number;
  sections: {
    id: string;
    name: string;
    capacity: number | null;
    classTeacherId: string | null;
    classTeacher: { id: string; firstName: string; lastName: string | null } | null;
    studentCount: number;
  }[];
  subjects: { id: string; name: string }[];
}

export interface StaffRow {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  designation: string;
  phone: string;
  email: string | null;
  joiningDate: string | null;
  isActive: boolean;
  user: { id: string; isActive: boolean; lastLoginAt: string | null } | null;
  roles: { id: string; name: string; kind: string }[];
  classTeacherOf: { id: string; label: string }[];
}

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  kind: 'PRINCIPAL' | 'TEACHER' | 'PARENT' | 'STAFF';
  permissions: string[];
  isSystem: boolean;
  userCount: number;
}

export const useClasses = () =>
  useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get<ClassRow[]>('/academic/classes')).data });

export const useStaff = (enabled = true) =>
  useQuery({ queryKey: ['staff'], enabled, queryFn: async () => (await api.get<StaffRow[]>('/users/staff')).data });

export const useRoles = () =>
  useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get<RoleRow[]>('/users/roles')).data });

/** Flat list of "5-A" style section options. */
export function sectionOptions(classes: ClassRow[] | undefined) {
  return (classes ?? []).flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${c.name}-${s.name}`, classId: c.id })));
}

export const staffName = (s: { firstName: string; lastName: string | null }) => `${s.firstName} ${s.lastName ?? ''}`.trim();
