import type { ExamResultStatus, GradeBand } from '@erp/shared';
import type { TagColor } from '../../components/ui';

export type SubjectType = 'SCHOLASTIC' | 'CO_SCHOLASTIC';

export interface Exam {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  order: number;
  resultPublished: boolean;
}

export interface ExamListItem extends Exam {
  classesScheduled: number;
  totalClasses: number;
  papers: number;
  marksExpected: number;
  marksEntered: number;
  firstPaper: string | null;
  lastPaper: string | null;
}

export interface ScopeSection {
  id: string;
  label: string;
  classId: string;
  className: string;
  isClassTeacher: boolean;
  canViewResults: boolean;
  canPrintAdmitCards: boolean;
  students: number;
  subjects: { id: string; name: string; type: SubjectType; canEnter: boolean }[];
}

export interface ExamScope {
  session: { id: string; name: string };
  canManage: boolean;
  marksAnywhere: boolean;
  exams: Exam[];
  sections: ScopeSection[];
}

export interface ExamDetail extends Exam {
  session: { id: string; name: string; startDate: string; endDate: string };
  isFinal: boolean;
  firstPaper: string | null;
  lastPaper: string | null;
  canManage: boolean;
  classes: { id: string; name: string; subjects: number; scheduled: number; marks: number; sections: { id: string; label: string }[] }[];
}

export interface ClassSchedule {
  exam: Exam;
  class: { id: string; name: string };
  canEdit: boolean;
  subjects: {
    subjectId: string;
    name: string;
    type: SubjectType;
    inClass: boolean;
    scheduled: boolean;
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    maxMarks: number;
    passMarks: number;
    marksCount: number;
  }[];
}

export interface DateSheetLine {
  subjectId: string;
  name: string;
  type: SubjectType;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  maxMarks?: number;
  passMarks?: number;
}

export interface AllSchedules {
  exam: Exam;
  classes: { classId: string; className: string; entries: DateSheetLine[] }[];
}

export interface Progress {
  exam: Exam;
  sections: {
    id: string;
    label: string;
    classId: string;
    isClassTeacher: boolean;
    canViewResults: boolean;
    students: number;
    remarks: number | null;
    subjects: { subjectId: string; name: string; type: SubjectType; scheduled: boolean; date: string | null; entered: number }[];
  }[];
}

export interface MarkCell {
  marks: number | null;
  grade: string | null;
  isAbsent: boolean;
}

export interface ResultSubject {
  scheduleId: string;
  subjectId: string;
  name: string;
  type: SubjectType;
  maxMarks: number;
  passMarks: number;
  date: string | null;
}

export interface StudentResult {
  studentId: string;
  rollNo: number | null;
  admissionNo: string;
  name: string;
  marks: Record<string, MarkCell | null>;
  total: number;
  maxTotal: number;
  percent: number | null;
  grade: string | null;
  rank: number | null;
  result: ExamResultStatus;
  failedSubjects: string[];
  pendingSubjects: number;
}

export interface ResultSheet {
  exam: Exam;
  session: { id: string; name: string };
  section: { id: string; label: string };
  classTeacher: string | null;
  canManage: boolean;
  scale: GradeBand[];
  subjects: ResultSubject[];
  students: StudentResult[];
  hasMarks: boolean;
  highlights: {
    students: number;
    passed: number;
    failed: number;
    pending: number;
    passPercent: number | null;
    classAverage: number | null;
    toppers: { studentId: string; name: string; total: number; percent: number | null }[];
    gradeCounts: Record<string, number>;
    subjects: {
      subjectId: string;
      name: string;
      type: SubjectType;
      entered: number;
      maxMarks?: number;
      absent?: number;
      average?: number | null;
      highest?: number | null;
      lowest?: number | null;
      passed?: number;
      failed?: number;
      grades?: Record<string, number>;
    }[];
  };
}

export interface ReportCards {
  exam: Exam;
  session: { id: string; name: string };
  section: { id: string; label: string; className: string };
  classTeacher: string | null;
  cumulative: boolean;
  scale: GradeBand[];
  exams: (Exam & { subjects: Record<string, { maxMarks: number; passMarks: number }> })[];
  subjects: { subjectId: string; name: string; type: SubjectType }[];
  cards: {
    studentId: string;
    name: string;
    rollNo: number | null;
    admissionNo: string;
    dob: string | null;
    photoUrl: string | null;
    fatherName: string | null;
    motherName: string | null;
    guardianName: string | null;
    results: {
      examId: string;
      marks: Record<string, MarkCell | null>;
      total: number;
      maxTotal: number;
      percent: number | null;
      grade: string | null;
      rank: number | null;
      result: ExamResultStatus;
      failedSubjects: string[];
    }[];
    attendance: { workingDays: number; present: number; percent: number | null } | null;
    remark: string | null;
  }[];
}

export interface AdmitCards {
  exam: Exam;
  session: { id: string; name: string };
  section: { id: string; label: string };
  dateSheet: DateSheetLine[];
  cards: {
    studentId: string;
    name: string;
    rollNo: number | null;
    admissionNo: string;
    dob: string | null;
    photoUrl: string | null;
    fatherName: string | null;
  }[];
}

export interface ChildExams {
  session: { id: string; name: string } | null;
  classLabel?: string;
  exams: (Exam & { dateSheet: DateSheetLine[] })[];
}

export const RESULT_TAG: Record<ExamResultStatus, { label: string; color: TagColor }> = {
  PASS: { label: 'Pass', color: 'green' },
  FAIL: { label: 'Fail', color: 'red' },
  PENDING: { label: 'Pending', color: 'gray' },
};

/** "72.5" / "72" for marks. */
export const fmtMarks = (n: number | null | undefined) => (n == null ? '' : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Exam date range, e.g. "21 Sep – 1 Oct 2026". */
export function examRange(from: string | null, to: string | null) {
  const f = (d: string, y: boolean) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}) });
  if (!from && !to) return 'Dates not set';
  if (!from || !to || from === to) return f((from ?? to)!, true);
  return `${f(from, from.slice(0, 4) !== to.slice(0, 4))} – ${f(to, true)}`;
}

/** "09:00" → "9:00 AM" */
export function fmtClock(t: string | null | undefined) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const timeRange = (a: string | null, b: string | null) => (a ? `${fmtClock(a)}${b ? ` – ${fmtClock(b)}` : ''}` : '—');

/** Cell text for a mark: "AB", "72.5", grade letter, or "" when not entered. */
export function cellText(c: MarkCell | null | undefined, type: SubjectType) {
  if (!c) return '';
  if (c.isAbsent) return 'AB';
  return type === 'CO_SCHOLASTIC' ? (c.grade ?? '') : fmtMarks(c.marks);
}
