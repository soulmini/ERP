import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, X } from 'lucide-react';
import {
  FEE_FREQUENCIES,
  FEE_FREQUENCY_LABEL,
  type ConcessionRow,
  type FeeFrequency,
  type FeeHeadRow,
  type FeeStructureView,
} from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Tag } from '../../components/ui';
import { cn } from '../../lib/utils';
import { FeesTabs, inr, parseRupees, rupeesStr } from './common';
import { ConcessionModal } from './Collect';

type SetupTab = 'structure' | 'heads' | 'concessions' | 'generate';

export function SetupPage() {
  const [tab, setTab] = useState<SetupTab>('structure');
  const q = useQuery({
    queryKey: ['fees', 'structure'],
    queryFn: async () => (await api.get<FeeStructureView>('/fees/structure')).data,
  });
  return (
    <>
      <PageHeader icon="💰" title="Fees" description={q.data ? `Fee setup · session ${q.data.session.name}` : 'Fee setup'} />
      <FeesTabs />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'structure', label: '🧮 Fee structure' },
          { value: 'heads', label: '🏷️ Fee heads' },
          { value: 'concessions', label: '🎁 Concessions' },
          { value: 'generate', label: '⚙️ Generate dues' },
        ]}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          {tab === 'structure' && <StructureTab data={q.data!} onGoHeads={() => setTab('heads')} onGenerate={() => setTab('generate')} />}
          {tab === 'heads' && <HeadsTab heads={q.data!.heads} />}
          {tab === 'concessions' && <ConcessionsTab />}
          {tab === 'generate' && <GenerateTab data={q.data!} />}
        </>
      )}
    </>
  );
}

// ═════════════════════ Structure grid ═════════════════════

function StructureTab({ data, onGoHeads, onGenerate }: { data: FeeStructureView; onGoHeads: () => void; onGenerate: () => void }) {
  const qc = useQueryClient();
  const heads = data.heads.filter((h) => h.isActive);
  const key = (c: string, h: string) => `${c}|${h}`;
  const initial = useMemo(() => {
    const cells: Record<string, string> = {};
    for (const i of data.items) cells[key(i.classId, i.feeHeadId)] = rupeesStr(i.amount);
    const cfg: Record<string, { dueDay: string; lateFine: string }> = {};
    for (const h of data.heads) {
      const first = data.items.find((i) => i.feeHeadId === h.id);
      cfg[h.id] = { dueDay: String(first?.dueDay ?? 10), lateFine: first ? rupeesStr(first.lateFine) : '0' };
    }
    return { cells, cfg };
  }, [data]);
  const [cells, setCells] = useState(initial.cells);
  const [cfg, setCfg] = useState(initial.cfg);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setCells(initial.cells);
    setCfg(initial.cfg);
  }, [initial]);
  const dirty = JSON.stringify(cells) !== JSON.stringify(initial.cells) || JSON.stringify(cfg) !== JSON.stringify(initial.cfg);

  const bad = Object.values(cells).some((v) => v.trim() !== '' && parseRupees(v) == null);
  const save = useMutation({
    mutationFn: async () => {
      const items = data.classes.flatMap((c) =>
        heads.map((h) => ({
          classId: c.id,
          feeHeadId: h.id,
          amount: parseRupees(cells[key(c.id, h.id)] ?? '') ?? 0,
          dueDay: Math.min(31, Math.max(1, Number(cfg[h.id]?.dueDay) || 10)),
          lateFine: parseRupees(cfg[h.id]?.lateFine ?? '') ?? 0,
        })),
      );
      return (await api.put<{ created: number; updated: number; removed: number }>('/fees/structure', { items })).data;
    },
    onSuccess: () => {
      toast.success('Fee structure saved');
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['fees'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!heads.length) {
    return (
      <Empty icon="🏷️" title="No fee heads yet">
        Create fee heads (Tuition, Admission, Exam …) first.
        <div className="mt-3">
          <Button variant="primary" onClick={onGoHeads}>
            Add fee heads
          </Button>
        </div>
      </Empty>
    );
  }

  return (
    <>
      <p className="text-sm text-muted mb-3">
        Amount in ₹ per installment for each class. Leave blank for heads a class doesn't pay. Due day and late fine apply to the whole column.
      </p>
      {saved && !dirty && (
        <div className="rounded-md bg-tag-blue text-tag-blue-ink px-3 py-2 text-sm mb-3 flex flex-wrap items-center gap-2">
          Saved. Students' dues change only when you generate them.
          <Button size="sm" variant="primary" className="ml-auto" onClick={onGenerate}>
            Go to Generate dues
          </Button>
        </div>
      )}
      <div className="overflow-x-auto -mx-4 md:mx-0 border-y md:border border-line md:rounded-lg">
        <table className="text-sm border-collapse min-w-full">
          <thead>
            <tr className="bg-sidebar">
              <th className="sticky left-0 bg-sidebar text-left font-normal text-muted text-[13px] px-3 py-2 border-b border-line min-w-24">Class</th>
              {heads.map((h) => (
                <th key={h.id} className="text-left font-normal px-2 py-2 border-b border-l border-line min-w-36">
                  <div className="font-medium text-ink-strong">{h.name}</div>
                  <Tag color={h.frequency === 'MONTHLY' ? 'blue' : h.frequency === 'ONE_TIME' ? 'purple' : 'yellow'}>
                    {FEE_FREQUENCY_LABEL[h.frequency]}
                  </Tag>
                </th>
              ))}
            </tr>
            <tr>
              <td className="sticky left-0 bg-white px-3 py-1.5 border-b border-line text-[12px] text-muted">Due day · Late fine ₹</td>
              {heads.map((h) => (
                <td key={h.id} className="px-2 py-1.5 border-b border-l border-line">
                  <div className="flex gap-1">
                    <Input
                      aria-label={`${h.name} due day`}
                      inputMode="numeric"
                      className="h-7 w-12 px-1.5 text-[13px]"
                      value={cfg[h.id]?.dueDay ?? ''}
                      onChange={(e) => setCfg({ ...cfg, [h.id]: { ...cfg[h.id], dueDay: e.target.value.replace(/\D/g, '').slice(0, 2) } })}
                    />
                    <Input
                      aria-label={`${h.name} late fine`}
                      inputMode="decimal"
                      className="h-7 w-16 px-1.5 text-[13px]"
                      value={cfg[h.id]?.lateFine ?? ''}
                      onChange={(e) => setCfg({ ...cfg, [h.id]: { ...cfg[h.id], lateFine: e.target.value } })}
                    />
                  </div>
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.classes.map((c) => (
              <tr key={c.id} className="hover:bg-[#fafaf9]">
                <td className="sticky left-0 bg-white px-3 py-1.5 border-b border-line">
                  <div className="font-medium text-ink-strong">{c.name}</div>
                  <div className="text-[11px] text-muted">{c.students} students</div>
                </td>
                {heads.map((h) => {
                  const k = key(c.id, h.id);
                  const v = cells[k] ?? '';
                  const invalid = v.trim() !== '' && parseRupees(v) == null;
                  return (
                    <td key={h.id} className="px-2 py-1.5 border-b border-l border-line">
                      <div className="relative">
                        <span className="absolute left-2 top-1.5 text-faint text-[13px]">₹</span>
                        <Input
                          inputMode="decimal"
                          className={cn('h-8 pl-5 tabular-nums', invalid && 'border-tag-red-ink')}
                          value={v}
                          placeholder="—"
                          onChange={(e) => setCells({ ...cells, [k]: e.target.value })}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        {dirty && (
          <Button
            onClick={() => {
              setCells(initial.cells);
              setCfg(initial.cfg);
            }}
          >
            Discard
          </Button>
        )}
        <Button variant="primary" disabled={!dirty || bad} loading={save.isPending} onClick={() => save.mutate()}>
          Save structure
        </Button>
      </div>
    </>
  );
}

// ═════════════════════ Heads ═════════════════════

function HeadsTab({ heads }: { heads: FeeHeadRow[] }) {
  const [editing, setEditing] = useState<FeeHeadRow | 'new' | null>(null);
  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-muted">What the school charges for, and how often.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          Add head
        </Button>
      </div>
      {heads.length ? (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Frequency</th>
              <th>Order</th>
              <th>Status</th>
              <th className="!text-right">Dues</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {heads.map((h) => (
              <tr key={h.id}>
                <td className="font-medium text-ink-strong">{h.name}</td>
                <td>{FEE_FREQUENCY_LABEL[h.frequency]}</td>
                <td className="text-muted">{h.order}</td>
                <td>{h.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>}</td>
                <td className="text-right tabular-nums text-muted">{h.dues}</td>
                <td className="text-right">
                  <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(h)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty icon="🏷️" title="No fee heads">
          Add Tuition (monthly), Admission (one-time), Exam (half-yearly) …
        </Empty>
      )}
      {editing && <HeadModal head={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function HeadModal({ head, onClose }: { head: FeeHeadRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(head?.name ?? '');
  const [frequency, setFrequency] = useState<FeeFrequency>(head?.frequency ?? 'MONTHLY');
  const [order, setOrder] = useState(String(head?.order ?? 0));
  const [isActive, setActive] = useState(head?.isActive ?? true);
  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['fees'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: async () => {
      const body = { name, frequency, order: Number(order) || 0, isActive };
      return head ? api.put(`/fees/heads/${head.id}`, body) : api.post('/fees/heads', body);
    },
    onSuccess: () => done(head ? 'Fee head updated' : 'Fee head added'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: async () => api.delete(`/fees/heads/${head!.id}`),
    onSuccess: () => done('Fee head deleted'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={head ? 'Edit fee head' : 'Add fee head'}
      footer={
        <>
          {head && head.dues === 0 && (
            <Button variant="danger" className="mr-auto" loading={del.isPending} onClick={() => confirm(`Delete "${head.name}"?`) && del.mutate()}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Tuition Fee" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Frequency" hint={head && head.dues > 0 ? 'Locked: dues exist' : undefined}>
            <Select value={frequency} disabled={!!head && head.dues > 0} onChange={(e) => setFrequency(e.target.value as FeeFrequency)}>
              {FEE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FEE_FREQUENCY_LABEL[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order on receipt">
            <Input inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-black" checked={isActive} onChange={(e) => setActive(e.target.checked)} />
          Active (inactive heads are not charged to new dues)
        </label>
        <p className="text-xs text-muted">
          Monthly: every month · Quarterly: Apr/Jul/Oct/Jan · Half-yearly: Apr/Oct · Yearly: once in April · One-time: once per student (only for
          students admitted this session).
        </p>
      </div>
    </Modal>
  );
}

// ═════════════════════ Concessions ═════════════════════

function ConcessionsTab() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['fees', 'concessions'],
    queryFn: async () => (await api.get<ConcessionRow[]>('/fees/concessions')).data,
  });
  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/fees/concessions/${id}`),
    onSuccess: () => {
      toast.success('Concession removed; unpaid dues updated');
      qc.invalidateQueries({ queryKey: ['fees'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-muted">Standing discounts per student — sibling, staff ward, scholarship.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
          Add concession
        </Button>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.length ? (
        <Empty icon="🎁" title="No concessions" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Fee head</th>
              <th>Concession</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data!.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/fees/student/${c.studentId}`} className="text-ink-strong font-medium hover:underline">
                    {c.studentName}
                  </Link>
                  <div className="text-xs text-muted">
                    {c.classLabel ?? '—'} · {c.admissionNo}
                  </div>
                </td>
                <td>{c.head ?? 'All heads'}</td>
                <td>
                  <Tag color="green">{c.percent != null ? `${c.percent}%` : `${inr(c.amount ?? 0)} / period`}</Tag>
                </td>
                <td className="text-muted">{c.reason}</td>
                <td className="text-right">
                  <button
                    className="p-1 rounded hover:bg-hover text-muted"
                    title="Remove"
                    onClick={() => confirm(`Remove concession for ${c.studentName}?`) && del.mutate(c.id)}
                  >
                    <X className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <ConcessionModal onClose={() => setAdding(false)} />}
    </>
  );
}

// ═════════════════════ Generate dues ═════════════════════

function GenerateTab({ data }: { data: FeeStructureView }) {
  const qc = useQueryClient();
  const [classId, setClassId] = useState('');
  const [result, setResult] = useState<{ students: number; created: number; updated: number; removed: number } | null>(null);
  const gen = useMutation({
    mutationFn: async () =>
      (await api.post<{ students: number; created: number; updated: number; removed: number }>('/fees/generate', { classId: classId || undefined })).data,
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Dues ready: ${r.created} created, ${r.updated} updated`);
      qc.invalidateQueries({ queryKey: ['fees'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const withStructure = new Set(data.items.map((i) => i.classId));
  return (
    <div className="grid gap-5 md:grid-cols-[1fr_1fr] items-start">
      <Card className="p-5 space-y-3">
        <h2 className="font-semibold text-ink-strong">Generate dues for {data.session.name}</h2>
        <p className="text-sm text-muted">
          Creates each student's installments from the fee structure, with concessions applied. Safe to run again: existing dues are kept,
          unpaid ones are updated if the structure or concessions changed, and paid ones are never touched.
        </p>
        <Field label="Classes">
          <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {data.classes.map((c) => (
              <option key={c.id} value={c.id}>
                Class {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" size="lg" className="w-full" loading={gen.isPending} onClick={() => gen.mutate()}>
          Generate dues
        </Button>
        {result && (
          <div className="rounded-md bg-tag-green text-tag-green-ink px-3 py-2 text-sm">
            {result.students} students · {result.created} new dues · {result.updated} updated · {result.removed} removed
          </div>
        )}
      </Card>
      <Card className="divide-y divide-line">
        {data.classes.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="font-medium text-ink-strong">Class {c.name}</span>
            <span className="text-muted">
              {!withStructure.has(c.id) ? (
                <Tag>No structure</Tag>
              ) : c.students === 0 ? (
                'No students'
              ) : c.studentsWithDues === c.students ? (
                <Tag color="green">{c.students} / {c.students} have dues</Tag>
              ) : (
                <Tag color="orange">
                  {c.studentsWithDues} / {c.students} have dues
                </Tag>
              )}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
