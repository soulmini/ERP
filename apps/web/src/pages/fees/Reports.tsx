import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import type { ClasswiseRow, CollectionReport, DefaulterRow, FeePaymentRow } from '@erp/shared';
import { api } from '../../lib/api';
import { useClasses } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Select, Stat, Table, Tabs, Tag } from '../../components/ui';
import { cn, fmtDate, todayStr } from '../../lib/utils';
import { dateRanges, downloadCsv, FeesTabs, inr, modeLabel } from './common';

// ═════════════════════ Receipts list ═════════════════════

function RangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 no-print">
      <Input type="date" value={from} max={to} onChange={(e) => onChange(e.target.value, to)} className="w-auto" />
      <span className="text-muted text-sm">to</span>
      <Input type="date" value={to} min={from} onChange={(e) => onChange(from, e.target.value)} className="w-auto" />
      {dateRanges(todayStr()).map((r) => (
        <Button key={r.label} size="sm" variant={from === r.from && to === r.to ? 'primary' : 'secondary'} onClick={() => onChange(r.from, r.to)}>
          {r.label}
        </Button>
      ))}
    </div>
  );
}

function ReceiptTable({ rows }: { rows: FeePaymentRow[] }) {
  const nav = useNavigate();
  return (
    <Table>
      <thead>
        <tr>
          <th>Receipt</th>
          <th>Date</th>
          <th>Student</th>
          <th className="!text-right">Amount</th>
          <th>Mode</th>
          <th>Collected by</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="cursor-pointer" onClick={() => nav(`/fees/receipt/${p.id}`)}>
            <td className={cn('font-medium text-ink-strong whitespace-nowrap', p.cancelledAt && 'line-through text-muted')}>
              {p.receiptNo}
              {p.cancelledAt && (
                <Tag color="red" className="ml-1.5 no-underline">
                  Cancelled
                </Tag>
              )}
            </td>
            <td className="text-muted whitespace-nowrap">{fmtDate(p.date, { day: 'numeric', month: 'short' })}</td>
            <td>
              <div className="text-ink-strong">{p.student?.name}</div>
              <div className="text-xs text-muted">
                {p.student?.classLabel ?? '—'} · {p.student?.admissionNo}
              </div>
            </td>
            <td className={cn('text-right tabular-nums font-medium', p.cancelledAt && 'line-through text-muted')}>{inr(p.amount)}</td>
            <td>
              {modeLabel(p.mode)}
              {p.reference && <div className="text-xs text-muted truncate max-w-32">{p.reference}</div>}
            </td>
            <td className="text-muted">{p.collectedBy ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function ReceiptsPage() {
  const [range, setRange] = useState(() => ({ from: todayStr(), to: todayStr() }));
  const q = useQuery({
    queryKey: ['fees', 'payments', range],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<{ items: FeePaymentRow[]; total: number; count: number }>('/fees/payments', { params: range })).data,
  });
  const byMode = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of q.data?.items ?? []) if (!p.cancelledAt) m.set(p.mode, (m.get(p.mode) ?? 0) + p.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [q.data]);
  return (
    <>
      <PageHeader icon="💰" title="Fees" description="Receipts issued" />
      <FeesTabs />
      <RangePicker from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-3">
            <div className="text-2xl font-semibold tabular-nums text-ink-strong">{inr(q.data!.total)}</div>
            <div className="text-sm text-muted">{q.data!.count} receipts</div>
            <div className="flex flex-wrap gap-1.5">
              {byMode.map(([m, amt]) => (
                <Tag key={m} color="gray">
                  {modeLabel(m)} {inr(amt)}
                </Tag>
              ))}
            </div>
          </div>
          {q.data!.items.length ? <ReceiptTable rows={q.data!.items} /> : <Empty icon="🧾" title="No receipts in this period" />}
        </>
      )}
    </>
  );
}

// ═════════════════════ Reports ═════════════════════

type ReportTab = 'collection' | 'defaulters' | 'classwise';

export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('collection');
  return (
    <>
      <PageHeader icon="💰" title="Fees" description="Reports" />
      <div className="no-print">
        <FeesTabs />
      </div>
      <div className="no-print">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'collection', label: '📥 Collection' },
            { value: 'defaulters', label: '⏰ Defaulters' },
            { value: 'classwise', label: '🏫 Class-wise' },
          ]}
        />
      </div>
      {tab === 'collection' && <CollectionTab />}
      {tab === 'defaulters' && <DefaultersTab />}
      {tab === 'classwise' && <ClasswiseTab />}
    </>
  );
}

function Bars({ title, rows }: { title: string; rows: { label: ReactNode; amount: number; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <Card className="p-4">
      <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-3">{title}</div>
      {rows.length ? (
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div key={i}>
              <div className="flex justify-between text-sm">
                <span className="text-ink-strong">{r.label}</span>
                <span className="tabular-nums font-medium">
                  {inr(r.amount)} <span className="text-muted font-normal text-xs">· {r.count}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-tag-gray mt-1">
                <div className="h-1.5 rounded-full bg-ink-strong" style={{ width: `${(r.amount / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted">Nothing collected.</div>
      )}
    </Card>
  );
}

function CollectionTab() {
  const [range, setRange] = useState(() => ({ from: todayStr(), to: todayStr() }));
  const q = useQuery({
    queryKey: ['fees', 'report', 'collection', range],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<CollectionReport>('/fees/reports/collection', { params: range })).data,
  });
  const r = q.data;
  return (
    <>
      <RangePicker from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-muted">
              {fmtDate(r!.from)}
              {r!.to !== r!.from && ` – ${fmtDate(r!.to)}`}
            </div>
            <div className="flex gap-2 no-print">
              <Button
                size="sm"
                icon={<Download className="size-3.5" />}
                onClick={() =>
                  downloadCsv(`collection-${r!.from}-to-${r!.to}.csv`, [
                    ['Receipt', 'Date', 'Student', 'Adm. no', 'Class', 'Amount (Rs)', 'Mode', 'Reference', 'Collected by', 'Status'],
                    ...r!.receipts.map((p) => [
                      p.receiptNo,
                      p.date,
                      p.student?.name,
                      p.student?.admissionNo,
                      p.student?.classLabel,
                      p.amount / 100,
                      modeLabel(p.mode),
                      p.reference,
                      p.collectedBy,
                      p.cancelledAt ? 'Cancelled' : 'OK',
                    ]),
                  ])
                }
              >
                CSV
              </Button>
              <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>
                Print
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Stat icon="💵" label="Collected" value={inr(r!.total)} />
            <Stat icon="🧾" label="Receipts" value={r!.count} />
            <div className="col-span-2 md:col-span-1">
              <Stat icon="🚫" label="Cancelled receipts" value={r!.cancelled} />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <Bars title="By mode" rows={r!.byMode.map((m) => ({ label: modeLabel(m.mode), amount: m.amount, count: m.count }))} />
            <Bars title="By collector" rows={r!.byCollector.map((c) => ({ label: c.name, amount: c.amount, count: c.count }))} />
          </div>
          {r!.byDay.length > 1 && (
            <Card className="p-4 mb-4">
              <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">Day-wise</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-1 text-sm">
                {r!.byDay.map((d) => (
                  <div key={d.date} className="flex justify-between">
                    <span className="text-muted">{fmtDate(d.date, { day: 'numeric', month: 'short' })}</span>
                    <span className="tabular-nums">{inr(d.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {r!.receipts.length ? <ReceiptTable rows={[...r!.receipts].reverse()} /> : <Empty icon="🧾" title="No receipts in this period" />}
        </>
      )}
    </>
  );
}

function DefaultersTab() {
  const classes = useClasses();
  const [date, setDate] = useState(todayStr());
  const [classId, setClassId] = useState('');
  const q = useQuery({
    queryKey: ['fees', 'report', 'defaulters', date, classId],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (
        await api.get<{ date: string; rows: DefaulterRow[]; total: number; totalFine: number }>('/fees/reports/defaulters', {
          params: { date, classId: classId || undefined },
        })
      ).data,
  });
  const groups = useMemo(() => {
    const m = new Map<string, DefaulterRow[]>();
    for (const r of q.data?.rows ?? []) m.set(r.classLabel ?? '—', [...(m.get(r.classLabel ?? '—') ?? []), r]);
    return [...m.entries()];
  }, [q.data]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4 no-print">
        <span className="text-sm text-muted">Overdue as on</span>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-auto min-w-36">
          <option value="">All classes</option>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              Class {c.name}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            icon={<Download className="size-3.5" />}
            disabled={!q.data?.rows.length}
            onClick={() =>
              downloadCsv(`defaulters-${date}.csv`, [
                ['Class', 'Roll', 'Student', 'Adm. no', 'Parent', 'Mobile', 'Installments', 'Overdue since', 'Overdue (Rs)', 'Late fine (Rs)'],
                ...q.data!.rows.map((r) => [
                  r.classLabel,
                  r.rollNo,
                  r.name,
                  r.admissionNo,
                  r.guardianName,
                  r.guardianPhone,
                  r.periods,
                  r.oldestDue,
                  r.overdue / 100,
                  r.pendingFine / 100,
                ]),
              ])
            }
          >
            CSV
          </Button>
          <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.rows.length ? (
        <Empty icon="🎉" title="No defaulters">
          Nobody has overdue fees as on {fmtDate(date)}.
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 mb-3">
            <div className="text-2xl font-semibold tabular-nums text-tag-red-ink">{inr(q.data!.total)}</div>
            <div className="text-sm text-muted">
              overdue from {q.data!.rows.length} students
              {q.data!.totalFine > 0 && ` · late fine ${inr(q.data!.totalFine)} extra`}
            </div>
          </div>
          {groups.map(([label, rows]) => (
            <div key={label} className="mb-5">
              <div className="flex justify-between items-baseline mb-1">
                <h3 className="font-semibold text-ink-strong">Class {label}</h3>
                <span className="text-sm text-muted tabular-nums">
                  {rows.length} · {inr(rows.reduce((n, r) => n + r.overdue, 0))}
                </span>
              </div>
              <Table>
                <thead>
                  <tr>
                    <th className="w-12">Roll</th>
                    <th>Student</th>
                    <th>Parent</th>
                    <th>Since</th>
                    <th className="!text-right">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.studentId}>
                      <td className="text-muted">{r.rollNo ?? '—'}</td>
                      <td>
                        <Link to={`/fees/student/${r.studentId}`} className="text-ink-strong hover:underline">
                          {r.name}
                        </Link>
                        <div className="text-xs text-muted">{r.admissionNo}</div>
                      </td>
                      <td>
                        <div>{r.guardianName ?? '—'}</div>
                        {r.guardianPhone && (
                          <a href={`tel:${r.guardianPhone}`} className="text-xs text-muted hover:underline">
                            {r.guardianPhone}
                          </a>
                        )}
                      </td>
                      <td className="text-muted whitespace-nowrap">
                        {fmtDate(r.oldestDue, { day: 'numeric', month: 'short' })}
                        <div className="text-xs">{r.periods} installments</div>
                      </td>
                      <td className="text-right tabular-nums font-semibold text-ink-strong">
                        {inr(r.overdue)}
                        {r.pendingFine > 0 && <div className="text-xs font-normal text-tag-red-ink">+{inr(r.pendingFine)} fine</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function ClasswiseTab() {
  const q = useQuery({
    queryKey: ['fees', 'report', 'classwise'],
    queryFn: async () => (await api.get<{ session: string; today: string; rows: ClasswiseRow[] }>('/fees/reports/classwise')).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rows = q.data!.rows;
  const t = rows.reduce(
    (a, r) => ({
      students: a.students + r.students,
      expected: a.expected + r.expected,
      collected: a.collected + r.collected,
      outstanding: a.outstanding + r.outstanding,
      dueTillToday: a.dueTillToday + r.dueTillToday,
      overdueStudents: a.overdueStudents + r.overdueStudents,
    }),
    { students: 0, expected: 0, collected: 0, outstanding: 0, dueTillToday: 0, overdueStudents: 0 },
  );
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm text-muted">Session {q.data!.session} · whole-year figures after concessions</div>
        <Button size="sm" className="no-print" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <Table>
        <thead>
          <tr>
            <th>Class</th>
            <th className="!text-right">Students</th>
            <th className="!text-right">Expected</th>
            <th className="!text-right">Collected</th>
            <th className="!text-right">Outstanding</th>
            <th className="!text-right">Due till today</th>
            <th className="!text-right">Overdue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.classId} className={cn(!r.students && 'text-faint')}>
              <td className="font-medium text-ink-strong">Class {r.className}</td>
              <td className="text-right tabular-nums">{r.students}</td>
              <td className="text-right tabular-nums">{inr(r.expected)}</td>
              <td className="text-right tabular-nums">
                {inr(r.collected)}
                {r.expected > 0 && (
                  <div className="h-1 rounded-full bg-tag-gray mt-1 ml-auto w-20">
                    <div className="h-1 rounded-full bg-tag-green-ink" style={{ width: `${pct(r.collected, r.expected)}%` }} />
                  </div>
                )}
              </td>
              <td className="text-right tabular-nums">{inr(r.outstanding)}</td>
              <td className={cn('text-right tabular-nums', r.dueTillToday > 0 && 'text-tag-red-ink font-medium')}>{inr(r.dueTillToday)}</td>
              <td className="text-right tabular-nums">{r.overdueStudents || '—'}</td>
            </tr>
          ))}
          <tr className="font-semibold text-ink-strong bg-sidebar">
            <td>Total</td>
            <td className="text-right tabular-nums">{t.students}</td>
            <td className="text-right tabular-nums">{inr(t.expected)}</td>
            <td className="text-right tabular-nums">
              {inr(t.collected)} <span className="text-xs text-muted font-normal">({pct(t.collected, t.expected)}%)</span>
            </td>
            <td className="text-right tabular-nums">{inr(t.outstanding)}</td>
            <td className="text-right tabular-nums text-tag-red-ink">{inr(t.dueTillToday)}</td>
            <td className="text-right tabular-nums">{t.overdueStudents}</td>
          </tr>
        </tbody>
      </Table>
    </>
  );
}
