import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { ATT, Avatar, Button, Card, ErrorBox, Input, Loading, PageHeader, Tabs, Tag } from '../../components/ui';
import { GridCell, MonthNav, StatusPicker, type MarkStatus } from '../../components/attendance';
import { fmtTime, monthStr, todayStr } from '../../lib/utils';

interface StaffDay {
  date: string;
  staff: {
    staffId: string;
    name: string;
    designation: string;
    employeeCode: string;
    status: MarkStatus | null;
    checkIn: string | null;
    checkOut: string | null;
    source: string | null;
  }[];
}
interface StaffReport {
  days: number;
  staff: { staffId: string; name: string; designation: string; grid: Record<string, string>; totals: Record<string, number> }[];
}

export function StaffAttendancePage() {
  const [tab, setTab] = useState<'day' | 'register'>('day');
  return (
    <>
      <PageHeader icon="🕘" title="Staff attendance" description="Teachers check in from the app or website. You can mark or correct anyone here." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'day', label: 'Daily' },
          { value: 'register', label: 'Monthly register' },
        ]}
      />
      {tab === 'day' ? <Daily /> : <Register />}
    </>
  );
}

function Daily() {
  const [date, setDate] = useState(todayStr());
  const [marks, setMarks] = useState<Record<string, MarkStatus>>({});
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['staff-att', date],
    queryFn: async () => (await api.get<StaffDay>('/attendance/staff', { params: { date } })).data,
  });
  useEffect(() => {
    if (q.data) setMarks(Object.fromEntries(q.data.staff.filter((s) => s.status).map((s) => [s.staffId, s.status!])));
  }, [q.data]);

  const changed = useMemo(
    () => (q.data?.staff ?? []).filter((s) => marks[s.staffId] && marks[s.staffId] !== s.status),
    [q.data, marks],
  );
  const save = useMutation({
    mutationFn: () =>
      api.put('/attendance/staff', { date, entries: changed.map((s) => ({ staffId: s.staffId, status: marks[s.staffId] })) }),
    onSuccess: () => {
      toast.success('Staff attendance saved');
      qc.invalidateQueries({ queryKey: ['staff-att'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const staff = q.data!.staff;

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <Input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        <Button
          icon={<CheckCheck className="size-4" />}
          onClick={() => setMarks((m) => ({ ...Object.fromEntries(staff.map((s) => [s.staffId, 'PRESENT' as const])), ...Object.fromEntries(Object.entries(m)) }))}
        >
          Unmarked → present
        </Button>
      </div>
      <Card className="divide-y divide-line">
        {staff.map((s) => (
          <div key={s.staffId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5">
            <Avatar name={s.name} size={30} />
            <div className="flex-1 min-w-[140px]">
              <div className="font-medium text-ink-strong leading-tight">{s.name}</div>
              <div className="text-xs text-muted">
                {s.designation}
                {s.checkIn && (
                  <>
                    {' · '}In {fmtTime(s.checkIn)}
                    {s.checkOut && ` · Out ${fmtTime(s.checkOut)}`}
                    {s.source && s.source !== 'WEB' && <Tag className="ml-1">{s.source === 'APP' ? 'App' : 'Self'}</Tag>}
                  </>
                )}
              </div>
            </div>
            <StatusPicker value={marks[s.staffId] ?? null} onChange={(v) => setMarks((m) => ({ ...m, [s.staffId]: v }))} />
          </div>
        ))}
      </Card>
      {changed.length > 0 && (
        <div className="sticky bottom-20 md:bottom-4 mt-4 z-20">
          <div className="rounded-lg bg-white border border-line shadow-pop px-4 py-3 flex items-center gap-3">
            <span className="flex-1 text-sm text-muted">{changed.length} change(s)</span>
            <Button variant="primary" size="lg" loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function Register() {
  const [month, setMonth] = useState(monthStr());
  const q = useQuery({
    queryKey: ['staff-register', month],
    queryFn: async () => (await api.get<StaffReport>('/attendance/staff/report', { params: { month } })).data,
  });
  return (
    <>
      <div className="mb-3">
        <MonthNav month={month} onChange={setMonth} max={monthStr()} />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr className="text-[12px] text-muted">
                <th className="sticky left-0 bg-white text-left font-normal px-3 py-2 border-b border-line min-w-44">Staff</th>
                {Array.from({ length: q.data!.days }, (_, i) => (
                  <th key={i} className="font-normal w-7 text-center border-b border-line">
                    {i + 1}
                  </th>
                ))}
                {(['PRESENT', 'LATE', 'ABSENT', 'LEAVE'] as const).map((k) => (
                  <th key={k} className="font-normal px-2 border-b border-line">
                    {ATT[k].short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data!.staff.map((s) => (
                <tr key={s.staffId}>
                  <td className="sticky left-0 bg-white px-3 py-1.5 border-b border-line whitespace-nowrap">
                    <div className="font-medium text-ink-strong">{s.name}</div>
                    <div className="text-xs text-muted">{s.designation}</div>
                  </td>
                  {Array.from({ length: q.data!.days }, (_, i) => (
                    <td key={i} className="px-0.5 border-b border-line text-center">
                      <GridCell v={s.grid[i + 1]} />
                    </td>
                  ))}
                  {(['PRESENT', 'LATE', 'ABSENT', 'LEAVE'] as const).map((k) => (
                    <td key={k} className="px-2 border-b border-line text-center tabular-nums">
                      {s.totals[k]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
