import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Lock } from 'lucide-react';
import type { ExamResultStatus } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Tag, Textarea } from '../../components/ui';
import { RESULT_TAG, type Exam } from './types';

interface RemarksData {
  exam: Exam;
  section: { id: string; label: string };
  editable: boolean;
  lockedReason: string | null;
  students: {
    studentId: string;
    rollNo: number | null;
    admissionNo: string;
    name: string;
    percent: number | null;
    grade: string | null;
    result: ExamResultStatus;
    failedSubjects: string[];
    remark: string | null;
  }[];
}

const SUGGESTIONS = [
  'Excellent performance. Keep it up!',
  'Good effort. Can do even better.',
  'Regular and attentive in class.',
  'Needs to work harder in weak subjects.',
  'Must complete homework on time.',
  'Practise handwriting daily.',
];

/** Class teacher's remarks for the report card. */
export function RemarksPage() {
  const { examId } = useParams();
  const [params] = useSearchParams();
  const sectionId = params.get('sectionId') ?? '';
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['exam-remarks', examId, sectionId],
    queryFn: async () => (await api.get<RemarksData>(`/exams/${examId}/remarks`, { params: { sectionId } })).data,
  });
  useEffect(() => {
    if (q.data) setVals(Object.fromEntries(q.data.students.map((s) => [s.studentId, s.remark ?? ''])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: async () =>
      api.put(`/exams/${examId}/remarks`, {
        sectionId,
        entries: q.data!.students.map((s) => ({ studentId: s.studentId, remark: (vals[s.studentId] ?? '').trim() || null })),
      }),
    onSuccess: () => {
      toast.success('Remarks saved');
      qc.invalidateQueries({ queryKey: ['exam-remarks', examId, sectionId] });
      qc.invalidateQueries({ queryKey: ['exam-progress', examId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const dirty = d.students.some((s) => (vals[s.studentId] ?? '').trim() !== (s.remark ?? ''));
  const filled = d.students.filter((s) => (vals[s.studentId] ?? '').trim()).length;

  return (
    <>
      <Link to={`/exams/${examId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> {d.exam.name}
      </Link>
      <PageHeader title={`Remarks · ${d.section.label}`} description={`${d.exam.name} · printed on the report card`} />
      {d.lockedReason && (
        <div className="flex items-center gap-2 rounded-md bg-tag-yellow text-tag-yellow-ink px-3 py-2 text-sm mb-4">
          <Lock className="size-4 shrink-0" /> {d.lockedReason}
        </div>
      )}
      {!d.students.length ? (
        <Empty icon="🎒" title="No students in this class" />
      ) : (
        <>
          <Card className="divide-y divide-line">
            {d.students.map((s) => (
              <div key={s.studentId} className="px-3 sm:px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="w-6 text-right text-sm text-faint tabular-nums">{s.rollNo ?? '–'}</span>
                  <span className="font-medium text-ink-strong">{s.name}</span>
                  <span className="ml-auto flex gap-1.5">
                    {s.percent != null && (
                      <Tag color="blue">
                        {s.percent}% {s.grade}
                      </Tag>
                    )}
                    <Tag color={RESULT_TAG[s.result].color}>{RESULT_TAG[s.result].label}</Tag>
                  </span>
                </div>
                {s.failedSubjects.length > 0 && <div className="text-xs text-tag-red-ink mb-1.5 ml-8">Below pass marks: {s.failedSubjects.join(', ')}</div>}
                <Textarea
                  rows={2}
                  maxLength={300}
                  disabled={!d.editable}
                  placeholder="Remark for the report card"
                  value={vals[s.studentId] ?? ''}
                  onFocus={() => setFocused(s.studentId)}
                  onChange={(e) => setVals((v) => ({ ...v, [s.studentId]: e.target.value }))}
                />
                {d.editable && focused === s.studentId && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {SUGGESTIONS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setVals((v) => ({ ...v, [s.studentId]: [v[s.studentId]?.trim(), t].filter(Boolean).join(' ') }))}
                        className="text-xs rounded-full border border-line px-2 py-0.5 text-muted hover:bg-hover"
                      >
                        + {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
          {d.editable && (
            <div className="sticky bottom-20 md:bottom-4 mt-4 z-20">
              <div className="rounded-lg bg-white border border-line shadow-pop px-4 py-3 flex flex-wrap items-center gap-3">
                <span className="flex-1 text-sm text-muted">
                  {filled}/{d.students.length} students have a remark
                </span>
                <Button variant="primary" size="lg" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()} className="w-full sm:w-auto">
                  Save remarks
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
