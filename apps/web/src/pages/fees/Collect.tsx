import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Ellipsis, Plus, Search, X } from 'lucide-react';
import {
  allocatePayment,
  PAYMENT_MODES,
  type CollectMode,
  type FeeCard,
  type FeeDueRow,
  type FeeHeadRow,
  type FeePaymentRow,
  type FeeSearchRow,
} from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { sectionOptions, useClasses } from '../../lib/queries';
import {
  Avatar,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  SectionTitle,
  Select,
  Stat,
  Tag,
} from '../../components/ui';
import { cn, fmtDate, todayStr } from '../../lib/utils';
import { DuesList, FeesTabs, inr, modeLabel, parseRupees, PaymentHistory, rupeesStr, useFeePerms, useFeeSummary } from './common';

// ═════════════════════ Home: find a student ═════════════════════

export function FeesHome() {
  const p = useFeePerms();
  const nav = useNavigate();
  const summary = useFeeSummary();
  const classes = useClasses();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sectionId, setSectionId] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ['fees', 'search', debounced, sectionId],
    enabled: !!debounced || !!sectionId,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<FeeSearchRow[]>('/fees/students', { params: { q: debounced || undefined, sectionId: sectionId || undefined } })).data,
  });
  const today = useQuery({
    queryKey: ['fees', 'payments', 'today'],
    enabled: p.view || p.collect,
    queryFn: async () => (await api.get<{ items: FeePaymentRow[] }>('/fees/payments')).data,
  });
  const s = summary.data;
  const rows = debounced || sectionId ? (results.data ?? []) : [];

  return (
    <>
      <PageHeader icon="💰" title="Fees" description={p.collect ? 'Find a student to collect fees' : 'Student fee cards'} />
      <FeesTabs />
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          <Stat icon="💵" label="Collected today" value={inr(s.todayCollection)} sub={`${s.todayReceipts} receipts`} />
          <Stat icon="📅" label="This month" value={inr(s.monthCollection)} />
          <div className="col-span-2 md:col-span-1">
            <Stat icon="⏳" label="Outstanding till today" value={inr(s.outstanding)} sub={`${s.overdueStudents} students overdue`} />
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="size-4 text-faint absolute left-3 top-3.5" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rows[0]) nav(`/fees/student/${rows[0].id}`);
            }}
            placeholder="Search name, admission no. or parent mobile"
            className="h-11 pl-9 text-[15px]"
          />
        </div>
        <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="h-11 sm:w-44">
          <option value="">All classes</option>
          {sectionOptions(classes.data).map((o) => (
            <option key={o.id} value={o.id}>
              Class {o.label}
            </option>
          ))}
        </Select>
      </div>

      {results.isFetching && !results.data ? (
        <Loading />
      ) : results.error ? (
        <ErrorBox error={results.error} />
      ) : debounced || sectionId ? (
        rows.length ? (
          <Card className="divide-y divide-line overflow-hidden">
            {rows.map((r) => (
              <Link key={r.id} to={`/fees/student/${r.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#fafaf9]">
                <Avatar name={r.name} src={r.photoUrl} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink-strong truncate">{r.name}</div>
                  <div className="text-xs text-muted truncate">
                    {r.classLabel ? `Class ${r.classLabel}` : '—'}
                    {r.rollNo ? ` · Roll ${r.rollNo}` : ''} · {r.admissionNo}
                    {r.guardianName ? ` · ${r.guardianName}` : ''}
                    {r.guardianPhone ? ` · ${r.guardianPhone}` : ''}
                  </div>
                </div>
                {r.dueTillToday > 0 ? (
                  <div className="text-right">
                    <div className="font-semibold tabular-nums text-tag-red-ink">{inr(r.dueTillToday)}</div>
                    <div className="text-[11px] text-muted">due</div>
                  </div>
                ) : (
                  <Tag color="green">No dues</Tag>
                )}
              </Link>
            ))}
          </Card>
        ) : (
          <Empty icon="🔍" title="No student found">
            Try part of the name, the admission number or the parent's mobile number.
          </Empty>
        )
      ) : p.view || p.collect ? (
        <>
          <SectionTitle action={<Link to="/fees/receipts" className="text-[13px] text-muted hover:underline">All receipts</Link>}>
            Today's receipts
          </SectionTitle>
          {today.data && <PaymentHistory payments={today.data.items.slice(0, 8)} empty="No receipts yet today." />}
        </>
      ) : null}
    </>
  );
}

// ═════════════════════ Student fee card + collect ═════════════════════

export function StudentFeesPage() {
  const { id } = useParams();
  const p = useFeePerms();
  const q = useQuery({
    queryKey: ['fees', 'card', id],
    queryFn: async () => (await api.get<FeeCard>(`/fees/students/${id}/card`)).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  return <StudentFees card={c} canCollect={p.collect} canManage={p.manage} />;
}

const MODE_SHORT: Record<CollectMode, string> = { CASH: 'Cash', UPI: 'UPI', CHEQUE: 'Cheque', BANK_TRANSFER: 'Bank', CARD: 'Card' };

function defaultSelection(dues: FeeDueRow[], today: string) {
  return new Set(
    dues.filter((d) => (d.status === 'UNPAID' || d.status === 'PARTIAL') && d.dueDate.slice(0, 7) <= today.slice(0, 7)).map((d) => d.id),
  );
}

function StudentFees({ card: c, canCollect, canManage }: { card: FeeCard; canCollect: boolean; canManage: boolean }) {
  const s = c.student;
  const [waiving, setWaiving] = useState<FeeDueRow | null>(null);
  const [addConcession, setAddConcession] = useState(false);
  const [showPaid, setShowPaid] = useState(false);
  const [selected, setSelected] = useState(() => defaultSelection(c.dues, c.today));
  // Fresh card (after a payment / waiver) → default selection: everything due up to this month.
  useEffect(() => setSelected(defaultSelection(c.dues, c.today)), [c]);
  const sel: Sel = {
    selected,
    set: setSelected,
    toggle: (id) =>
      setSelected((cur) => {
        const n = new Set(cur);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    setMany: (ids, on) =>
      setSelected((cur) => {
        const n = new Set(cur);
        ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
        return n;
      }),
  };

  return (
    <>
      <Link to="/fees" className="no-print inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Find another student
      </Link>

      <Card className="p-4 md:p-5 mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={s.name} src={s.photoUrl} size={52} />
          <div className="min-w-0 flex-1">
            <div className="text-xl font-semibold text-ink-strong">{s.name}</div>
            <div className="text-sm text-muted">
              Class {s.classLabel ?? '—'} · Roll {s.rollNo ?? '—'} · Adm. {s.admissionNo}
            </div>
            <div className="text-xs text-muted mt-0.5">
              {s.fatherName ? `Father: ${s.fatherName}` : s.guardianName ? `Guardian: ${s.guardianName}` : ''}
              {s.guardianPhone && (
                <>
                  {' · '}
                  <a href={`tel:${s.guardianPhone}`} className="hover:underline">
                    {s.guardianPhone}
                  </a>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-5 text-right">
            <div>
              <div className="text-[12px] text-muted">Due till today</div>
              <div className={cn('text-xl font-bold tabular-nums', c.totals.dueTillToday ? 'text-tag-red-ink' : 'text-tag-green-ink')}>
                {inr(c.totals.dueTillToday)}
              </div>
            </div>
            <div className="hidden sm:block">
              <div className="text-[12px] text-muted">Session balance</div>
              <div className="text-xl font-semibold tabular-nums text-ink-strong">{inr(c.totals.balance)}</div>
            </div>
            <div className="hidden sm:block">
              <div className="text-[12px] text-muted">Paid</div>
              <div className="text-xl font-semibold tabular-nums text-ink-strong">{inr(c.totals.paid)}</div>
            </div>
          </div>
        </div>
        {c.generated > 0 && <div className="mt-3 text-xs text-muted">✨ {c.generated} dues were created for this student from the class fee structure.</div>}
      </Card>

      {!c.dues.length ? (
        <Empty icon="🧾" title="No dues for this session">
          {s.classLabel ? 'No fee structure is set for this class yet. Set it up under Fees → Setup.' : 'This student is not enrolled in the current session.'}
        </Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
          {canCollect && (
            <div className="lg:order-last lg:sticky lg:top-4">
              <CollectPanel card={c} sel={sel} />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-semibold text-muted uppercase tracking-wide">Dues · {c.session.name}</h2>
              <label className="flex items-center gap-1.5 text-[13px] text-muted">
                <input type="checkbox" className="accent-black" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />
                Show paid months
              </label>
            </div>
            <DuesBlock card={c} sel={sel} canCollect={canCollect} showPaid={showPaid} canManage={canManage} onWaive={setWaiving} />

            <SectionTitle>Receipts</SectionTitle>
            <PaymentHistory payments={c.payments} />

            <SectionTitle
              action={
                canManage && (
                  <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddConcession(true)}>
                    Add
                  </Button>
                )
              }
            >
              Concessions
            </SectionTitle>
            <ConcessionList card={c} canManage={canManage} />
          </div>
        </div>
      )}
      {waiving && <WaiveModal due={waiving} onClose={() => setWaiving(null)} />}
      {addConcession && <ConcessionModal studentId={s.id} studentName={s.name} onClose={() => setAddConcession(false)} />}
    </>
  );
}

interface Sel {
  selected: Set<string>;
  set: (s: Set<string>) => void;
  toggle: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
}

function DuesBlock({
  card,
  sel,
  canCollect,
  showPaid,
  canManage,
  onWaive,
}: {
  card: FeeCard;
  sel: Sel;
  canCollect: boolean;
  showPaid: boolean;
  canManage: boolean;
  onWaive: (d: FeeDueRow) => void;
}) {
  const qc = useQueryClient();
  const unwaive = useMutation({
    mutationFn: async (id: string) => api.post(`/fees/dues/${id}/unwaive`, {}),
    onSuccess: () => {
      toast.success('Waiver removed');
      qc.invalidateQueries({ queryKey: ['fees'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <DuesList
      dues={card.dues}
      hidePaidGroups={!showPaid}
      selected={canCollect ? sel.selected : undefined}
      onToggle={canCollect ? sel.toggle : undefined}
      onToggleMany={canCollect ? sel.setMany : undefined}
      action={
        canManage
          ? (d) =>
              d.status === 'WAIVED' ? (
                <button
                  className="text-[11px] text-muted hover:underline"
                  onClick={(e) => (e.preventDefault(), e.stopPropagation(), unwaive.mutate(d.id))}
                >
                  Undo
                </button>
              ) : d.status !== 'PAID' ? (
                <button
                  className="p-0.5 rounded hover:bg-hover text-faint"
                  title="Waive this due"
                  onClick={(e) => (e.preventDefault(), e.stopPropagation(), onWaive(d))}
                >
                  <Ellipsis className="size-3.5" />
                </button>
              ) : null
          : undefined
      }
    />
  );
}

function CollectPanel({ card, sel }: { card: FeeCard; sel: Sel }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [date, setDate] = useState(card.today ?? todayStr());
  const [mode, setMode] = useState<CollectMode>('CASH');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [waiveFine, setWaiveFine] = useState(false);
  const [amountText, setAmountText] = useState<string | null>(null); // null = follow selection

  const open = card.dues.filter((d) => d.status === 'UNPAID' || d.status === 'PARTIAL');
  const picked = open.filter((d) => sel.selected.has(d.id));
  const pool = picked.length ? picked : open;
  const full = allocatePayment(pool, { date, waiveFine });
  const typed = amountText == null ? null : parseRupees(amountText);
  const amount = amountText == null ? (picked.length ? full.payable : 0) : (typed ?? 0);
  const preview = allocatePayment(pool, { amount, date, waiveFine });
  const fineInSelection = allocatePayment(pool, { date }).fineCharged;
  const byId = new Map(card.dues.map((d) => [d.id, d]));
  const over = amount > full.payable;

  // Selection changed → amount follows it again.
  const selKey = [...sel.selected].sort().join();
  useEffect(() => setAmountText(null), [selKey]);

  const collect = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ id: string; receiptNo: string }>('/fees/payments', {
          studentId: card.student.id,
          date,
          mode,
          reference: reference || undefined,
          remarks: remarks || undefined,
          amount,
          dueIds: picked.length ? picked.map((d) => d.id) : undefined,
          waiveFine,
        })
      ).data,
    onSuccess: (r) => {
      toast.success(`Receipt ${r.receiptNo} saved`);
      qc.invalidateQueries({ queryKey: ['fees'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      nav(`/fees/receipt/${r.id}?new=1`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!open.length) {
    return (
      <Card className="p-5 text-center">
        <div className="text-3xl mb-2">✅</div>
        <div className="font-medium text-ink-strong">All dues are paid</div>
        <div className="text-sm text-muted mt-1">Nothing to collect for this session.</div>
      </Card>
    );
  }

  const canSubmit = amount > 0 && !over && (mode !== 'CHEQUE' || !!reference.trim());
  return (
    <Card className="p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink-strong">Collect fee</h2>
        <div className="flex gap-2 text-[12px]">
          <button className="text-muted hover:underline" onClick={() => sel.set(defaultSelection(card.dues, card.today))}>
            Due till now
          </button>
          <button className="text-muted hover:underline" onClick={() => sel.set(new Set(open.map((d) => d.id)))}>
            All
          </button>
          <button className="text-muted hover:underline" onClick={() => sel.set(new Set())}>
            Clear
          </button>
        </div>
      </div>
      <div className="text-[13px] text-muted -mt-1">
        {picked.length
          ? `${picked.length} due${picked.length > 1 ? 's' : ''} selected · ${inr(full.payable)}`
          : 'No dues ticked — type an amount, it is applied to the oldest dues first.'}
      </div>

      <Field label="Amount (₹)" error={over ? `More than due — max ${inr(full.payable)}` : undefined}>
        <Input
          inputMode="decimal"
          value={amountText ?? (amount ? rupeesStr(amount) : '')}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder="0"
          className="h-11 text-lg font-semibold tabular-nums"
        />
      </Field>

      {fineInSelection > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-black" checked={waiveFine} onChange={(e) => setWaiveFine(e.target.checked)} />
          <span>
            Waive late fine <span className="text-tag-red-ink tabular-nums">{inr(fineInSelection)}</span>
          </span>
        </label>
      )}

      <div>
        <div className="text-[13px] font-medium text-muted mb-1">Mode</div>
        <div className="grid grid-cols-5 gap-1">
          {PAYMENT_MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'h-8 rounded-md border text-[13px] transition-colors',
                mode === m ? 'bg-ink-strong text-white border-ink-strong' : 'bg-white border-line hover:bg-hover',
              )}
            >
              {MODE_SHORT[m]}
            </button>
          ))}
        </div>
      </div>
      {mode !== 'CASH' && (
        <Field label={mode === 'CHEQUE' ? 'Cheque no. & bank' : 'Reference / transaction no.'}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={mode === 'UPI' ? 'UPI ref no.' : ''} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date">
          <Input type="date" value={date} max={card.today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Remarks">
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      {preview.lines.length > 0 && !over && (
        <div className="rounded-md bg-sidebar px-3 py-2 text-[12px] space-y-0.5">
          {preview.lines.slice(0, 6).map((l) => {
            const d = byId.get(l.id)!;
            return (
              <div key={l.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {d.head} · {d.frequency === 'MONTHLY' ? d.label.replace(/ \d{4}$/, '') : d.label}
                  {l.status === 'PARTIAL' && <span className="text-tag-yellow-ink"> (part)</span>}
                  {l.fine > 0 && <span className="text-tag-red-ink"> +fine</span>}
                </span>
                <span className="tabular-nums">{inr(l.amount)}</span>
              </div>
            );
          })}
          {preview.lines.length > 6 && <div className="text-muted">and {preview.lines.length - 6} more…</div>}
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={!canSubmit}
        loading={collect.isPending}
        onClick={() => collect.mutate()}
      >
        Collect {amount > 0 ? inr(amount) : ''} · {modeLabel(mode)}
      </Button>
    </Card>
  );
}

// ─────────────── Concessions on the card ───────────────

function ConcessionList({ card, canManage }: { card: FeeCard; canManage: boolean }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/fees/concessions/${id}`),
    onSuccess: () => {
      toast.success('Concession removed; unpaid dues updated');
      qc.invalidateQueries({ queryKey: ['fees'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!card.concessions.length) return <Card className="p-4 text-sm text-muted">No concessions.</Card>;
  return (
    <Card className="divide-y divide-line">
      {card.concessions.map((c) => (
        <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
          <Tag color="green">{c.percent != null ? `${c.percent}%` : `${inr(c.amount ?? 0)}/period`}</Tag>
          <div className="min-w-0 flex-1 text-sm">
            <div className="text-ink-strong">{c.head ?? 'All fee heads'}</div>
            <div className="text-xs text-muted truncate">{c.reason}</div>
          </div>
          {canManage && (
            <button
              className="p-1 rounded hover:bg-hover text-muted"
              title="Remove"
              onClick={() => confirm('Remove this concession? Unpaid dues will be recalculated.') && del.mutate(c.id)}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}
    </Card>
  );
}

export function ConcessionModal({ studentId, studentName, onClose }: { studentId?: string; studentName?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const heads = useQuery({ queryKey: ['fees', 'heads'], queryFn: async () => (await api.get<FeeHeadRow[]>('/fees/heads')).data });
  const [student, setStudent] = useState<{ id: string; name: string } | null>(studentId ? { id: studentId, name: studentName ?? '' } : null);
  const [search, setSearch] = useState('');
  const found = useQuery({
    queryKey: ['fees', 'search', search.trim(), ''],
    enabled: !student && search.trim().length >= 2,
    queryFn: async () => (await api.get<FeeSearchRow[]>('/fees/students', { params: { q: search.trim() } })).data,
  });
  const [feeHeadId, setFeeHeadId] = useState('');
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const v = kind === 'percent' ? Math.round(Number(value)) : parseRupees(value);
      return (
        await api.post<{ applied: { updated: number } }>('/fees/concessions', {
          studentId: student!.id,
          feeHeadId: feeHeadId || null,
          percent: kind === 'percent' ? v : null,
          amount: kind === 'amount' ? v : null,
          reason,
        })
      ).data;
    },
    onSuccess: (r) => {
      toast.success(`Concession added · ${r.applied.updated} unpaid dues updated`);
      qc.invalidateQueries({ queryKey: ['fees'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add concession"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!student || !value || reason.trim().length < 2} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        {student ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Student:</span>
            <b>{student.name}</b>
            {!studentId && (
              <button className="text-muted hover:underline text-xs" onClick={() => setStudent(null)}>
                change
              </button>
            )}
          </div>
        ) : (
          <Field label="Student">
            <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / admission no." />
            {found.data && (
              <div className="border border-line rounded-md mt-1 max-h-48 overflow-y-auto divide-y divide-line">
                {found.data.map((r) => (
                  <button key={r.id} className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-hover" onClick={() => setStudent({ id: r.id, name: r.name })}>
                    {r.name} <span className="text-muted text-xs">· {r.classLabel} · {r.admissionNo}</span>
                  </button>
                ))}
                {!found.data.length && <div className="px-2.5 py-1.5 text-sm text-muted">No match</div>}
              </div>
            )}
          </Field>
        )}
        <Field label="Fee head">
          <Select value={feeHeadId} onChange={(e) => setFeeHeadId(e.target.value)}>
            <option value="">All fee heads</option>
            {heads.data?.filter((h) => h.isActive).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}>
              <option value="percent">Percent off</option>
              <option value="amount">Flat ₹ off per period</option>
            </Select>
          </Field>
          <Field label={kind === 'percent' ? 'Percent (1–100)' : 'Amount (₹)'}>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'percent' ? '25' : '100'} />
          </Field>
        </div>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sibling, staff ward, scholarship…" />
        </Field>
        <p className="text-xs text-muted">Applies to this session's unpaid dues right away. Paid dues are not changed.</p>
      </div>
    </Modal>
  );
}

function WaiveModal({ due, onClose }: { due: FeeDueRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: async () => api.post(`/fees/dues/${due.id}/waive`, { reason }),
    onSuccess: () => {
      toast.success('Due waived');
      qc.invalidateQueries({ queryKey: ['fees'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Waive due"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate()}>
            Waive {inr(due.balance)}
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2 text-sm">
        <p>
          <b>{due.head}</b> · {due.label} — balance <b>{inr(due.balance)}</b> (due {fmtDate(due.dueDate)}). The student will not be asked to pay
          it. Use this for students who joined late or special cases.
        </p>
        <Field label="Reason">
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Joined in August" />
        </Field>
      </div>
    </Modal>
  );
}
