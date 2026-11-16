import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { AttTag, Avatar, Card, Empty, ErrorBox, Loading, PageHeader, SectionTitle, Stat } from '../../components/ui';
import { cn, fmtDate, greeting, todayStr } from '../../lib/utils';
import { useChildren, type Child } from './useChildren';

export function ChildSwitcher({ kids, child, select }: { kids: Child[]; child: Child | null; select: (id: string) => void }) {
  if (kids.length < 2) return null;
  return (
    <div className="flex gap-2 overflow-x-auto mb-5 -mx-4 px-4 md:mx-0 md:px-0">
      {kids.map((c) => (
        <button
          key={c.id}
          onClick={() => select(c.id)}
          className={cn(
            'flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border text-sm whitespace-nowrap transition-colors',
            c.id === child?.id ? 'bg-ink-strong text-white border-ink-strong' : 'bg-white border-line hover:bg-hover',
          )}
        >
          <Avatar name={c.name} src={c.photoUrl} size={24} />
          {c.name.split(' ')[0]}
        </button>
      ))}
    </div>
  );
}

export function ParentHome() {
  const { user } = useAuth();
  const { children, child, select, isLoading, error } = useChildren();
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <PageHeader icon="👋" title={`${greeting()}`} description={`${user?.name} · ${fmtDate(todayStr(), { weekday: 'long', day: 'numeric', month: 'long' })}`} />
      <ChildSwitcher kids={children} child={child} select={select} />
      {!child ? (
        <Empty icon="🎒" title="No student linked">
          Ask the school office to link your child to this mobile number.
        </Empty>
      ) : (
        <>
          <Card className="p-5 flex items-center gap-4">
            <Avatar name={child.name} src={child.photoUrl} size={56} />
            <div className="min-w-0">
              <div className="text-lg font-semibold text-ink-strong">{child.name}</div>
              <div className="text-sm text-muted">
                Class {child.classLabel ?? '—'} · Roll {child.rollNo ?? '—'} · {child.admissionNo}
              </div>
              {child.classTeacher && <div className="text-xs text-faint mt-0.5">Class teacher: {child.classTeacher}</div>}
            </div>
          </Card>

          <SectionTitle>Today</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="text-[13px] text-muted">✅ Attendance</div>
              <div className="mt-2">
                <AttTag status={child.todayStatus} />
              </div>
            </Card>
            <Stat icon="📅" label="This month" value={child.monthPercent == null ? '—' : `${child.monthPercent}%`} sub="attendance" />
          </div>

          <SectionTitle>Explore</SectionTitle>
          <Card className="divide-y divide-line">
            {[
              { to: '/parent/attendance', icon: '✅', label: 'Attendance calendar', sub: 'Day-by-day record' },
              { to: '/homework', icon: '📒', label: 'Homework', sub: 'Daily homework from teachers' },
              { to: '/fees', icon: '💰', label: 'Fees & receipts', sub: 'Dues and payment history' },
              { to: '/exams', icon: '🧾', label: 'Results & admit card', sub: 'Date sheet, admit card, report card' },
              { to: '/timetable', icon: '🗓️', label: 'Time table', sub: 'Class schedule' },
              { to: '/notices', icon: '📣', label: 'Notices', sub: 'Circulars and holidays' },
            ].map((x) => (
              <Link key={x.to} to={x.to} className="flex items-center gap-3 px-4 py-3 hover:bg-[#fafaf9]">
                <span className="text-xl">{x.icon}</span>
                <div className="flex-1">
                  <div className="font-medium text-ink-strong text-sm">{x.label}</div>
                  <div className="text-xs text-muted">{x.sub}</div>
                </div>
                <ChevronRight className="size-4 text-faint" />
              </Link>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
