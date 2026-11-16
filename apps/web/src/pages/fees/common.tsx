import { useMemo, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import {
  formatINR,
  monthName,
  PAYMENT_MODE_LABEL,
  type DueDisplay,
  type FeeDueRow,
  type FeePaymentRow,
  type FeeSummary,
} from '@erp/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card, Tabs, Tag, type TagColor } from '../../components/ui';
import { cn, fmtDate } from '../../lib/utils';

export const inr = (p: number) => formatINR(p);

/** '1,250.50' / '1250' → paise; null if not a valid amount. */
export function parseRupees(v: string): number | null {
  const s = v.replace(/[₹,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
/** paise → plain rupees string for inputs ('1250', '1250.5'). */
export const rupeesStr = (p: number) => String(p / 100);

export function useFeePerms() {
  const { can, user } = useAuth();
  const view = can('fees.view');
  const collect = can('fees.collect');
  const manage = can('fees.manage');
  return { view, collect, manage, any: view || collect || manage, isParent: user?.view === 'parent' };
}

export const DUE_TAG: Record<DueDisplay, { label: string; color: TagColor }> = {
  PAID: { label: 'Paid', color: 'green' },
  PARTIAL: { label: 'Partial', color: 'yellow' },
  UNPAID: { label: 'Unpaid', color: 'orange' },
  OVERDUE: { label: 'Overdue', color: 'red' },
  UPCOMING: { label: 'Upcoming', color: 'gray' },
  WAIVED: { label: 'Waived', color: 'purple' },
};

export function DueTag({ display }: { display: DueDisplay }) {
  const t = DUE_TAG[display];
  return (
    <Tag color={t.color}>
      <span className="size-1.5 rounded-full bg-current" />
      {t.label}
    </Tag>
  );
}

export const modeLabel = (m: string) => PAYMENT_MODE_LABEL[m as keyof typeof PAYMENT_MODE_LABEL] ?? m;

export const useFeeSummary = (enabled = true) =>
  useQuery({
    queryKey: ['fees', 'summary'],
    enabled,
    queryFn: async () => (await api.get<FeeSummary>('/fees/summary')).data,
  });

/** Sub-navigation of the staff fees screens. */
export function FeesTabs() {
  const p = useFeePerms();
  const nav = useNavigate();
  const loc = useLocation();
  const tabs = [
    { value: '/fees', label: p.collect ? 'Collect' : 'Students', show: true },
    { value: '/fees/receipts', label: 'Receipts', show: p.view || p.collect },
    { value: '/fees/reports', label: 'Reports', show: p.view },
    { value: '/fees/setup', label: 'Setup', show: p.manage },
  ].filter((t) => t.show);
  const current = tabs.slice().reverse().find((t) => loc.pathname.startsWith(t.value))?.value ?? '/fees';
  return <Tabs tabs={tabs} value={current} onChange={(v) => nav(v)} />;
}

// ─────────────── Dues list (grouped by month) ───────────────

interface DueGroup {
  key: string;
  title: string;
  dues: FeeDueRow[];
}

export function groupDues(dues: FeeDueRow[]): DueGroup[] {
  const m = new Map<string, FeeDueRow[]>();
  for (const d of dues) {
    const k = d.dueDate.slice(0, 7);
    m.set(k, [...(m.get(k) ?? []), d]);
  }
  return [...m.entries()].map(([key, ds]) => ({ key, title: monthName(key), dues: ds }));
}

const isOpen = (d: FeeDueRow) => d.status === 'UNPAID' || d.status === 'PARTIAL';

/**
 * Dues of a student grouped by the month they fall due.
 * With `selected` + `onToggle`, open dues get checkboxes (collection screen).
 */
export function DuesList({
  dues,
  selected,
  onToggle,
  onToggleMany,
  action,
  hidePaidGroups,
}: {
  dues: FeeDueRow[];
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleMany?: (ids: string[], on: boolean) => void;
  action?: (d: FeeDueRow) => ReactNode;
  hidePaidGroups?: boolean;
}) {
  const groups = useMemo(() => groupDues(dues), [dues]);
  const selectable = !!selected && !!onToggle;
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {groups.map((g) => {
        const open = g.dues.filter(isOpen);
        const balance = g.dues.reduce((n, d) => n + d.balance, 0);
        const settled = open.length === 0;
        if (settled && hidePaidGroups) return null;
        const allOn = selectable && open.length > 0 && open.every((d) => selected!.has(d.id));
        return (
          <div key={g.key}>
            <div className={cn('flex items-center gap-2 px-3 py-2 bg-sidebar text-[13px]', settled && 'text-muted')}>
              {selectable && (
                <input
                  type="checkbox"
                  className="size-4 accent-black"
                  disabled={settled}
                  checked={allOn}
                  onChange={(e) => onToggleMany?.(open.map((d) => d.id), e.target.checked)}
                  aria-label={`Select ${g.title}`}
                />
              )}
              <span className="font-semibold text-ink-strong">{g.title}</span>
              <span className="ml-auto tabular-nums">
                {settled ? (
                  g.dues.every((d) => d.status === 'WAIVED') ? (
                    <DueTag display="WAIVED" />
                  ) : (
                    <DueTag display="PAID" />
                  )
                ) : (
                  <span className="font-medium text-ink-strong">{inr(balance)}</span>
                )}
              </span>
            </div>
            {g.dues.map((d) => {
              const on = selectable && selected!.has(d.id);
              const canPick = selectable && isOpen(d);
              return (
                <label
                  key={d.id}
                  className={cn(
                    'flex items-start gap-2.5 px-3 py-2.5 border-t border-line first:border-t-0',
                    canPick && 'cursor-pointer hover:bg-[#fafaf9]',
                    on && 'bg-tag-blue/50',
                  )}
                >
                  {selectable && (
                    <input
                      type="checkbox"
                      className="size-4 mt-0.5 accent-black"
                      disabled={!canPick}
                      checked={on}
                      onChange={() => onToggle!(d.id)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink-strong text-sm">
                      {d.head}
                      {d.frequency !== 'MONTHLY' && <span className="font-normal text-muted"> · {d.label}</span>}
                    </div>
                    <div className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-2">
                      <span>Due {fmtDate(d.dueDate, { day: 'numeric', month: 'short' })}</span>
                      <span>Fee {inr(d.amount)}</span>
                      {d.concession > 0 && <span className="text-tag-green-ink">−{inr(d.concession)} concession</span>}
                      {d.fine > 0 && <span className="text-tag-red-ink">+{inr(d.fine)} fine</span>}
                      {d.pendingFine > 0 && <span className="text-tag-red-ink">+{inr(d.pendingFine)} late fine</span>}
                      {d.paid > 0 && d.status !== 'PAID' && <span>Paid {inr(d.paid)}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn('text-sm tabular-nums', isOpen(d) ? 'font-semibold text-ink-strong' : 'text-muted')}>
                      {inr(isOpen(d) ? d.balance : d.status === 'WAIVED' ? d.amount - d.concession - d.paid : d.paid)}
                    </div>
                    <div className="mt-0.5 flex items-center justify-end gap-1">
                      <DueTag display={d.display} />
                      {action?.(d)}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        );
      })}
    </Card>
  );
}

// ─────────────── Payment history ───────────────

export function PaymentHistory({ payments, empty = 'No payments yet.' }: { payments: FeePaymentRow[]; empty?: string }) {
  if (!payments.length) return <Card className="p-4 text-sm text-muted">{empty}</Card>;
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {payments.map((p) => (
        <Link key={p.id} to={`/fees/receipt/${p.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#fafaf9]">
          <span className="text-lg">🧾</span>
          <div className="min-w-0 flex-1">
            <div className={cn('font-medium text-sm text-ink-strong', p.cancelledAt && 'line-through text-muted')}>{p.receiptNo}</div>
            <div className="text-xs text-muted">
              {fmtDate(p.date)} · {modeLabel(p.mode)}
              {p.collectedBy ? ` · ${p.collectedBy}` : ''}
            </div>
          </div>
          <div className="text-right">
            <div className={cn('font-semibold tabular-nums text-sm', p.cancelledAt && 'line-through text-muted')}>{inr(p.amount)}</div>
            {p.cancelledAt && <Tag color="red">Cancelled</Tag>}
          </div>
          <ChevronRight className="size-4 text-faint" />
        </Link>
      ))}
    </Card>
  );
}

/** Download rows as a CSV file (opens in Excel). */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Today / yesterday / this month quick ranges. */
export function dateRanges(today: string) {
  const d = new Date(`${today}T00:00:00`);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const y = new Date(d);
  y.setDate(d.getDate() - 1);
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: iso(y), to: iso(y) },
    { label: 'This month', from: `${today.slice(0, 7)}-01`, to: today },
  ];
}
