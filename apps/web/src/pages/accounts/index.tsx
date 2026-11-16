import { useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { FINANCE_MODE_LABELS, FINANCE_PAYMENT_MODES, accountCategorySchema, accountTxnSchema, formatINR, type TxnKind } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Tabs, Tag } from '../../components/ui';
import { MonthNav } from '../../components/attendance';
import { cn, downloadCsv, fmtDate, monthStr, paiseInput, rupeesInput, todayStr } from '../../lib/utils';
import { zodErrors } from './zod';

interface Category {
  id: string;
  name: string;
  type: TxnKind;
  used: number;
}
interface Txn {
  id: string;
  date: string;
  type: TxnKind;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  amount: number;
  mode: string;
  party: string | null;
  description: string | null;
  reference: string | null;
}
interface BookEntry {
  id: string;
  source: 'FEE' | 'SALARY' | 'MANUAL';
  date: string;
  type: TxnKind;
  title: string;
  category: string;
  mode: string;
  reference: string | null;
  amount: number;
}

const modeLabel = (m: string) => FINANCE_MODE_LABELS[m as keyof typeof FINANCE_MODE_LABELS] ?? m;
const monthStart = () => `${monthStr()}-01`;

/** Accounts module. Mounted at /accounts/*. */
export function AccountsModule() {
  return (
    <Routes>
      <Route index element={<AccountsPage />} />
    </Routes>
  );
}

function AccountsPage() {
  const [tab, setTab] = useState<'daybook' | 'entries' | 'summary' | 'categories'>('daybook');
  const [adding, setAdding] = useState<TxnKind | null>(null);
  return (
    <>
      <PageHeader
        icon="📊"
        title="Accounts"
        description="Fee receipts and salary payments appear here automatically. Add other income and expenses yourself."
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setAdding('INCOME')}>
              Income
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding('EXPENSE')}>
              Expense
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'daybook', label: 'Day book' },
          { value: 'entries', label: 'Income & expenses' },
          { value: 'summary', label: 'Monthly summary' },
          { value: 'categories', label: 'Categories' },
        ]}
      />
      {tab === 'daybook' && <DayBook />}
      {tab === 'entries' && <Entries />}
      {tab === 'summary' && <Summary />}
      {tab === 'categories' && <Categories />}
      {adding && <TxnForm type={adding} onClose={() => setAdding(null)} />}
    </>
  );
}

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input type="date" value={from} max={to} onChange={(e) => onChange(e.target.value, to)} className="w-auto" />
      <span className="text-muted text-sm">to</span>
      <Input type="date" value={to} min={from} onChange={(e) => onChange(from, e.target.value)} className="w-auto" />
    </div>
  );
}

// ───────── Day book ─────────

function DayBook() {
  const [range, setRange] = useState({ from: monthStart(), to: todayStr() });
  const q = useQuery({
    queryKey: ['accounts', 'daybook', range],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<{ entries: BookEntry[]; totals: { income: number; expense: number; net: number }; byMode: Record<string, { income: number; expense: number }> }>(
        '/accounts/daybook',
        { params: range },
      )).data,
  });
  const d = q.data;
  const exportCsv = () =>
    d &&
    downloadCsv(`day-book-${range.from}-to-${range.to}.csv`, [
      ['Date', 'Particulars', 'Category', 'Mode', 'Reference', 'Income', 'Expense'],
      ...d.entries.map((e) => [e.date, e.title, e.category, modeLabel(e.mode), e.reference, e.type === 'INCOME' ? e.amount / 100 : '', e.type === 'EXPENSE' ? e.amount / 100 : '']),
      ['', 'Total', '', '', '', d.totals.income / 100, d.totals.expense / 100],
    ]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!d?.entries.length}>
          CSV
        </Button>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <Stat icon="⬇️" label="Income" value={formatINR(d!.totals.income)} />
            <Stat icon="⬆️" label="Expense" value={formatINR(d!.totals.expense)} />
            <Stat icon="🟰" label="Net" value={<span className={d!.totals.net < 0 ? 'text-tag-red-ink' : ''}>{formatINR(d!.totals.net)}</span>} />
          </div>
          {Object.keys(d!.byMode).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4 text-sm">
              {Object.entries(d!.byMode).map(([mode, v]) => (
                <span key={mode} className="rounded-md border border-line px-2.5 py-1">
                  <span className="text-muted">{modeLabel(mode)}:</span> <span className="text-tag-green-ink">+{formatINR(v.income)}</span>{' '}
                  <span className="text-tag-red-ink">−{formatINR(v.expense)}</span>
                </span>
              ))}
            </div>
          )}
          {!d!.entries.length ? (
            <Empty icon="📒" title="No entries in this period" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th>Mode</th>
                  <th className="!text-right">Income</th>
                  <th className="!text-right">Expense</th>
                </tr>
              </thead>
              <tbody>
                {d!.entries.map((e) => (
                  <tr key={`${e.source}-${e.id}`}>
                    <td className="whitespace-nowrap text-muted">{fmtDate(e.date, { day: 'numeric', month: 'short' })}</td>
                    <td>
                      <div className="text-ink-strong">{e.title}</div>
                      <div className="flex gap-1 mt-0.5">
                        <Tag color={e.source === 'FEE' ? 'green' : e.source === 'SALARY' ? 'purple' : 'gray'}>{e.category}</Tag>
                        {e.reference && <span className="text-xs text-muted">Ref {e.reference}</span>}
                      </div>
                    </td>
                    <td className="text-muted whitespace-nowrap">{modeLabel(e.mode)}</td>
                    <td className="text-right tabular-nums text-tag-green-ink">{e.type === 'INCOME' ? formatINR(e.amount) : ''}</td>
                    <td className="text-right tabular-nums text-tag-red-ink">{e.type === 'EXPENSE' ? formatINR(e.amount) : ''}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td />
                  <td>Total</td>
                  <td />
                  <td className="text-right tabular-nums">{formatINR(d!.totals.income)}</td>
                  <td className="text-right tabular-nums">{formatINR(d!.totals.expense)}</td>
                </tr>
              </tbody>
            </Table>
          )}
        </>
      )}
    </>
  );
}

// ───────── Manual entries ─────────

const useCategories = () =>
  useQuery({ queryKey: ['accounts', 'categories'], queryFn: async () => (await api.get<Category[]>('/accounts/categories')).data });

function Entries() {
  const qc = useQueryClient();
  const cats = useCategories();
  const [range, setRange] = useState({ from: monthStart(), to: todayStr() });
  const [type, setType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Txn | null>(null);
  const q = useQuery({
    queryKey: ['accounts', 'transactions', range, type, categoryId, search, page],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<{ total: number; pageSize: number; totals: { income: number; expense: number }; items: Txn[] }>('/accounts/transactions', {
        params: { ...range, type: type || undefined, categoryId: categoryId || undefined, search: search || undefined, page },
      })).data,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/accounts/transactions/${id}`),
    onSuccess: () => (toast.success('Entry deleted'), qc.invalidateQueries({ queryKey: ['accounts'] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <DateRange from={range.from} to={range.to} onChange={(from, to) => (setRange({ from, to }), setPage(1))} />
        <Select value={type} onChange={(e) => (setType(e.target.value), setCategoryId(''), setPage(1))} className="w-auto">
          <option value="">Income & expense</option>
          <option value="INCOME">Income</option>
          <option value="EXPENSE">Expense</option>
        </Select>
        <Select value={categoryId} onChange={(e) => (setCategoryId(e.target.value), setPage(1))} className="w-auto">
          <option value="">All categories</option>
          {cats.data?.filter((c) => !type || c.type === type).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <div className="relative flex-1 min-w-40">
          <Search className="size-4 text-faint absolute left-2.5 top-2.5" />
          <Input placeholder="Search party, note, ref." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="pl-8" />
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty icon="🧾" title="No entries">Use the Income / Expense buttons above to add one.</Empty>
      ) : (
        <>
          <div className="flex gap-4 text-sm mb-2">
            <span>
              Income <b className="text-tag-green-ink">{formatINR(q.data!.totals.income)}</b>
            </span>
            <span>
              Expense <b className="text-tag-red-ink">{formatINR(q.data!.totals.expense)}</b>
            </span>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Party / note</th>
                <th>Mode</th>
                <th className="!text-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap text-muted">{fmtDate(t.date, { day: 'numeric', month: 'short' })}</td>
                  <td>
                    <Tag color={t.type === 'INCOME' ? 'green' : 'orange'}>{t.category?.name ?? '—'}</Tag>
                  </td>
                  <td>
                    <div className="text-ink-strong">{t.party ?? '—'}</div>
                    {t.description && <div className="text-xs text-muted">{t.description}</div>}
                  </td>
                  <td className="text-muted whitespace-nowrap">
                    {modeLabel(t.mode)}
                    {t.reference && <div className="text-xs">Ref {t.reference}</div>}
                  </td>
                  <td className={cn('text-right tabular-nums font-medium', t.type === 'INCOME' ? 'text-tag-green-ink' : 'text-tag-red-ink')}>
                    {t.type === 'INCOME' ? '+' : '−'}
                    {formatINR(t.amount)}
                  </td>
                  <td>
                    <div className="flex justify-end gap-0.5">
                      <button className="p-1.5 rounded hover:bg-hover text-muted" onClick={() => setEditing(t)} title="Edit">
                        <Pencil className="size-3.5" />
                      </button>
                      <button className="p-1.5 rounded hover:bg-hover text-muted" onClick={() => confirm('Delete this entry?') && del.mutate(t.id)} title="Delete">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {pages > 1 && (
            <div className="flex justify-end items-center gap-2 mt-3 text-sm">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-muted">
                Page {page} of {pages}
              </span>
              <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
      {editing && <TxnForm type={editing.type} txn={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TxnForm({ type: initialType, txn, onClose }: { type: TxnKind; txn?: Txn; onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useCategories();
  const [v, setV] = useState({
    type: txn?.type ?? initialType,
    date: txn?.date ?? todayStr(),
    categoryId: txn?.categoryId ?? '',
    amount: paiseInput(txn?.amount),
    mode: txn?.mode ?? 'CASH',
    party: txn?.party ?? '',
    description: txn?.description ?? '',
    reference: txn?.reference ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v, val: string) => setV((x) => ({ ...x, [k]: val }));
  const options = (cats.data ?? []).filter((c) => c.type === v.type);
  const save = useMutation({
    mutationFn: (d: object) => (txn ? api.put(`/accounts/transactions/${txn.id}`, d) : api.post('/accounts/transactions', d)),
    onSuccess: () => {
      toast.success(txn ? 'Entry updated' : `${v.type === 'INCOME' ? 'Income' : 'Expense'} added`);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const r = zodErrors(accountTxnSchema, { ...v, amount: rupeesInput(v.amount) });
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={txn ? 'Edit entry' : v.type === 'INCOME' ? 'Add income' : 'Add expense'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="flex gap-1 p-0.5 bg-tag-gray rounded-md w-fit">
          {(['EXPENSE', 'INCOME'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setV((x) => ({ ...x, type: t, categoryId: '' }))}
              className={cn('px-3 h-7 rounded text-sm', v.type === t ? 'bg-white shadow-card font-medium text-ink-strong' : 'text-muted')}
            >
              {t === 'INCOME' ? 'Income' : 'Expense'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹) *" error={errors.amount}>
            <Input inputMode="decimal" value={v.amount} onChange={(e) => set('amount', e.target.value)} autoFocus placeholder="0" />
          </Field>
          <Field label="Date *" error={errors.date}>
            <Input type="date" value={v.date} max={todayStr()} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Category *" error={errors.categoryId}>
            <Select value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Select…</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mode" error={errors.mode}>
            <Select value={v.mode} onChange={(e) => set('mode', e.target.value)}>
              {FINANCE_PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {modeLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={v.type === 'INCOME' ? 'Received from' : 'Paid to'} error={errors.party}>
          <Input value={v.party} onChange={(e) => set('party', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Note" error={errors.description}>
            <Input value={v.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Bill / ref. no." error={errors.reference}>
            <Input value={v.reference} onChange={(e) => set('reference', e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ───────── Monthly summary ─────────

function Summary() {
  const [month, setMonth] = useState(monthStr());
  const q = useQuery({
    queryKey: ['accounts', 'summary', month],
    queryFn: async () =>
      (await api.get<{ income: { category: string; amount: number }[]; expense: { category: string; amount: number }[]; totals: { income: number; expense: number; net: number } }>(
        '/accounts/summary',
        { params: { month } },
      )).data,
  });
  const max = useMemo(() => Math.max(1, ...[...(q.data?.income ?? []), ...(q.data?.expense ?? [])].map((x) => x.amount)), [q.data]);
  return (
    <>
      <div className="mb-4">
        <MonthNav month={month} onChange={setMonth} max={monthStr()} />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <Stat icon="⬇️" label="Income" value={formatINR(q.data!.totals.income)} />
            <Stat icon="⬆️" label="Expense" value={formatINR(q.data!.totals.expense)} />
            <Stat icon="🟰" label="Surplus" value={<span className={q.data!.totals.net < 0 ? 'text-tag-red-ink' : ''}>{formatINR(q.data!.totals.net)}</span>} />
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {(['income', 'expense'] as const).map((k) => (
              <div key={k}>
                <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">{k === 'income' ? 'Income' : 'Expenses'}</div>
                <Card className="p-4 space-y-2">
                  {!q.data![k].length && <div className="text-sm text-muted">Nothing this month.</div>}
                  {q.data![k].map((x) => (
                    <div key={x.category} className="text-sm">
                      <div className="flex justify-between mb-0.5">
                        <span>{x.category}</span>
                        <span className="tabular-nums">{formatINR(x.amount)}</span>
                      </div>
                      <div className="h-2 bg-[#f7f7f5] rounded-sm overflow-hidden">
                        <div
                          className={cn('h-full rounded-sm', k === 'income' ? 'bg-tag-green-ink/70' : 'bg-tag-orange-ink/70')}
                          style={{ width: `${(x.amount / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </Card>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ───────── Categories ─────────

function Categories() {
  const qc = useQueryClient();
  const cats = useCategories();
  const [editing, setEditing] = useState<Category | { type: TxnKind } | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/accounts/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts', 'categories'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (cats.isLoading) return <Loading />;
  if (cats.error) return <ErrorBox error={cats.error} />;
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {(['INCOME', 'EXPENSE'] as const).map((type) => (
        <div key={type}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-semibold text-muted uppercase tracking-wide">{type === 'INCOME' ? 'Income' : 'Expense'}</div>
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ type })}>
              Add
            </Button>
          </div>
          <Card className="divide-y divide-line">
            {cats.data!.filter((c) => c.type === type).map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                <span className="flex-1">{c.name}</span>
                {c.used > 0 && <span className="text-xs text-faint">{c.used} entries</span>}
                <button className="p-1 rounded hover:bg-hover text-muted" onClick={() => setEditing(c)} title="Rename">
                  <Pencil className="size-3.5" />
                </button>
                {c.used === 0 && (
                  <button className="p-1 rounded hover:bg-hover text-muted" onClick={() => del.mutate(c.id)} title="Delete">
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </Card>
        </div>
      ))}
      {editing && <CategoryForm cat={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CategoryForm({ cat, onClose }: { cat: Category | { type: TxnKind }; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = 'id' in cat ? cat : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (d: object) => (existing ? api.put(`/accounts/categories/${existing.id}`, d) : api.post('/accounts/categories', d)),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['accounts', 'categories'] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Rename category' : `New ${cat.type === 'INCOME' ? 'income' : 'expense'} category`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              const r = zodErrors(accountCategorySchema, { name, type: cat.type });
              setError(r.errors.name ?? '');
              if (r.data) save.mutate(r.data);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="pb-2">
        <Field label="Name" error={error}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}
