import { useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Download, Pencil, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { formatINR, inventoryItemSchema, stockAdjustSchema, stockInSchema, stockOutSchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Tag } from '../../components/ui';
import { cn, downloadCsv, fmtDate, paiseInput, rupeesInput, todayStr } from '../../lib/utils';
import { zodErrors } from '../accounts/zod';

interface Item {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  stock: number;
  minStock: number;
  rate: number | null;
  isActive: boolean;
  value: number | null;
  low: boolean;
}
interface Movement {
  id: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  date: string;
  rate: number | null;
  party: string | null;
  remark: string | null;
}
type MoveKind = 'in' | 'out' | 'adjust';

/** Inventory module. Mounted at /inventory/*. */
export function InventoryModule() {
  return (
    <Routes>
      <Route index element={<ItemsPage />} />
      <Route path=":id" element={<ItemPage />} />
    </Routes>
  );
}

function ItemsPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [low, setLow] = useState(false);
  const [inactive, setInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<{ item: Item; kind: MoveKind } | null>(null);
  const q = useQuery({
    queryKey: ['inventory', search, category, low, inactive],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<{ items: Item[]; categories: string[]; stats: { items: number; lowStock: number; totalValue: number } }>('/inventory/items', {
        params: { search: search || undefined, category: category || undefined, low: low ? 1 : undefined, inactive: inactive ? 1 : undefined },
      })).data,
  });
  const exportCsv = () =>
    q.data &&
    downloadCsv(`stock-${todayStr()}.csv`, [
      ['Item', 'Category', 'Unit', 'Stock', 'Min stock', 'Rate', 'Value'],
      ...q.data.items.map((i) => [i.name, i.category, i.unit, i.stock, i.minStock, i.rate != null ? i.rate / 100 : '', i.value != null ? i.value / 100 : '']),
    ]);

  return (
    <>
      <PageHeader
        icon="📦"
        title="Inventory"
        description="Stationery, sports goods and other school stock."
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!q.data?.items.length}>
              CSV
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add item
            </Button>
          </>
        }
      />
      {q.data && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat icon="📦" label="Items" value={q.data.stats.items} />
          <Stat icon="💰" label="Stock value" value={formatINR(q.data.stats.totalValue)} />
          <button onClick={() => setLow(!low)} className="text-left">
            <Stat icon="⚠️" label="Low stock" value={<span className={q.data.stats.lowStock ? 'text-tag-red-ink' : ''}>{q.data.stats.lowStock}</span>} sub={low ? 'Showing low only' : 'Tap to filter'} />
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-44">
          <Search className="size-4 text-faint absolute left-2.5 top-2.5" />
          <Input placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
          <option value="">All categories</option>
          {q.data?.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Show inactive
        </label>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty icon="📦" title={low ? 'Nothing is low on stock' : 'No items yet'}>{low ? undefined : 'Add chalk, registers, sports balls…'}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="!text-right">In stock</th>
              <th className="!text-right">Rate</th>
              <th className="!text-right">Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data!.items.map((i) => (
              <tr key={i.id} className={cn(!i.isActive && 'opacity-50')}>
                <td>
                  <Link to={`/inventory/${i.id}`} className="font-medium text-ink-strong hover:underline">
                    {i.name}
                  </Link>
                  <div className="flex gap-1 mt-0.5">
                    {i.category && <Tag>{i.category}</Tag>}
                    {!i.isActive && <Tag color="red">Inactive</Tag>}
                  </div>
                </td>
                <td className="text-right whitespace-nowrap">
                  <span className={cn('tabular-nums font-medium', i.low && 'text-tag-red-ink')}>{i.stock}</span> <span className="text-muted text-xs">{i.unit}</span>
                  {i.low && <div className="text-[11px] text-tag-red-ink">min {i.minStock}</div>}
                </td>
                <td className="text-right tabular-nums text-muted">{i.rate != null ? formatINR(i.rate) : '—'}</td>
                <td className="text-right tabular-nums">{i.value != null ? formatINR(i.value) : '—'}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" icon={<ArrowDownToLine className="size-3.5" />} onClick={() => setMoving({ item: i, kind: 'in' })}>
                      In
                    </Button>
                    <Button size="sm" icon={<ArrowUpFromLine className="size-3.5" />} onClick={() => setMoving({ item: i, kind: 'out' })} disabled={i.stock === 0}>
                      Issue
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <ItemForm categories={q.data?.categories ?? []} onClose={() => setAdding(false)} />}
      {moving && <MoveForm item={moving.item} kind={moving.kind} onClose={() => setMoving(null)} />}
    </>
  );
}

function ItemPage() {
  const { id } = useParams();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState<MoveKind | null>(null);
  const q = useQuery({
    queryKey: ['inventory', 'item', id],
    queryFn: async () => (await api.get<Item & { movements: Movement[] }>(`/inventory/items/${id}`)).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const i = q.data!;
  return (
    <>
      <Link to="/inventory" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> All items
      </Link>
      <PageHeader
        icon="📦"
        title={i.name}
        description={[i.category, i.isActive ? null : 'Inactive'].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setMoving('adjust')}>
              Adjust
            </Button>
            <Button icon={<ArrowUpFromLine className="size-4" />} onClick={() => setMoving('out')} disabled={i.stock === 0}>
              Issue
            </Button>
            <Button variant="primary" icon={<ArrowDownToLine className="size-4" />} onClick={() => setMoving('in')}>
              Stock in
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="In stock" value={<span className={i.low ? 'text-tag-red-ink' : ''}>{`${i.stock} ${i.unit}`}</span>} sub={`Minimum ${i.minStock}`} />
        <Stat label="Rate" value={i.rate != null ? formatINR(i.rate) : '—'} sub={`per ${i.unit}`} />
        <Stat label="Value" value={i.value != null ? formatINR(i.value) : '—'} />
      </div>
      <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">History</div>
      {!i.movements.length ? (
        <Empty icon="🗂️" title="No stock movements yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th className="!text-right">Qty</th>
              <th>Supplier / issued to</th>
              <th>Remark</th>
            </tr>
          </thead>
          <tbody>
            {i.movements.map((m) => (
              <tr key={m.id}>
                <td className="text-muted whitespace-nowrap">{fmtDate(m.date)}</td>
                <td>
                  <Tag color={m.type === 'IN' ? 'green' : m.type === 'OUT' ? 'orange' : 'gray'}>{m.type === 'IN' ? 'Stock in' : m.type === 'OUT' ? 'Issued' : 'Adjusted'}</Tag>
                </td>
                <td className={cn('text-right tabular-nums font-medium', m.type === 'IN' || m.quantity > 0 ? 'text-tag-green-ink' : 'text-tag-red-ink')}>
                  {m.type === 'OUT' ? `−${m.quantity}` : m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </td>
                <td>
                  {m.party ?? '—'}
                  {m.rate != null && <div className="text-xs text-muted">@ {formatINR(m.rate)}</div>}
                </td>
                <td className="text-muted">{m.remark ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <ItemForm item={i} categories={[]} onClose={() => setEditing(false)} />}
      {moving && <MoveForm item={i} kind={moving} onClose={() => setMoving(null)} />}
    </>
  );
}

function ItemForm({ item, categories, onClose }: { item?: Item; categories: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    name: item?.name ?? '',
    category: item?.category ?? '',
    unit: item?.unit ?? 'pcs',
    minStock: String(item?.minStock ?? 0),
    rate: paiseInput(item?.rate),
    openingStock: '',
    isActive: item?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v, val: string | boolean) => setV((x) => ({ ...x, [k]: val }));
  const save = useMutation({
    mutationFn: (d: object) => (item ? api.put(`/inventory/items/${item.id}`, d) : api.post('/inventory/items', d)),
    onSuccess: () => (toast.success(item ? 'Item saved' : 'Item added'), qc.invalidateQueries({ queryKey: ['inventory'] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const submit = () => {
    const rate = rupeesInput(v.rate);
    const r = zodErrors(inventoryItemSchema, {
      name: v.name,
      category: v.category,
      unit: v.unit,
      minStock: num(v.minStock) ?? 0,
      rate: rate ?? null,
      isActive: v.isActive,
      ...(item ? {} : { openingStock: num(v.openingStock) }),
    });
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={item ? 'Edit item' : 'Add item'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 pb-2">
        <Field label="Item name *" error={errors.name} className="col-span-2">
          <Input value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="e.g. Chalk box (white)" />
        </Field>
        <Field label="Category" error={errors.category}>
          <Input value={v.category} onChange={(e) => set('category', e.target.value)} list="inv-categories" placeholder="Stationery" />
          <datalist id="inv-categories">
            {[...new Set([...categories, 'Stationery', 'Sports', 'Cleaning', 'Lab', 'Furniture', 'Electrical'])].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Unit" error={errors.unit}>
          <Input value={v.unit} onChange={(e) => set('unit', e.target.value)} placeholder="pcs, box, ream…" />
        </Field>
        <Field label="Rate per unit (₹)" error={errors.rate}>
          <Input inputMode="decimal" value={v.rate} onChange={(e) => set('rate', e.target.value)} />
        </Field>
        <Field label="Minimum stock" hint="Warn when stock falls to this" error={errors.minStock}>
          <Input type="number" min={0} value={v.minStock} onChange={(e) => set('minStock', e.target.value)} />
        </Field>
        {!item && (
          <Field label="Opening stock" error={errors.openingStock}>
            <Input type="number" min={0} value={v.openingStock} onChange={(e) => set('openingStock', e.target.value)} placeholder="0" />
          </Field>
        )}
        {item && (
          <label className="flex items-center gap-2 text-sm col-span-2">
            <input type="checkbox" checked={v.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Active (uncheck to hide an item you no longer stock)
          </label>
        )}
      </div>
    </Modal>
  );
}

const MOVE_TITLE: Record<MoveKind, string> = { in: 'Stock in (purchase)', out: 'Issue stock', adjust: 'Adjust stock' };

function MoveForm({ item, kind, onClose }: { item: Item; kind: MoveKind; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ quantity: '', rate: paiseInput(item.rate), party: '', date: todayStr(), remark: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v, val: string) => setV((x) => ({ ...x, [k]: val }));
  const save = useMutation({
    mutationFn: (d: object) => api.post(`/inventory/items/${item.id}/${kind}`, d),
    onSuccess: () => (toast.success('Stock updated'), qc.invalidateQueries({ queryKey: ['inventory'] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const quantity = v.quantity.trim() === '' ? undefined : Number(v.quantity);
    const base = { quantity, date: v.date, remark: v.remark };
    const r =
      kind === 'in'
        ? zodErrors(stockInSchema, { ...base, rate: rupeesInput(v.rate) ?? null, party: v.party })
        : kind === 'out'
          ? zodErrors(stockOutSchema, { ...base, party: v.party })
          : zodErrors(stockAdjustSchema, base);
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${MOVE_TITLE[kind]} · ${item.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 pb-2">
        <div className="col-span-2 text-sm text-muted">
          In stock: <b className="text-ink-strong">{item.stock}</b> {item.unit}
        </div>
        <Field label={kind === 'adjust' ? 'Change (+ or −) *' : `Quantity (${item.unit}) *`} error={errors.quantity}>
          <Input type="number" value={v.quantity} onChange={(e) => set('quantity', e.target.value)} autoFocus placeholder={kind === 'adjust' ? '-2' : '10'} />
        </Field>
        <Field label="Date *" error={errors.date}>
          <Input type="date" value={v.date} max={todayStr()} onChange={(e) => set('date', e.target.value)} />
        </Field>
        {kind === 'in' && (
          <>
            <Field label="Rate per unit (₹)" error={errors.rate}>
              <Input inputMode="decimal" value={v.rate} onChange={(e) => set('rate', e.target.value)} />
            </Field>
            <Field label="Supplier" error={errors.party}>
              <Input value={v.party} onChange={(e) => set('party', e.target.value)} />
            </Field>
          </>
        )}
        {kind === 'out' && (
          <Field label="Issued to *" error={errors.party} className="col-span-2">
            <Input value={v.party} onChange={(e) => set('party', e.target.value)} placeholder="Teacher / class / department" />
          </Field>
        )}
        <Field label={kind === 'adjust' ? 'Reason *' : 'Remark'} error={errors.remark} className="col-span-2">
          <Input value={v.remark} onChange={(e) => set('remark', e.target.value)} placeholder={kind === 'adjust' ? 'e.g. physical count, damaged' : ''} />
        </Field>
      </div>
    </Modal>
  );
}
