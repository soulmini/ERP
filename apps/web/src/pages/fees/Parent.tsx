import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FeeCard } from '@erp/shared';
import { api } from '../../lib/api';
import { Card, Empty, ErrorBox, Loading, PageHeader, SectionTitle, Stat, Tag } from '../../components/ui';
import { ChildSwitcher } from '../parent/Home';
import { useChildren } from '../parent/useChildren';
import { DuesList, inr, PaymentHistory } from './common';

export function ParentFees() {
  const { children, child, select, isLoading, error } = useChildren();
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({
    queryKey: ['fees', 'parent', child?.id],
    enabled: !!child,
    queryFn: async () => (await api.get<FeeCard>(`/fees/parent/children/${child!.id}`)).data,
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const c = q.data;

  return (
    <>
      <PageHeader icon="💰" title="Fees" description="Dues and receipts" />
      <ChildSwitcher kids={children} child={child} select={select} />
      {!child ? (
        <Empty icon="🎒" title="No student linked">
          Ask the school office to link your child to this mobile number.
        </Empty>
      ) : q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <Card className="p-5">
            <div className="text-sm text-muted">
              {c!.student.name} · Class {c!.student.classLabel ?? '—'} · {c!.session.name}
            </div>
            {c!.totals.dueTillToday > 0 ? (
              <>
                <div className="text-[13px] text-muted mt-3">Due till today</div>
                <div className="text-3xl font-bold tabular-nums text-tag-red-ink">{inr(c!.totals.dueTillToday)}</div>
                {c!.totals.pendingFine > 0 && (
                  <div className="text-xs text-tag-red-ink mt-0.5">+ late fine {inr(c!.totals.pendingFine)} if paid today</div>
                )}
              </>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-2xl">✅</span>
                <span className="text-lg font-semibold text-tag-green-ink">All dues paid till today</span>
              </div>
            )}
            <div className="mt-4 rounded-md bg-sidebar px-3 py-2 text-sm text-ink">
              🏫 Please pay at the school office (cash, UPI or cheque). You'll get a printed receipt, and it will also appear here.
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <Stat icon="🧾" label="Paid this session" value={inr(c!.totals.paid)} />
            <Stat icon="📆" label="Rest of the session" value={inr(c!.totals.balance - c!.totals.dueTillToday)} sub="not yet due" />
          </div>

          {c!.concessions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {c!.concessions.map((x) => (
                <Tag key={x.id} color="green">
                  🎁 {x.percent != null ? `${x.percent}%` : `${inr(x.amount ?? 0)}/period`} off {x.head ?? 'all fees'} · {x.reason}
                </Tag>
              ))}
            </div>
          )}

          <SectionTitle
            action={
              <label className="flex items-center gap-1.5 text-[13px] text-muted normal-case">
                <input type="checkbox" className="accent-black" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                Show paid months
              </label>
            }
          >
            Fees by month
          </SectionTitle>
          {c!.dues.length ? (
            <DuesList dues={c!.dues} hidePaidGroups={!showAll} />
          ) : (
            <Card className="p-4 text-sm text-muted">The school has not published this session's fees yet.</Card>
          )}

          <SectionTitle>Receipts</SectionTitle>
          <PaymentHistory payments={c!.payments} />
        </>
      )}
    </>
  );
}
