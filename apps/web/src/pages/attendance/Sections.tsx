import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card, Empty, ErrorBox, Input, Loading, PageHeader, Tag } from '../../components/ui';
import { fmtDate, todayStr } from '../../lib/utils';

interface SectionRow {
  id: string;
  label: string;
  classTeacher: string | null;
  isMine: boolean;
  students: number;
  marked: number;
  present: number;
  absent: number;
  leave: number;
  canMark: boolean;
}

export function AttendanceSectionsPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayStr());
  const q = useQuery({
    queryKey: ['attendance-sections', date],
    queryFn: async () => (await api.get<{ date: string; sections: SectionRow[] }>('/attendance/sections', { params: { date } })).data,
  });
  const sections = q.data?.sections ?? [];
  const done = sections.filter((s) => s.marked > 0).length;

  return (
    <>
      <PageHeader
        icon="✅"
        title={user?.view === 'teacher' ? 'Mark attendance' : 'Student attendance'}
        description={
          q.data ? `${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${done} of ${sections.length} classes marked` : undefined
        }
        actions={<Input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className="w-auto" />}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !sections.length ? (
        <Empty icon="🧑‍🏫" title="No class assigned">
          You are not a class teacher of any section yet. Ask the Principal to assign you in Classes & subjects.
        </Empty>
      ) : (
        <Card className="divide-y divide-line">
          {sections.map((s) => {
            const pct = s.students ? Math.round((s.present / s.students) * 100) : 0;
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#fafaf9]">
                <Link to={`/attendance/${s.id}?date=${date}`} className="flex-1 min-w-0 flex items-center gap-3">
                  <span className="size-10 rounded-md bg-sidebar border border-line flex items-center justify-center font-semibold text-ink-strong text-sm shrink-0">
                    {s.label}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium text-ink-strong flex items-center gap-2">
                      Class {s.label}
                      {s.isMine && <Tag color="purple">My class</Tag>}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {s.students} students · {s.classTeacher ?? 'No class teacher'}
                    </div>
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  {s.marked > 0 ? (
                    <>
                      <Tag color="green">{pct}% present</Tag>
                      <div className="text-xs text-muted mt-1">
                        {s.absent} absent{s.leave ? ` · ${s.leave} leave` : ''}
                      </div>
                    </>
                  ) : (
                    <Tag color={s.students ? 'orange' : 'gray'}>{s.students ? 'Not marked' : 'No students'}</Tag>
                  )}
                </div>
                <Link to={`/attendance/${s.id}/report`} className="hidden sm:flex p-1.5 rounded hover:bg-hover text-muted" title="Monthly register">
                  <BarChart3 className="size-4" />
                </Link>
                <Link to={`/attendance/${s.id}?date=${date}`} className="p-1 text-faint">
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
