import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { sectionOptions, useClasses } from '../../lib/queries';
import { Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Tag } from '../../components/ui';
import { todayStr } from '../../lib/utils';

interface Session {
  id: string;
  name: string;
  isCurrent: boolean;
}
interface Row {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  alreadyIn: string | null;
}

export function PromotePage() {
  const qc = useQueryClient();
  const classes = useClasses();
  const options = sectionOptions(classes.data);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: async () => (await api.get<Session[]>('/academic/sessions')).data });
  const next = (sessions.data ?? []).filter((s) => !s.isCurrent);
  const [source, setSource] = useState('');
  const [targetSession, setTargetSession] = useState('');
  const [target, setTarget] = useState('');
  const [rollMode, setRollMode] = useState<'KEEP' | 'ALPHA'>('KEEP');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const students = useQuery({
    queryKey: ['promote', source, targetSession],
    enabled: !!source,
    queryFn: async () => (await api.get<Row[]>('/admissions/promote/students', { params: { sectionId: source, targetSessionId: targetSession || undefined } })).data,
  });
  useEffect(() => {
    if (students.data) setPicked(new Set(students.data.filter((s) => !s.alreadyIn).map((s) => s.studentId)));
  }, [students.data]);
  useEffect(() => {
    if (!targetSession && next.length) setTargetSession(next[0].id);
  }, [next, targetSession]);
  // Default target: the class after the source class.
  useEffect(() => {
    const i = options.findIndex((o) => o.id === source);
    if (i >= 0 && options[i + 1]) setTarget(options[i + 1].id);
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  const promote = useMutation({
    mutationFn: async () =>
      (await api.post<{ promoted: number; skipped: number }>('/admissions/promote', {
        sourceSectionId: source,
        targetSessionId: targetSession,
        targetSectionId: target,
        studentIds: [...picked],
        rollMode,
      })).data,
    onSuccess: (d) => (toast.success(`Promoted ${d.promoted} students${d.skipped ? ` · ${d.skipped} already had a class` : ''}`), qc.invalidateQueries({ queryKey: ['promote'] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const passOut = useMutation({
    mutationFn: async () => (await api.post<{ passedOut: number }>('/admissions/pass-out', { sourceSectionId: source, studentIds: [...picked], date: todayStr(), reason: 'Completed the highest class' })).data,
    onSuccess: (d) => (toast.success(`${d.passedOut} students marked as passed out`), qc.invalidateQueries({ queryKey: ['promote'] }), qc.invalidateQueries({ queryKey: ['students'] })),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = (id: string) => setPicked((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const isLast = options.length > 0 && options[options.length - 1].id === source;

  return (
    <>
      <Link to="/admissions" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Admissions
      </Link>
      <PageHeader icon="🎓" title="Promote students" description="At the end of the year, move each class into the next session. Create the next session first in Classes & subjects → Sessions." />
      {!sessions.isLoading && !next.length && (
        <div className="rounded-md bg-tag-yellow text-tag-yellow-ink px-3 py-2 text-sm mb-4">
          There is no next session yet. <Link className="underline" to="/academic">Create session 2027-28</Link> first.
        </div>
      )}
      <Card className="p-4 mb-4 grid sm:grid-cols-4 gap-3 items-end">
        <Field label="From class (this session)">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To session">
          <Select value={targetSession} onChange={(e) => setTargetSession(e.target.value)} disabled={!next.length}>
            {next.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To class">
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Roll numbers">
          <Select value={rollMode} onChange={(e) => setRollMode(e.target.value as 'KEEP' | 'ALPHA')}>
            <option value="KEEP">Keep same</option>
            <option value="ALPHA">Re-number A–Z</option>
          </Select>
        </Field>
      </Card>
      {!source ? (
        <Empty icon="🎓" title="Choose the class to promote" />
      ) : students.isLoading ? (
        <Loading />
      ) : !students.data?.length ? (
        <Empty title="No active students in this class" />
      ) : (
        <>
          <Card className="divide-y divide-line mb-4">
            {students.data.map((s) => (
              <label key={s.studentId} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer">
                <Input type="checkbox" className="!w-4 !h-4" checked={picked.has(s.studentId)} disabled={!!s.alreadyIn} onChange={() => toggle(s.studentId)} />
                <span className="w-6 text-faint text-sm">{s.rollNo}</span>
                <span className="flex-1 font-medium text-ink-strong">{s.name}</span>
                <span className="text-xs text-muted">{s.admissionNo}</span>
                {s.alreadyIn && <Tag color="green">Already in {s.alreadyIn}</Tag>}
              </label>
            ))}
          </Card>
          <div className="flex flex-wrap gap-2 justify-end">
            {isLast && (
              <Button loading={passOut.isPending} disabled={!picked.size} onClick={() => confirm(`Mark ${picked.size} students as passed out?`) && passOut.mutate()}>
                Mark {picked.size} as passed out
              </Button>
            )}
            <Button variant="primary" size="lg" disabled={!picked.size || !target || !targetSession} loading={promote.isPending} onClick={() => promote.mutate()}>
              Promote {picked.size} students
            </Button>
          </div>
        </>
      )}
    </>
  );
}
