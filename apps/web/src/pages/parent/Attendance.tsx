import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Card, Empty, ErrorBox, Loading, PageHeader, SectionTitle, Stat } from '../../components/ui';
import { AttendanceCalendar, MonthNav } from '../../components/attendance';
import { monthStr } from '../../lib/utils';
import { ChildSwitcher } from './Home';
import { useChildren } from './useChildren';

interface ChildAtt {
  month: string;
  records: { date: string; status: string; remark: string | null }[];
  totals: Record<string, number>;
}

export function ParentAttendance() {
  const { children, child, select, isLoading } = useChildren();
  const [month, setMonth] = useState(monthStr());
  const q = useQuery({
    enabled: !!child,
    queryKey: ['child-att', child?.id, month],
    queryFn: async () => (await api.get<ChildAtt>(`/parent/children/${child!.id}/attendance`, { params: { month } })).data,
  });
  if (isLoading) return <Loading />;
  if (!child) return <Empty icon="🎒" title="No student linked" />;
  const t = q.data?.totals;
  const counted = t ? t.PRESENT + t.LATE + t.HALF_DAY + t.ABSENT + t.LEAVE : 0;
  const pct = t && counted ? Math.round(((t.PRESENT + t.LATE + t.HALF_DAY * 0.5) / counted) * 100) : null;

  return (
    <>
      <PageHeader icon="✅" title="Attendance" description={`${child.name} · Class ${child.classLabel ?? '—'}`} />
      <ChildSwitcher kids={children} child={child} select={select} />
      <div className="mb-4">
        <MonthNav month={month} onChange={setMonth} max={monthStr()} />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Present" value={t!.PRESENT + t!.LATE} icon="🟢" />
            <Stat label="Absent" value={t!.ABSENT} icon="🔴" />
            <Stat label="Attendance" value={pct == null ? '—' : `${pct}%`} icon="📈" />
          </div>
          <Card className="p-4 max-w-md">
            <AttendanceCalendar month={month} records={q.data!.records} />
          </Card>
          {q.data!.records.some((r) => r.remark) && (
            <>
              <SectionTitle>Remarks</SectionTitle>
              <Card className="divide-y divide-line">
                {q.data!.records
                  .filter((r) => r.remark)
                  .map((r) => (
                    <div key={r.date} className="px-4 py-2 text-sm">
                      <span className="text-muted mr-2">{r.date.slice(0, 10)}</span>
                      {r.remark}
                    </div>
                  ))}
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
