import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { formatINR } from '@erp/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card, ErrorBox, Loading, PageHeader, SectionTitle, Stat, Tag } from '../../components/ui';
import { fmtDate, greeting } from '../../lib/utils';

interface AdminDash {
  session: string;
  date: string;
  students: { total: number; boys: number; girls: number };
  staff: { total: number; present: number; late: number; absent: number; leave: number };
  studentAttendance: { sectionsMarked: number; sectionsTotal: number; present: number; absent: number; leave: number };
  trend: { date: string; percent: number | null }[];
  classStrength: { name: string; students: number }[];
}

interface FeeSummary {
  todayCollection: number;
  monthCollection: number;
  outstanding: number;
  overdueStudents?: number;
}

export function AdminDashboard() {
  const { user, can } = useAuth();
  const q = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: async () => (await api.get<AdminDash>('/dashboard/admin')).data,
  });
  // Fee totals (hidden if the user has no fee access or the fees module isn't available).
  const fees = useQuery({
    queryKey: ['dashboard', 'fees-summary'],
    enabled: can('fees.view', 'fees.collect', 'fees.manage'),
    retry: false,
    queryFn: async () => (await api.get<FeeSummary>('/fees/summary')).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const sa = d.studentAttendance;
  const presentPct = sa.present + sa.absent + sa.leave ? Math.round((sa.present / (sa.present + sa.absent + sa.leave)) * 100) : null;
  const maxStrength = Math.max(1, ...d.classStrength.map((c) => c.students));

  return (
    <>
      <PageHeader
        icon="👋"
        title={`${greeting()}, ${user?.name.split(' ')[0]}`}
        description={`${fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })} · Session ${d.session}`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="🎒" label="Students" value={d.students.total} sub={`${d.students.boys} boys · ${d.students.girls} girls`} />
        <Stat
          icon="✅"
          label="Present today"
          value={presentPct == null ? '—' : `${presentPct}%`}
          sub={`${sa.present} present · ${sa.absent} absent`}
        />
        <Stat icon="🧑‍🏫" label="Staff present" value={`${d.staff.present}/${d.staff.total}`} sub={`${d.staff.late} late · ${d.staff.leave} on leave`} />
        <Stat icon="📋" label="Classes marked" value={`${sa.sectionsMarked}/${sa.sectionsTotal}`} sub="attendance taken today" />
      </div>

      {fees.data && typeof fees.data.todayCollection === 'number' && (
        <Link to="/fees" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <Stat icon="💰" label="Fees collected today" value={formatINR(fees.data.todayCollection)} />
          <Stat icon="📅" label="Collected this month" value={formatINR(fees.data.monthCollection)} />
          <Stat
            icon="⏳"
            label="Outstanding dues"
            value={formatINR(fees.data.outstanding)}
            sub={fees.data.overdueStudents != null ? `${fees.data.overdueStudents} students overdue` : undefined}
          />
        </Link>
      )}

      <div className="grid lg:grid-cols-2 gap-x-6 mt-8">
        <div>
          <SectionTitle
            action={
              <Link to="/attendance" className="text-xs text-muted hover:text-ink inline-flex items-center gap-1">
                Open <ArrowRight className="size-3" />
              </Link>
            }
          >
            Attendance · last 7 days
          </SectionTitle>
          <Card className="p-4">
            <div className="flex items-end gap-2 h-36">
              {d.trend.map((t) => (
                <div key={t.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <span className="text-[11px] text-muted tabular-nums">{t.percent == null ? '' : `${Math.round(t.percent)}%`}</span>
                  <div
                    className={t.percent == null ? 'w-full rounded-sm bg-[#f1f1ef]' : 'w-full rounded-sm bg-tag-green-ink/80'}
                    style={{ height: `${t.percent == null ? 4 : Math.max(4, t.percent)}%` }}
                    title={t.percent == null ? 'Not recorded' : `${t.percent}%`}
                  />
                  <span className="text-[11px] text-faint">{fmtDate(t.date, { weekday: 'short' })}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <SectionTitle>Class strength</SectionTitle>
          <Card className="p-4 space-y-1.5">
            {d.classStrength.map((c) => (
              <div key={c.name} className="flex items-center gap-3 text-sm">
                <span className="w-24 text-muted shrink-0 whitespace-nowrap">Class {c.name}</span>
                <div className="flex-1 h-5 bg-[#f7f7f5] rounded-sm overflow-hidden">
                  <div className="h-full bg-tag-blue-ink/70 rounded-sm" style={{ width: `${(c.students / maxStrength) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{c.students}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <SectionTitle>Quick actions</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: '/attendance', icon: '✅', label: 'Student attendance' },
          { to: '/staff-attendance', icon: '🕘', label: 'Staff attendance' },
          { to: '/students', icon: '🎒', label: 'Add student' },
          { to: '/staff', icon: '👥', label: 'Add staff' },
        ].map((a) => (
          <Link key={a.to} to={a.to}>
            <Card className="p-4 hover:bg-[#fafaf9] transition-colors">
              <div className="text-2xl">{a.icon}</div>
              <div className="font-medium text-ink-strong mt-2 text-sm">{a.label}</div>
            </Card>
          </Link>
        ))}
      </div>
      {sa.sectionsMarked < sa.sectionsTotal && (
        <p className="mt-4 text-sm text-muted">
          <Tag color="orange">Reminder</Tag> {sa.sectionsTotal - sa.sectionsMarked} classes have not marked attendance today.
        </p>
      )}
    </>
  );
}
