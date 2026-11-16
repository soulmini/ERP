import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogIn, LogOut } from 'lucide-react';
import { SOURCE, api, errorMessage } from '../../lib/api';
import { AttTag, Button, Card, ErrorBox, Loading, PageHeader, SectionTitle, Stat } from '../../components/ui';
import { AttendanceCalendar, MonthNav } from '../../components/attendance';
import { fmtDate, fmtTime, monthStr, todayStr } from '../../lib/utils';

interface MyAtt {
  today: { status: string; checkIn: string | null; checkOut: string | null } | null;
  records: { date: string; status: string; checkIn: string | null; checkOut: string | null }[];
  totals: Record<string, number>;
  lateAfter: string;
}

/** Staff self check-in / check-out (website or app) + own monthly attendance. */
export function MyAttendancePage() {
  const [month, setMonth] = useState(monthStr());
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['my-attendance', month],
    queryFn: async () => (await api.get<MyAtt>('/attendance/staff/me', { params: { month } })).data,
  });
  const act = useMutation({
    mutationFn: (kind: 'check-in' | 'check-out') => api.post(`/attendance/staff/${kind}`, { source: SOURCE }),
    onSuccess: (_d, kind) => {
      toast.success(kind === 'check-in' ? 'Checked in. Have a great day!' : 'Checked out');
      qc.invalidateQueries({ queryKey: ['my-attendance'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const t = d.today;

  return (
    <>
      <PageHeader icon="📍" title="My attendance" description={fmtDate(todayStr(), { weekday: 'long', day: 'numeric', month: 'long' })} />

      <Card className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <div className="text-sm text-muted mb-1">Today</div>
          <div className="flex items-center gap-2">
            <AttTag status={t?.status} />
            {t?.checkIn && <span className="text-sm text-muted">In {fmtTime(t.checkIn)}</span>}
            {t?.checkOut && <span className="text-sm text-muted">· Out {fmtTime(t.checkOut)}</span>}
          </div>
          {!t?.checkIn && <div className="text-xs text-faint mt-1.5">Check in before {d.lateAfter} to be marked on time.</div>}
        </div>
        {!t?.checkIn ? (
          <Button variant="primary" size="lg" icon={<LogIn className="size-4" />} loading={act.isPending} onClick={() => act.mutate('check-in')}>
            Check in
          </Button>
        ) : !t.checkOut ? (
          <Button size="lg" icon={<LogOut className="size-4" />} loading={act.isPending} onClick={() => act.mutate('check-out')}>
            Check out
          </Button>
        ) : (
          <div className="text-sm text-muted">Done for today 👋</div>
        )}
      </Card>

      <SectionTitle action={<MonthNav month={month} onChange={setMonth} max={monthStr()} />}>This month</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Present" value={d.totals.PRESENT} icon="🟢" />
        <Stat label="Late" value={d.totals.LATE} icon="🟠" />
        <Stat label="Absent" value={d.totals.ABSENT} icon="🔴" />
        <Stat label="Leave" value={d.totals.LEAVE} icon="🔵" />
      </div>
      <Card className="p-4 max-w-md">
        <AttendanceCalendar month={month} records={d.records} />
      </Card>
    </>
  );
}
