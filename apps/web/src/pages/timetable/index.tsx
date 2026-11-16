import { useEffect, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Coffee, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { WEEK_DAYS, periodSchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useZodForm } from '../../lib/form';
import { sectionOptions, staffName, useClasses, useStaff } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Tag } from '../../components/ui';
import { Letterhead } from '../../components/print';
import { cn } from '../../lib/utils';
import { ChildSwitcher } from '../parent/Home';
import { useChildren } from '../parent/useChildren';

interface Period {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  order: number;
  isBreak: boolean;
}
interface Slot {
  id: string;
  day: number;
  periodId: string;
  room: string | null;
  subject: { id: string; name: string } | null;
  teacher: { id: string; name: string } | null;
  section: { id: string; label: string };
}
interface SectionWeek {
  section: { id: string; label: string; classTeacher: string | null };
  periods: Period[];
  slots: Slot[];
  subjects: { id: string; name: string; teacherId: string | null }[];
  teachers: { id: string; name: string; designation: string }[];
}

/** Monday = 1 … Saturday = 6; Sunday → 0 (no column highlighted). */
const todayDay = () => new Date().getDay();
const key = (day: number, periodId: string) => `${day}:${periodId}`;

/** Time table module. Mounted at /timetable/*. */
export function TimetableModule() {
  return (
    <Routes>
      <Route index element={<TimetablePage />} />
    </Routes>
  );
}

function TimetablePage() {
  const { user, can } = useAuth();
  if (user?.view === 'parent') return <ParentTimetable />;
  const manage = user?.view === 'admin' && can('timetable.manage');
  return <StaffTimetable manage={manage} isTeacher={user?.view === 'teacher'} />;
}

function PrintButton() {
  return (
    <Button icon={<Printer className="size-4" />} onClick={() => window.print()} className="no-print">
      Print
    </Button>
  );
}

// ───────── Staff ─────────

function StaffTimetable({ manage, isTeacher }: { manage: boolean; isTeacher: boolean }) {
  type T = 'mine' | 'class' | 'teacher' | 'periods';
  const [tab, setTab] = useState<T>(isTeacher ? 'mine' : 'class');
  const tabs: { value: T; label: string }[] = [
    ...(isTeacher ? [{ value: 'mine' as T, label: 'My week' }] : []),
    { value: 'class', label: 'Class time table' },
    ...(!isTeacher ? [{ value: 'teacher' as T, label: 'Teacher time table' }] : []),
    ...(manage ? [{ value: 'periods' as T, label: 'Periods' }] : []),
  ];
  return (
    <>
      <div className="no-print">
        <PageHeader icon="🗓️" title="Time table" description={manage ? 'Set periods, then fill each class’s week. Teacher clashes are blocked.' : undefined} />
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
      </div>
      {tab === 'mine' && <TeacherWeek />}
      {tab === 'class' && <ClassTimetable manage={manage} />}
      {tab === 'teacher' && <TeacherPicker />}
      {tab === 'periods' && manage && <PeriodsTab />}
    </>
  );
}

function TeacherPicker() {
  const staff = useStaff();
  const [staffId, setStaffId] = useState('');
  return (
    <>
      <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="w-auto min-w-56 mb-4 no-print">
        <option value="">Select teacher…</option>
        {staff.data?.filter((s) => s.isActive).map((s) => (
          <option key={s.id} value={s.id}>
            {staffName(s)} · {s.designation}
          </option>
        ))}
      </Select>
      {staffId ? <TeacherWeek staffId={staffId} /> : <Empty icon="🧑‍🏫" title="Pick a teacher to see their week" />}
    </>
  );
}

function TeacherWeek({ staffId }: { staffId?: string }) {
  const q = useQuery({
    queryKey: ['timetable', 'teacher', staffId ?? 'me'],
    queryFn: async () =>
      (await api.get<{ teacher: { name: string }; periods: Period[]; slots: Slot[] }>('/timetable/teacher', { params: { staffId } })).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const today = d.slots.filter((s) => s.day === todayDay());
  return (
    <>
      <div className="hidden print:block">
        <Letterhead title={`Time table · ${d.teacher.name}`} compact />
      </div>
      {!staffId && todayDay() >= 1 && (
        <Card className="p-4 mb-4 no-print">
          <div className="text-[13px] font-semibold text-muted mb-2">Today</div>
          {today.length ? (
            <div className="flex flex-wrap gap-2">
              {d.periods
                .filter((p) => today.some((s) => s.periodId === p.id))
                .map((p) => {
                  const s = today.find((x) => x.periodId === p.id)!;
                  return (
                    <div key={p.id} className="rounded-md border border-line px-3 py-2 text-sm">
                      <div className="text-xs text-muted">
                        {p.name} · {p.startTime}
                      </div>
                      <div className="font-medium text-ink-strong">
                        {s.section.label} · {s.subject?.name ?? '—'}
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="text-sm text-muted">No classes today.</div>
          )}
        </Card>
      )}
      <div className="flex justify-end mb-2 no-print">
        <PrintButton />
      </div>
      <WeekGrid periods={d.periods} slots={d.slots} mode="teacher" />
    </>
  );
}

function ClassTimetable({ manage }: { manage: boolean }) {
  const classes = useClasses();
  const options = sectionOptions(classes.data);
  const [sectionId, setSectionId] = useState('');
  useEffect(() => {
    if (!sectionId && options.length) setSectionId(options.find((o) => o.label === '5-A')?.id ?? options[0].id);
  }, [options, sectionId]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4 no-print">
        <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-auto min-w-40">
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              Class {o.label}
            </option>
          ))}
        </Select>
        <PrintButton />
      </div>
      {sectionId ? <SectionWeekView sectionId={sectionId} editable={manage} /> : <Loading />}
    </>
  );
}

// ───────── Parent ─────────

function ParentTimetable() {
  const { children, child, select, isLoading } = useChildren();
  const map = useQuery({
    queryKey: ['timetable', 'children'],
    queryFn: async () => (await api.get<{ studentId: string; sectionId: string }[]>('/timetable/children')).data,
  });
  const sectionId = map.data?.find((c) => c.studentId === child?.id)?.sectionId;
  if (isLoading || map.isLoading) return <Loading />;
  return (
    <>
      <div className="no-print">
        <PageHeader icon="🗓️" title="Time table" description={child ? `${child.name} · Class ${child.classLabel ?? '—'}` : undefined} />
        <ChildSwitcher kids={children} child={child} select={select} />
      </div>
      {sectionId ? <SectionWeekView sectionId={sectionId} editable={false} /> : <Empty icon="🗓️" title="No class found" />}
    </>
  );
}

// ───────── One section's week (view + editor) ─────────

type Cell = { subjectId?: string; teacherId?: string };

function SectionWeekView({ sectionId, editable }: { sectionId: string; editable: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['timetable', 'section', sectionId],
    queryFn: async () => (await api.get<SectionWeek>(`/timetable/section/${sectionId}`)).data,
  });
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<{ day: number; period: Period } | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setCells(Object.fromEntries(q.data.slots.map((s) => [key(s.day, s.periodId), { subjectId: s.subject?.id, teacherId: s.teacher?.id }])));
    setDirty(false);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/timetable/section/${sectionId}`, {
        slots: Object.entries(cells)
          .filter(([, c]) => c.subjectId || c.teacherId)
          .map(([k, c]) => {
            const [day, periodId] = k.split(':');
            return { day: Number(day), periodId, subjectId: c.subjectId, teacherId: c.teacherId };
          }),
      }),
    onSuccess: () => {
      toast.success('Time table saved');
      qc.invalidateQueries({ queryKey: ['timetable'] });
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 8000 }),
  });

  // Build display slots from the (possibly edited) cells.
  const view = useMemo<Slot[]>(() => {
    if (!q.data) return [];
    const subj = new Map(q.data.subjects.map((s) => [s.id, s]));
    const teach = new Map(q.data.teachers.map((t) => [t.id, t]));
    const original = new Map(q.data.slots.map((s) => [key(s.day, s.periodId), s]));
    return Object.entries(cells)
      .filter(([, c]) => c.subjectId || c.teacherId)
      .map(([k, c]) => {
        const [day, periodId] = k.split(':');
        const o = original.get(k);
        const t = c.teacherId ? teach.get(c.teacherId) : undefined;
        return {
          id: k,
          day: Number(day),
          periodId,
          room: null,
          subject: c.subjectId ? { id: c.subjectId, name: subj.get(c.subjectId)?.name ?? o?.subject?.name ?? '—' } : null,
          teacher: c.teacherId ? { id: c.teacherId, name: t?.name ?? o?.teacher?.name ?? '—' } : null,
          section: q.data!.section,
        };
      });
  }, [cells, q.data]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  if (!d.periods.length) {
    return <Empty icon="⏰" title="No periods yet">{editable ? 'Set up the school periods in the “Periods” tab first.' : 'The school has not published the time table yet.'}</Empty>;
  }

  return (
    <>
      <div className="hidden print:block">
        <Letterhead title={`Time table · Class ${d.section.label}`} compact />
      </div>
      {d.section.classTeacher && <div className="text-sm text-muted mb-3 no-print">Class teacher: {d.section.classTeacher}</div>}
      <WeekGrid periods={d.periods} slots={view} mode="section" onCell={editable ? (day, period) => setOpen({ day, period }) : undefined} />
      {editable && (
        <div className="sticky bottom-20 md:bottom-4 mt-4 z-20 no-print">
          <div className="rounded-lg bg-white border border-line shadow-pop px-4 py-3 flex items-center gap-3">
            <span className="flex-1 text-sm text-muted">{dirty ? 'Unsaved changes' : 'Tap a cell to set subject and teacher'}</span>
            <Button variant="primary" size="lg" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save time table
            </Button>
          </div>
        </div>
      )}
      {open && (
        <CellEditor
          data={d}
          day={open.day}
          period={open.period}
          value={cells[key(open.day, open.period.id)] ?? {}}
          onClose={() => setOpen(null)}
          onChange={(c) => {
            setCells((x) => ({ ...x, [key(open.day, open.period.id)]: c }));
            setDirty(true);
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function CellEditor({
  data,
  day,
  period,
  value,
  onChange,
  onClose,
}: {
  data: SectionWeek;
  day: number;
  period: Period;
  value: Cell;
  onChange: (c: Cell) => void;
  onClose: () => void;
}) {
  const [subjectId, setSubjectId] = useState(value.subjectId ?? '');
  const [teacherId, setTeacherId] = useState(value.teacherId ?? '');
  const dayName = WEEK_DAYS.find((w) => w.day === day)?.name;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${dayName} · ${period.name}`}
      footer={
        <>
          {(value.subjectId || value.teacherId) && (
            <Button variant="danger" className="mr-auto" onClick={() => onChange({})}>
              Clear
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onChange({ subjectId: subjectId || undefined, teacherId: teacherId || undefined })}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="text-sm text-muted">
          {period.startTime} – {period.endTime}
        </div>
        <Field label="Subject">
          <Select
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              const assigned = data.subjects.find((s) => s.id === e.target.value)?.teacherId;
              if (assigned && !teacherId) setTeacherId(assigned);
            }}
            autoFocus
          >
            <option value="">—</option>
            {data.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Teacher">
          <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">—</option>
            {data.teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.designation}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ───────── Week grid (desktop table, phone day tabs) ─────────

function WeekGrid({
  periods,
  slots,
  mode,
  onCell,
}: {
  periods: Period[];
  slots: Slot[];
  mode: 'section' | 'teacher';
  onCell?: (day: number, period: Period) => void;
}) {
  const byKey = useMemo(() => new Map(slots.map((s) => [key(s.day, s.periodId), s])), [slots]);
  const today = todayDay();
  const [day, setDay] = useState(today >= 1 && today <= 6 ? today : 1);

  const cellBody = (s: Slot | undefined) =>
    s ? (
      <>
        <div className="font-medium text-ink-strong leading-tight">{mode === 'section' ? s.subject?.name ?? '—' : s.section.label}</div>
        <div className="text-[11px] text-muted leading-tight mt-0.5 truncate">
          {mode === 'section' ? s.teacher?.name ?? '' : s.subject?.name ?? ''}
        </div>
      </>
    ) : (
      <span className="text-[#d3d3d0]">{onCell ? '+' : '·'}</span>
    );

  return (
    <>
      {/* Desktop / print: periods × days */}
      <Card className="hidden md:block print:block overflow-x-auto print:border-0">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[12px] text-muted">
              <th className="text-left font-normal px-3 py-2 border-b border-line w-32">Period</th>
              {WEEK_DAYS.map((w) => (
                <th key={w.day} className={cn('font-normal px-2 py-2 border-b border-line text-left', w.day === today && 'text-ink-strong font-semibold')}>
                  {w.short}
                  {w.day === today && <span className="ml-1 text-[10px] text-tag-blue-ink no-print">today</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) =>
              p.isBreak ? (
                <tr key={p.id} className="bg-[#fafaf9]">
                  <td className="px-3 py-1.5 border-b border-line text-xs text-muted whitespace-nowrap">
                    {p.startTime}–{p.endTime}
                  </td>
                  <td colSpan={6} className="px-3 py-1.5 border-b border-line text-xs text-muted text-center tracking-wide">
                    <Coffee className="size-3 inline mr-1" /> {p.name}
                  </td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <td className="px-3 py-2 border-b border-line whitespace-nowrap">
                    <div className="font-medium text-ink-strong">{p.name}</div>
                    <div className="text-[11px] text-muted">
                      {p.startTime}–{p.endTime}
                    </div>
                  </td>
                  {WEEK_DAYS.map((w) => {
                    const s = byKey.get(key(w.day, p.id));
                    return (
                      <td
                        key={w.day}
                        onClick={onCell ? () => onCell(w.day, p) : undefined}
                        className={cn(
                          'px-2 py-2 border-b border-l border-line align-top min-w-[96px] max-w-[140px]',
                          w.day === today && 'bg-[#f5f9fc]',
                          onCell && 'cursor-pointer hover:bg-hover',
                        )}
                      >
                        {cellBody(s)}
                      </td>
                    );
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </Card>

      {/* Phone: one day at a time */}
      <div className="md:hidden print:hidden">
        <div className="flex gap-1 overflow-x-auto mb-3 -mx-4 px-4">
          {WEEK_DAYS.map((w) => (
            <button
              key={w.day}
              onClick={() => setDay(w.day)}
              className={cn(
                'px-3 h-8 rounded-full border text-sm whitespace-nowrap',
                day === w.day ? 'bg-ink-strong text-white border-ink-strong' : 'bg-white border-line',
              )}
            >
              {w.short}
              {w.day === today ? ' •' : ''}
            </button>
          ))}
        </div>
        <Card className="divide-y divide-line">
          {periods.map((p) => {
            const s = byKey.get(key(day, p.id));
            return (
              <div
                key={p.id}
                onClick={onCell && !p.isBreak ? () => onCell(day, p) : undefined}
                className={cn('flex items-center gap-3 px-4 py-2.5', p.isBreak && 'bg-[#fafaf9]', onCell && !p.isBreak && 'active:bg-hover')}
              >
                <div className="w-20 shrink-0">
                  <div className="text-sm font-medium text-ink-strong">{p.name}</div>
                  <div className="text-[11px] text-muted">
                    {p.startTime}–{p.endTime}
                  </div>
                </div>
                <div className="flex-1 min-w-0">{p.isBreak ? <span className="text-sm text-muted">Break</span> : cellBody(s)}</div>
              </div>
            );
          })}
        </Card>
      </div>
    </>
  );
}

// ───────── Periods setup ─────────

const DEFAULT_PERIODS = [
  ['Period 1', '08:00', '08:40', false],
  ['Period 2', '08:40', '09:20', false],
  ['Period 3', '09:20', '10:00', false],
  ['Period 4', '10:00', '10:40', false],
  ['Lunch', '10:40', '11:10', true],
  ['Period 5', '11:10', '11:50', false],
  ['Period 6', '11:50', '12:30', false],
  ['Period 7', '12:30', '13:10', false],
  ['Period 8', '13:10', '13:50', false],
] as const;

function PeriodsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Period | 'new' | null>(null);
  const q = useQuery({ queryKey: ['periods'], queryFn: async () => (await api.get<Period[]>('/timetable/periods')).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['periods'] }).then(() => qc.invalidateQueries({ queryKey: ['timetable'] }));
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/timetable/periods/${id}`),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const defaults = useMutation({
    mutationFn: async () => {
      for (const [i, [name, startTime, endTime, isBreak]] of DEFAULT_PERIODS.entries()) {
        await api.post('/timetable/periods', { name, startTime, endTime, isBreak, order: i });
      }
    },
    onSuccess: () => (toast.success('Default periods added'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          Add period
        </Button>
        {!q.data!.length && (
          <Button loading={defaults.isPending} onClick={() => defaults.mutate()}>
            Use default 8 periods + lunch
          </Button>
        )}
      </div>
      {!q.data!.length ? (
        <Empty icon="⏰" title="No periods yet" />
      ) : (
        <Card className="divide-y divide-line max-w-xl">
          {q.data!.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-28 text-sm text-muted tabular-nums">
                {p.startTime} – {p.endTime}
              </span>
              <span className="flex-1 font-medium text-ink-strong">{p.name}</span>
              {p.isBreak && <Tag>Break</Tag>}
              <button className="p-1.5 rounded hover:bg-hover text-muted" onClick={() => setEditing(p)} title="Edit">
                <Pencil className="size-3.5" />
              </button>
              <button
                className="p-1.5 rounded hover:bg-hover text-muted"
                onClick={() => confirm(`Delete ${p.name}? Its time table entries are removed too.`) && del.mutate(p.id)}
                title="Delete"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </Card>
      )}
      {editing && (
        <PeriodForm period={editing === 'new' ? null : editing} nextOrder={q.data!.length} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </>
  );
}

function PeriodForm({ period, nextOrder, onClose, onSaved }: { period: Period | null; nextOrder: number; onClose: () => void; onSaved: () => void }) {
  const f = useZodForm(periodSchema, {
    name: period?.name ?? `Period ${nextOrder + 1}`,
    startTime: period?.startTime ?? '',
    endTime: period?.endTime ?? '',
    order: String(period?.order ?? nextOrder),
    isBreak: period?.isBreak ?? false,
  });
  const save = useMutation({
    mutationFn: (d: object) => (period ? api.put(`/timetable/periods/${period.id}`, d) : api.post('/timetable/periods', d)),
    onSuccess: () => (onSaved(), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={period ? 'Edit period' : 'Add period'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => { const d = f.validate(); if (d) save.mutate(d); }}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 pb-2">
        <Field label="Name" error={f.errors.name} className="col-span-2">
          <Input {...f.bind('name')} />
        </Field>
        <Field label="Starts" error={f.errors.startTime}>
          <Input type="time" {...f.bind('startTime')} />
        </Field>
        <Field label="Ends" error={f.errors.endTime}>
          <Input type="time" {...f.bind('endTime')} />
        </Field>
        <Field label="Order" error={f.errors.order}>
          <Input type="number" {...f.bind('order')} />
        </Field>
        <label className="flex items-center gap-2 text-sm mt-6">
          <input type="checkbox" checked={!!f.values.isBreak} onChange={(e) => f.set('isBreak', e.target.checked)} /> Break / lunch
        </label>
      </div>
    </Modal>
  );
}
