import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FileText, IdCard } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Tag } from '../../components/ui';
import { cn, fmtDate, todayStr } from '../../lib/utils';
import { ChildSwitcher } from '../parent/Home';
import { useChildren } from '../parent/useChildren';
import { examRange, timeRange, type ChildExams } from './types';

/** Parent: date sheets, admit cards and published report cards of the selected child. */
export function ParentExams() {
  const { children, child, select, isLoading, error } = useChildren();
  const q = useQuery({
    queryKey: ['child-exams', child?.id],
    enabled: !!child,
    queryFn: async () => (await api.get<ChildExams>(`/exams/child/${child!.id}`)).data,
  });
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const today = todayStr();
  const exams = q.data?.exams ?? [];
  const lastDate = (e: ChildExams['exams'][number]) => e.dateSheet.map((x) => x.date).filter(Boolean).sort().pop() ?? e.endDate;
  const firstDate = (e: ChildExams['exams'][number]) => e.dateSheet.map((x) => x.date).filter(Boolean).sort()[0] ?? e.startDate;
  const upcoming = exams.find((e) => (lastDate(e) ?? '') >= today && e.dateSheet.length);

  return (
    <>
      <PageHeader icon="🧾" title="Exams & results" description={child ? `${child.name}${q.data?.classLabel ? ` · Class ${q.data.classLabel}` : ''}` : undefined} />
      <ChildSwitcher kids={children} child={child} select={select} />
      {!child ? (
        <Empty icon="🎒" title="No student linked">Ask the school office to link your child to this mobile number.</Empty>
      ) : q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !exams.length ? (
        <Card>
          <Empty icon="🗓️" title="No exams yet">The date sheet will appear here when the school publishes it.</Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {exams.map((e) => {
            const first = firstDate(e);
            const last = lastDate(e);
            const status = last && last < today ? 'Completed' : first && first <= today ? 'Ongoing' : 'Upcoming';
            const expanded = open[e.id] ?? e.id === upcoming?.id;
            const nextPaper = e.dateSheet.find((x) => x.date && x.date >= today);
            return (
              <Card key={e.id}>
                <button className="w-full text-left px-4 py-3 flex items-start gap-3" onClick={() => setOpen((o) => ({ ...o, [e.id]: !expanded }))}>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink-strong">{e.name}</span>
                      <Tag color={status === 'Upcoming' ? 'blue' : status === 'Ongoing' ? 'orange' : 'gray'}>{status}</Tag>
                      {e.resultPublished && <Tag color="green">Result out</Tag>}
                    </div>
                    <div className="text-sm text-muted mt-0.5">{examRange(first, last)}</div>
                    {status !== 'Completed' && nextPaper && (
                      <div className="text-xs text-ink mt-1">
                        Next: <b>{nextPaper.name}</b> on {fmtDate(nextPaper.date!, { weekday: 'short', day: 'numeric', month: 'short' })}
                      </div>
                    )}
                  </div>
                  <ChevronDown className={cn('size-4 text-faint mt-1 transition-transform', expanded && 'rotate-180')} />
                </button>
                {expanded && e.dateSheet.length > 0 && (
                  <div className="border-t border-line divide-y divide-line">
                    {e.dateSheet.map((x) => (
                      <div key={x.subjectId} className={cn('flex items-center gap-3 px-4 py-2 text-sm', x.date && x.date < today && 'text-muted')}>
                        <div className="w-24 shrink-0 tabular-nums">{x.date ? fmtDate(x.date, { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</div>
                        <div className="flex-1 font-medium">{x.name}</div>
                        <div className="text-xs text-muted text-right">{timeRange(x.startTime, x.endTime)}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-line">
                  {e.dateSheet.length > 0 && status !== 'Completed' && (
                    <Link to={`/exams/${e.id}/admit-cards?studentId=${child.id}`}>
                      <Button size="sm" icon={<IdCard className="size-3.5" />}>
                        Admit card
                      </Button>
                    </Link>
                  )}
                  {e.resultPublished ? (
                    <Link to={`/exams/${e.id}/report-cards?studentId=${child.id}`}>
                      <Button size="sm" variant="primary" icon={<FileText className="size-3.5" />}>
                        Report card
                      </Button>
                    </Link>
                  ) : (
                    status === 'Completed' && <span className="text-xs text-muted self-center">Result not published yet</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
