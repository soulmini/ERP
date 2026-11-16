import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Lock, Search } from 'lucide-react';
import { marksError, type GradeBand } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Select, Tag } from '../../components/ui';
import { cn, fmtDate, fmtTime } from '../../lib/utils';
import { useExamScope } from './Home';
import { fmtMarks, timeRange, type Exam, type SubjectType } from './types';

interface MarksGrid {
  exam: Exam;
  section: { id: string; label: string };
  subject: { id: string; name: string; type: SubjectType };
  schedule: { id: string; date: string | null; startTime: string | null; endTime: string | null; maxMarks: number; passMarks: number } | null;
  scale: GradeBand[];
  editable: boolean;
  lockedReason: string | null;
  savedAt: string | null;
  savedBy: string | null;
  students: { studentId: string; rollNo: number | null; admissionNo: string; name: string; marks: number | null; grade: string | null; isAbsent: boolean }[];
}

interface Entry {
  text: string;
  grade: string;
  absent: boolean;
}

const entryOf = (s: MarksGrid['students'][number]): Entry => ({ text: fmtMarks(s.marks), grade: s.grade ?? '', absent: s.isAbsent });

export function MarksEntryPage() {
  const { examId } = useParams();
  const [params, setParams] = useSearchParams();
  const sectionId = params.get('sectionId') ?? '';
  const subjectId = params.get('subjectId') ?? '';
  const qc = useQueryClient();
  const scope = useExamScope();
  const [vals, setVals] = useState<Record<string, Entry>>({});
  const [search, setSearch] = useState('');
  const inputs = useRef<(HTMLInputElement | HTMLSelectElement | null)[]>([]);

  const q = useQuery({
    queryKey: ['exam-marks', examId, sectionId, subjectId],
    enabled: !!sectionId && !!subjectId,
    queryFn: async () => (await api.get<MarksGrid>(`/exams/${examId}/marks`, { params: { sectionId, subjectId } })).data,
  });
  useEffect(() => {
    if (q.data) setVals(Object.fromEntries(q.data.students.map((s) => [s.studentId, entryOf(s)])));
  }, [q.data]);

  const co = q.data?.subject.type === 'CO_SCHOLASTIC';
  const max = q.data?.schedule?.maxMarks ?? 100;
  const pass = q.data?.schedule?.passMarks ?? 0;
  const students = q.data?.students ?? [];

  const errorOf = (e: Entry | undefined) => {
    if (!e || e.absent || co || e.text.trim() === '') return null;
    return marksError(Number(e.text), max);
  };
  const stats = useMemo(() => {
    let entered = 0;
    let absent = 0;
    let errors = 0;
    let below = 0;
    for (const s of students) {
      const e = vals[s.studentId];
      if (!e) continue;
      if (e.absent) absent++;
      if (e.absent || (co ? !!e.grade : e.text.trim() !== '')) entered++;
      if (errorOf(e)) errors++;
      else if (!co && !e.absent && e.text.trim() !== '' && Number(e.text) < pass) below++;
    }
    return { entered, absent, errors, below };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vals, students, co, max, pass]);
  const dirty = students.some((s) => {
    const a = entryOf(s);
    const b = vals[s.studentId];
    return b && (a.absent !== b.absent || (co ? a.grade !== b.grade : (a.text === '' ? '' : Number(a.text)) !== (b.text.trim() === '' ? '' : Number(b.text))));
  });

  const save = useMutation({
    mutationFn: async () =>
      api.put(`/exams/${examId}/marks`, {
        sectionId,
        subjectId,
        entries: students.map((s) => {
          const e = vals[s.studentId] ?? { text: '', grade: '', absent: false };
          return {
            studentId: s.studentId,
            isAbsent: e.absent,
            marks: !co && !e.absent && e.text.trim() !== '' ? Number(e.text) : null,
            grade: co && !e.absent && e.grade ? e.grade : null,
          };
        }),
      }),
    onSuccess: () => {
      toast.success('Marks saved');
      qc.invalidateQueries({ queryKey: ['exam-marks', examId, sectionId] });
      qc.invalidateQueries({ queryKey: ['exam-progress', examId] });
      qc.invalidateQueries({ queryKey: ['exams'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? students.filter((x) => x.name.toLowerCase().includes(s) || String(x.rollNo ?? '') === s) : students;
  }, [students, search]);

  const section = scope.data?.sections.find((s) => s.id === sectionId);
  const set = (id: string, patch: Partial<Entry>) => setVals((v) => ({ ...v, [id]: { ...v[id], ...patch } }));
  const focusNext = (i: number) => {
    const next = inputs.current[i + 1];
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement) next.select();
    } else (document.activeElement as HTMLElement | null)?.blur();
  };

  if (!sectionId || !subjectId) return <ErrorBox error={new Error('Choose a class and subject from the exam page')} />;
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const g = q.data!;
  const editable = g.editable;

  return (
    <>
      <Link to={`/exams/${examId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> {g.exam.name}
      </Link>
      <PageHeader
        title={`${g.subject.name} · ${g.section.label}`}
        description={
          <>
            {g.exam.name}
            {g.schedule && (
              <>
                {g.schedule.date && ` · ${fmtDate(g.schedule.date, { weekday: 'short', day: 'numeric', month: 'short' })}`}
                {g.schedule.startTime && ` · ${timeRange(g.schedule.startTime, g.schedule.endTime)}`}
                {!co && ` · Max ${g.schedule.maxMarks}, pass ${g.schedule.passMarks}`}
              </>
            )}
            {g.savedAt && (
              <span className="block text-xs mt-0.5">
                Last saved {fmtDate(g.savedAt, { day: 'numeric', month: 'short' })} {fmtTime(g.savedAt)}
                {g.savedBy ? ` by ${g.savedBy}` : ''}
              </span>
            )}
          </>
        }
        actions={
          section && section.subjects.length > 1 ? (
            <Select
              className="w-auto"
              aria-label="Subject"
              value={subjectId}
              onChange={(e) => {
                if (dirty && !confirm('Discard unsaved marks?')) return;
                setParams({ sectionId, subjectId: e.target.value });
              }}
            >
              {section.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />

      {g.lockedReason && (
        <div className="flex items-center gap-2 rounded-md bg-tag-yellow text-tag-yellow-ink px-3 py-2 text-sm mb-4">
          <Lock className="size-4 shrink-0" /> {g.lockedReason}
        </div>
      )}

      {!students.length ? (
        <Card>
          <Empty icon="🎒" title="No students in this class" />
        </Card>
      ) : (
        <>
          {students.length > 8 && (
            <div className="relative mb-3">
              <Search className="size-4 text-faint absolute left-2.5 top-2.5" />
              <Input placeholder="Search name or roll no." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
          )}
          <Card className="divide-y divide-line">
            <div className="flex items-center gap-3 px-3 sm:px-4 py-2 text-xs text-muted">
              <span className="w-6 text-right">Roll</span>
              <span className="flex-1">Student</span>
              <span className="w-24 text-center">{co ? 'Grade' : `Marks /${max}`}</span>
              <span className="w-16 text-center">Absent</span>
            </div>
            {filtered.map((s) => {
              const i = students.indexOf(s);
              const e = vals[s.studentId] ?? { text: '', grade: '', absent: false };
              const err = errorOf(e);
              const low = !co && !e.absent && !err && e.text.trim() !== '' && Number(e.text) < pass;
              return (
                <div key={s.studentId} className={cn('flex items-center gap-3 px-3 sm:px-4 py-2', e.absent && 'bg-[#fffafa]')}>
                  <span className="w-6 text-right text-sm text-faint tabular-nums">{s.rollNo ?? '–'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ink-strong leading-tight truncate">{s.name}</div>
                    <div className="text-xs text-muted">
                      {err ? <span className="text-tag-red-ink">{err}</span> : low ? <span className="text-tag-orange-ink">Below pass marks</span> : s.admissionNo}
                    </div>
                  </div>
                  <div className="w-24">
                    {co ? (
                      <Select
                        ref={(el) => {
                          inputs.current[i] = el;
                        }}
                        value={e.absent ? '' : e.grade}
                        disabled={!editable || e.absent}
                        onChange={(ev) => set(s.studentId, { grade: ev.target.value })}
                        onKeyDown={(ev) => ev.key === 'Enter' && (ev.preventDefault(), focusNext(i))}
                        className="text-center"
                      >
                        <option value="">—</option>
                        {g.scale.map((b) => (
                          <option key={b.grade} value={b.grade}>
                            {b.grade}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        ref={(el) => {
                          inputs.current[i] = el;
                        }}
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        placeholder={e.absent ? 'AB' : '—'}
                        value={e.absent ? '' : e.text}
                        disabled={!editable || e.absent}
                        onChange={(ev) => set(s.studentId, { text: ev.target.value.replace(/[^\d.]/g, '') })}
                        onFocus={(ev) => ev.target.select()}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === 'ArrowDown') {
                            ev.preventDefault();
                            focusNext(i);
                          } else if (ev.key === 'ArrowUp') {
                            ev.preventDefault();
                            inputs.current[i - 1]?.focus();
                          }
                        }}
                        className={cn('text-center tabular-nums font-medium', err && 'border-[#d44c47] focus:border-[#d44c47]', low && 'text-tag-orange-ink')}
                      />
                    )}
                  </div>
                  <div className="w-16 flex justify-center">
                    <button
                      type="button"
                      disabled={!editable}
                      onClick={() => set(s.studentId, { absent: !e.absent })}
                      className={cn(
                        'h-8 w-12 rounded-md border text-xs font-semibold transition-colors disabled:opacity-50',
                        e.absent ? 'bg-tag-red text-tag-red-ink border-transparent' : 'border-line text-faint hover:bg-hover',
                      )}
                      aria-pressed={e.absent}
                      title="Mark absent"
                    >
                      AB
                    </button>
                  </div>
                </div>
              );
            })}
          </Card>

          {editable && (
            <div className="sticky bottom-20 md:bottom-4 mt-4 z-20">
              <div className="rounded-lg bg-white border border-line shadow-pop px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-1.5 flex-1">
                  <Tag color={stats.entered === students.length ? 'green' : 'gray'}>
                    Entered {stats.entered}/{students.length}
                  </Tag>
                  {stats.absent > 0 && <Tag color="red">Absent {stats.absent}</Tag>}
                  {stats.below > 0 && <Tag color="orange">Below pass {stats.below}</Tag>}
                  {stats.errors > 0 && <Tag color="red">{stats.errors} to fix</Tag>}
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  loading={save.isPending}
                  disabled={!dirty || stats.errors > 0}
                  onClick={() => save.mutate()}
                  className="w-full sm:w-auto"
                >
                  Save marks
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
