import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Wand2 } from 'lucide-react';
import { examScheduleEntrySchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, SectionTitle, Table, Tag } from '../../components/ui';
import { cn, fmtDate } from '../../lib/utils';
import { timeRange, type AllSchedules, type ClassSchedule, type ExamDetail } from './types';

export function DateSheetTab({ exam }: { exam: ExamDetail }) {
  return exam.canManage ? <DateSheetEditor exam={exam} /> : <DateSheetView examId={exam.id} />;
}

/** Read-only date sheets of all classes (teachers). */
export function DateSheetView({ examId }: { examId: string }) {
  const q = useQuery({
    queryKey: ['exam-schedule-all', examId],
    queryFn: async () => (await api.get<AllSchedules>(`/exams/${examId}/schedule`)).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data!.classes.length)
    return (
      <Card>
        <Empty icon="🗓️" title="Date sheet not ready">The exam admin has not made the date sheet yet.</Empty>
      </Card>
    );
  return (
    <>
      {q.data!.classes.map((c) => (
        <div key={c.classId}>
          <SectionTitle>Class {c.className}</SectionTitle>
          <Card className="divide-y divide-line">
            {c.entries.map((e) => (
              <div key={e.subjectId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="w-28 shrink-0 text-muted">{e.date ? fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</div>
                <div className="flex-1 font-medium text-ink-strong">{e.name}</div>
                <div className="text-xs text-muted text-right">
                  {timeRange(e.startTime, e.endTime)}
                  {e.maxMarks != null && <div>Max {e.maxMarks}</div>}
                </div>
              </div>
            ))}
          </Card>
        </div>
      ))}
    </>
  );
}

interface Row {
  subjectId: string;
  name: string;
  type: 'SCHOLASTIC' | 'CO_SCHOLASTIC';
  inClass: boolean;
  include: boolean;
  date: string;
  startTime: string;
  endTime: string;
  maxMarks: string;
  passMarks: string;
  marksCount: number;
}

function DateSheetEditor({ exam }: { exam: ExamDetail }) {
  const qc = useQueryClient();
  const [classId, setClassId] = useState(() => exam.classes.find((c) => c.scheduled)?.id ?? exam.classes[0]?.id ?? '');
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState({ startTime: '', endTime: '', maxMarks: '', passMarks: '' });
  const [copyOpen, setCopyOpen] = useState(false);

  const q = useQuery({
    queryKey: ['exam-schedule', exam.id, classId],
    enabled: !!classId,
    queryFn: async () => (await api.get<ClassSchedule>(`/exams/${exam.id}/schedule`, { params: { classId } })).data,
  });
  useEffect(() => {
    if (!q.data) return;
    const none = !q.data.subjects.some((s) => s.scheduled);
    setErrors({});
    setRows(
      q.data.subjects.map((s) => ({
        subjectId: s.subjectId,
        name: s.name,
        type: s.type,
        inClass: s.inClass,
        include: s.scheduled || (none && s.inClass),
        date: s.date ?? '',
        startTime: s.startTime ?? '',
        endTime: s.endTime ?? '',
        maxMarks: String(s.maxMarks),
        passMarks: String(s.passMarks),
        marksCount: s.marksCount,
      })),
    );
  }, [q.data]);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const applyAll = () => {
    setRows((rs) =>
      rs.map((r) =>
        r.include
          ? {
              ...r,
              startTime: bulk.startTime || r.startTime,
              endTime: bulk.endTime || r.endTime,
              maxMarks: bulk.maxMarks || r.maxMarks,
              passMarks: bulk.passMarks || r.passMarks,
            }
          : r,
      ),
    );
    toast.success('Applied to all selected subjects');
  };

  const save = useMutation({
    mutationFn: async (entries: unknown[]) => (await api.put(`/exams/${exam.id}/schedule`, { classId, entries })).data,
    onSuccess: () => {
      toast.success('Date sheet saved');
      qc.invalidateQueries({ queryKey: ['exam-schedule', exam.id] });
      qc.invalidateQueries({ queryKey: ['exam-schedule-all', exam.id] });
      qc.invalidateQueries({ queryKey: ['exam', exam.id] });
      qc.invalidateQueries({ queryKey: ['exam-progress', exam.id] });
      qc.invalidateQueries({ queryKey: ['exams'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const errs: Record<string, string> = {};
    const entries: unknown[] = [];
    for (const r of rows.filter((x) => x.include)) {
      const p = examScheduleEntrySchema.safeParse({
        subjectId: r.subjectId,
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        maxMarks: r.maxMarks,
        passMarks: r.passMarks,
      });
      if (p.success) entries.push(p.data);
      else errs[r.subjectId] = p.error.issues[0]?.message ?? 'Invalid';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return toast.error('Please fix the highlighted subjects');
    save.mutate(entries);
  };

  const cls = exam.classes.find((c) => c.id === classId);
  const included = rows.filter((r) => r.include).length;
  const dirty = useMemo(() => {
    if (!q.data) return false;
    return rows.some((r) => {
      const s = q.data.subjects.find((x) => x.subjectId === r.subjectId)!;
      return (
        r.include !== s.scheduled ||
        r.date !== (s.date ?? '') ||
        r.startTime !== (s.startTime ?? '') ||
        r.endTime !== (s.endTime ?? '') ||
        r.maxMarks !== String(s.maxMarks) ||
        r.passMarks !== String(s.passMarks)
      );
    });
  }, [rows, q.data]);

  if (!exam.classes.length) return <Empty icon="🏫" title="No classes">Add classes in Academic settings first.</Empty>;

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <Field label="Class" className="w-44">
          <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
            {exam.classes.map((c) => (
              <option key={c.id} value={c.id}>
                Class {c.name} {c.scheduled ? `· ${c.scheduled} papers` : '· not set'}
              </option>
            ))}
          </Select>
        </Field>
        <Button icon={<Copy className="size-4" />} disabled={!cls?.scheduled} onClick={() => setCopyOpen(true)}>
          Copy to other classes
        </Button>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !rows.length ? (
        <Card>
          <Empty icon="📚" title="No subjects">Add subjects to Class {cls?.name} in Academic settings first.</Empty>
        </Card>
      ) : (
        <>
          <Card className="p-3 mb-3">
            <div className="text-[13px] font-medium text-muted mb-2 flex items-center gap-1.5">
              <Wand2 className="size-3.5" /> Set for all selected subjects
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
              <Field label="Start">
                <Input type="time" value={bulk.startTime} onChange={(e) => setBulk((b) => ({ ...b, startTime: e.target.value }))} />
              </Field>
              <Field label="End">
                <Input type="time" value={bulk.endTime} onChange={(e) => setBulk((b) => ({ ...b, endTime: e.target.value }))} />
              </Field>
              <Field label="Max marks">
                <Input inputMode="decimal" placeholder="100" value={bulk.maxMarks} onChange={(e) => setBulk((b) => ({ ...b, maxMarks: e.target.value }))} />
              </Field>
              <Field label="Pass marks">
                <Input inputMode="decimal" placeholder="33" value={bulk.passMarks} onChange={(e) => setBulk((b) => ({ ...b, passMarks: e.target.value }))} />
              </Field>
              <Button className="h-9 col-span-2 sm:col-span-1" onClick={applyAll} disabled={!Object.values(bulk).some(Boolean)}>
                Apply to all
              </Button>
            </div>
          </Card>

          <Table>
            <thead>
              <tr>
                <th className="w-8" />
                <th>Subject</th>
                <th>Date</th>
                <th>Start</th>
                <th>End</th>
                <th className="w-20">Max</th>
                <th className="w-20">Pass</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.subjectId} className={cn(!r.include && 'opacity-50')}>
                  <td>
                    <input
                      type="checkbox"
                      className="size-4 accent-[#2383e2]"
                      checked={r.include}
                      disabled={r.include && r.marksCount > 0}
                      title={r.marksCount ? 'Marks are entered for this subject' : undefined}
                      onChange={(e) => set(i, { include: e.target.checked })}
                    />
                  </td>
                  <td>
                    <div className="font-medium text-ink-strong whitespace-nowrap">{r.name}</div>
                    <div className="flex gap-1 mt-0.5">
                      {r.type === 'CO_SCHOLASTIC' && <Tag color="purple">Grades</Tag>}
                      {!r.inClass && <Tag color="orange">Removed from class</Tag>}
                      {r.marksCount > 0 && <Tag color="green">{r.marksCount} marks</Tag>}
                    </div>
                    {errors[r.subjectId] && <div className="text-xs text-tag-red-ink mt-0.5">{errors[r.subjectId]}</div>}
                  </td>
                  <td>
                    <Input type="date" className="min-w-36" value={r.date} disabled={!r.include} min={exam.session.startDate} max={exam.session.endDate} onChange={(e) => set(i, { date: e.target.value })} />
                  </td>
                  <td>
                    <Input type="time" className="min-w-28" value={r.startTime} disabled={!r.include} onChange={(e) => set(i, { startTime: e.target.value })} />
                  </td>
                  <td>
                    <Input type="time" className="min-w-28" value={r.endTime} disabled={!r.include} onChange={(e) => set(i, { endTime: e.target.value })} />
                  </td>
                  <td>
                    <Input inputMode="decimal" value={r.maxMarks} disabled={!r.include} onChange={(e) => set(i, { maxMarks: e.target.value })} />
                  </td>
                  <td>
                    <Input inputMode="decimal" value={r.passMarks} disabled={!r.include} onChange={(e) => set(i, { passMarks: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="sticky bottom-20 md:bottom-4 mt-4 z-20">
            <div className="rounded-lg bg-white border border-line shadow-pop px-4 py-3 flex flex-wrap items-center gap-3">
              <span className="flex-1 text-sm text-muted">
                Class {cls?.name}: {included} of {rows.length} subjects in the date sheet
              </span>
              <Button variant="primary" size="lg" loading={save.isPending} disabled={!dirty} onClick={submit} className="w-full sm:w-auto">
                Save date sheet
              </Button>
            </div>
          </div>
        </>
      )}

      {cls && <CopyModal open={copyOpen} onClose={() => setCopyOpen(false)} exam={exam} fromClassId={cls.id} />}
    </>
  );
}

function CopyModal({ open, onClose, exam, fromClassId }: { open: boolean; onClose: () => void; exam: ExamDetail; fromClassId: string }) {
  const qc = useQueryClient();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => setIds([]), [open]);
  const from = exam.classes.find((c) => c.id === fromClassId)!;
  const others = exam.classes.filter((c) => c.id !== fromClassId);
  const copy = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ classes: { className: string; copied: number; skipped: string[] }[] }>(`/exams/${exam.id}/schedule/copy`, {
          fromClassId,
          toClassIds: ids,
        })
      ).data,
    onSuccess: (d) => {
      const skipped = d.classes.filter((c) => c.skipped.length);
      toast.success(`Copied to ${d.classes.map((c) => `${c.className} (${c.copied})`).join(', ')}`, {
        description: skipped.length ? `Skipped subjects not taught: ${skipped.map((c) => `${c.className}: ${c.skipped.join(', ')}`).join('; ')}` : undefined,
      });
      qc.invalidateQueries({ queryKey: ['exam-schedule', exam.id] });
      qc.invalidateQueries({ queryKey: ['exam-schedule-all', exam.id] });
      qc.invalidateQueries({ queryKey: ['exam', exam.id] });
      qc.invalidateQueries({ queryKey: ['exam-progress', exam.id] });
      qc.invalidateQueries({ queryKey: ['exams'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Copy Class ${from.name} date sheet`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ids.length} loading={copy.isPending} onClick={() => copy.mutate()}>
            Copy to {ids.length || ''} {ids.length === 1 ? 'class' : 'classes'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted mb-3">
        Dates, times and max/pass marks are copied for subjects the class also has. Existing entries for those subjects are overwritten.
      </p>
      <div className="flex gap-2 mb-2">
        <Button size="sm" variant="ghost" onClick={() => setIds(others.map((c) => c.id))}>
          Select all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setIds([])}>
          Clear
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pb-2">
        {others.map((c) => (
          <label key={c.id} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-sm cursor-pointer hover:bg-hover">
            <input type="checkbox" className="size-4 accent-[#2383e2]" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} />
            <span className="flex-1">Class {c.name}</span>
            {c.scheduled > 0 && <span className="text-xs text-faint">{c.scheduled}</span>}
          </label>
        ))}
      </div>
    </Modal>
  );
}
