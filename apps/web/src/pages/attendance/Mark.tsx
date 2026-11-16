import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BarChart3, CheckCheck, Lock, Search } from 'lucide-react';
import { SOURCE, api, errorMessage } from '../../lib/api';
import { ATT, AttTag, Avatar, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Tag } from '../../components/ui';
import { StatusPicker, type MarkStatus } from '../../components/attendance';
import { cn, fmtDate, fmtTime, todayStr } from '../../lib/utils';

interface Roster {
  date: string;
  section: { id: string; label: string };
  editable: boolean;
  markedAt: string | null;
  markedBy: string | null;
  students: {
    studentId: string;
    rollNo: number | null;
    admissionNo: string;
    name: string;
    gender: string;
    status: MarkStatus | null;
    remark: string | null;
  }[];
}

export function MarkAttendancePage() {
  const { sectionId } = useParams();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayStr();
  const qc = useQueryClient();
  const [marks, setMarks] = useState<Record<string, MarkStatus>>({});
  const [search, setSearch] = useState('');

  const q = useQuery({
    queryKey: ['roster', sectionId, date],
    queryFn: async () => (await api.get<Roster>(`/attendance/sections/${sectionId}`, { params: { date } })).data,
  });

  // Load existing marks whenever the roster changes.
  useEffect(() => {
    if (!q.data) return;
    setMarks(Object.fromEntries(q.data.students.filter((s) => s.status).map((s) => [s.studentId, s.status!])));
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () =>
      api.put(`/attendance/sections/${sectionId}`, {
        date,
        source: SOURCE,
        entries: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })),
      }),
    onSuccess: () => {
      toast.success('Attendance saved');
      qc.invalidateQueries({ queryKey: ['roster', sectionId] });
      qc.invalidateQueries({ queryKey: ['attendance-sections'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const students = q.data?.students ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? students.filter((x) => x.name.toLowerCase().includes(s) || String(x.rollNo).includes(s)) : students;
  }, [students, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of Object.values(marks)) c[v] = (c[v] ?? 0) + 1;
    return c;
  }, [marks]);
  const unmarked = students.length - Object.keys(marks).length;
  const editable = q.data?.editable ?? false;
  const dirty = q.data ? students.some((s) => (marks[s.studentId] ?? null) !== s.status) : false;

  const markAllPresent = () =>
    setMarks((m) => ({ ...Object.fromEntries(students.map((s) => [s.studentId, 'PRESENT' as const])), ...pickNonPresent(m) }));

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;

  return (
    <>
      <Link to="/attendance" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> All classes
      </Link>
      <PageHeader
        title={`Class ${r.section.label}`}
        description={
          <>
            {fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {r.markedAt && (
              <span className="block text-xs mt-0.5">
                Last saved {fmtTime(r.markedAt)}
                {r.markedBy ? ` by ${r.markedBy}` : ''}
              </span>
            )}
          </>
        }
        actions={
          <>
            <Input type="date" value={date} max={todayStr()} onChange={(e) => setParams({ date: e.target.value })} className="w-auto" />
            <Link to={`/attendance/${sectionId}/report`}>
              <Button icon={<BarChart3 className="size-4" />}>Register</Button>
            </Link>
          </>
        }
      />

      {!editable && (
        <div className="flex items-center gap-2 rounded-md bg-tag-yellow text-tag-yellow-ink px-3 py-2 text-sm mb-4">
          <Lock className="size-4 shrink-0" /> View only. Teachers can edit attendance for the last 3 days only.
        </div>
      )}

      {!students.length ? (
        <Empty icon="🎒" title="No students in this class">Add students from the Students page.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {editable && (
              <Button variant="secondary" icon={<CheckCheck className="size-4" />} onClick={markAllPresent}>
                Mark all present
              </Button>
            )}
            <div className="relative flex-1 min-w-40">
              <Search className="size-4 text-faint absolute left-2.5 top-2.5" />
              <Input placeholder="Search name or roll no." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
          </div>

          <Card className="divide-y divide-line">
            {filtered.map((s) => {
              const st = marks[s.studentId] ?? null;
              return (
                <div
                  key={s.studentId}
                  className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5', st === 'ABSENT' && 'bg-[#fffafa]')}
                >
                  <span className="w-6 text-right text-sm text-faint tabular-nums">{s.rollNo ?? '–'}</span>
                  <Avatar name={s.name} size={30} />
                  <div className="flex-1 min-w-[120px]">
                    <div className="font-medium text-ink-strong leading-tight">{s.name}</div>
                    <div className="text-xs text-muted">{s.admissionNo}</div>
                  </div>
                  {editable ? (
                    <StatusPicker value={st} onChange={(v) => setMarks((m) => ({ ...m, [s.studentId]: v }))} />
                  ) : (
                    <AttTag status={st} />
                  )}
                </div>
              );
            })}
          </Card>

          {/* Sticky save bar */}
          {editable && (
            <div className="sticky bottom-20 md:bottom-4 mt-4 z-20">
              <div className="rounded-lg bg-white border border-line shadow-pop px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE'] as const).map((k) =>
                    counts[k] ? (
                      <Tag key={k} color={ATT[k].color}>
                        {ATT[k].label} {counts[k]}
                      </Tag>
                    ) : null,
                  )}
                  {unmarked > 0 && <Tag color="gray">{unmarked} not marked</Tag>}
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  loading={save.isPending}
                  disabled={unmarked > 0 || !dirty}
                  onClick={() => save.mutate()}
                  className="w-full sm:w-auto"
                >
                  {r.markedAt ? 'Update attendance' : 'Save attendance'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function pickNonPresent(m: Record<string, MarkStatus>) {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 'PRESENT'));
}
