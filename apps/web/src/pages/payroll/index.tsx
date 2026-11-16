import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Banknote, Download, Landmark, Lock, Pencil, Printer, RefreshCw, Trash2, Unlock } from 'lucide-react';
import {
  FINANCE_MODE_LABELS,
  FINANCE_PAYMENT_MODES,
  SALARY_DEDUCTION_FIELDS,
  SALARY_EARNING_FIELDS,
  amountInWords,
  formatINR,
  payslipAdjustSchema,
  payslipPaySchema,
  salaryStructureSchema,
  salaryTotals,
  staffBankSchema,
  type PayslipBreakdown,
  type PayslipStaff,
} from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Tabs, Tag } from '../../components/ui';
import { Letterhead, PrintSheet, PrintToolbar, Signatures } from '../../components/print';
import { cn, downloadCsv, fmtDate, monthStr, paiseInput, rupeesInput, shiftMonth, todayStr } from '../../lib/utils';
import { zodErrors } from '../accounts/zod';

interface Slip {
  id: string;
  staffId: string;
  staff: PayslipStaff;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  absentDays: number;
  paidDays: number;
  unpaidDays: number;
  gross: number;
  deductions: number;
  lopDeduction: number;
  net: number;
  paidAt: string | null;
  paymentMode: string | null;
  reference: string | null;
  breakdown: PayslipBreakdown;
}
interface MonthData {
  month: string;
  label: string;
  isFuture: boolean;
  calendar: { daysInMonth: number; sundays: number; workingDays: number; holidayDays?: number };
  payroll: { id: string; status: 'DRAFT' | 'FINALIZED'; finalizedAt: string | null } | null;
  treatUnmarkedAs: 'PRESENT' | 'ABSENT' | null;
  eligible: number;
  notes: { staffId: string; name: string; kind: string; message: string }[];
  payslips: Slip[];
  totals: { gross: number; deductions: number; lop: number; net: number; paid: number; paidAmount: number; count: number };
}
interface StaffRow {
  id: string;
  name: string;
  employeeCode: string;
  designation: string;
  joiningDate: string | null;
  bank: { bankName: string | null; bankAccount: string | null; ifsc: string | null; pan: string | null };
  structure: (Record<string, number> & { effectiveFrom: string; gross: number; deductions: number; net: number }) | null;
}

const modeLabel = (m: string | null) => (m ? FINANCE_MODE_LABELS[m as keyof typeof FINANCE_MODE_LABELS] ?? m : '');
const mask = (acc: string | null) => (acc ? `XXXX${acc.slice(-4)}` : '—');
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtMonthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

/** Salary module. Mounted at /payroll/*. */
export function PayrollModule() {
  return (
    <Routes>
      <Route index element={<PayrollHome />} />
      <Route path="payslip/:id" element={<PayslipPrintPage />} />
      <Route path=":month/print" element={<BulkPrintPage />} />
      <Route path=":month" element={<MonthPage />} />
    </Routes>
  );
}

// ───────── Home: months + structures ─────────

function PayrollHome() {
  const [tab, setTab] = useState<'payroll' | 'structures'>('payroll');
  return (
    <>
      <PageHeader icon="💼" title="Salary" description="Set each staff member's salary once; generate payroll every month from staff attendance." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'payroll', label: 'Monthly payroll' },
          { value: 'structures', label: 'Salary structures' },
        ]}
      />
      {tab === 'payroll' ? <Months /> : <Structures />}
    </>
  );
}

function Months() {
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['payroll', 'list'],
    queryFn: async () =>
      (await api.get<{ month: string; label: string; status: string; staff: number; net: number; paid: number; paidAmount: number }[]>('/payroll/payrolls')).data,
  });
  const current = monthStr();
  const recent = [current, shiftMonth(current, -1), shiftMonth(current, -2)];
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        {recent.map((m) => (
          <Button key={m} variant={m === shiftMonth(current, -1) ? 'primary' : 'secondary'} onClick={() => nav(`/payroll/${m}`)}>
            {fmtMonthLabel(m)}
          </Button>
        ))}
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.length ? (
        <Empty icon="💼" title="No payroll yet">Open a month above and press “Generate payroll”.</Empty>
      ) : (
        <Card className="divide-y divide-line">
          {q.data!.map((p) => (
            <Link key={p.month} to={`/payroll/${p.month}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#fafaf9]">
              <div className="flex-1">
                <div className="font-medium text-ink-strong">{p.label}</div>
                <div className="text-xs text-muted">
                  {p.staff} staff · {p.paid}/{p.staff} paid
                </div>
              </div>
              <Tag color={p.status === 'FINALIZED' ? 'green' : 'yellow'}>{p.status === 'FINALIZED' ? 'Finalized' : 'Draft'}</Tag>
              <div className="w-28 text-right tabular-nums font-medium">{formatINR(p.net)}</div>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}

function Structures() {
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [bankFor, setBankFor] = useState<StaffRow | null>(null);
  const q = useQuery({
    queryKey: ['payroll', 'staff'],
    queryFn: async () =>
      (await api.get<{ staff: StaffRow[]; summary: { staff: number; withStructure: number; gross: number; net: number; missingBank: number } }>('/payroll/staff')).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { staff, summary } = q.data!;
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Stat icon="👥" label="Salary set" value={`${summary.withStructure}/${summary.staff}`} sub="staff with a structure" />
        <Stat icon="💰" label="Monthly gross" value={formatINR(summary.gross)} />
        <Stat icon="🏦" label="Monthly net" value={formatINR(summary.net)} sub={summary.missingBank ? `${summary.missingBank} without bank details` : 'All bank details added'} />
      </div>
      <Table>
        <thead>
          <tr>
            <th>Staff</th>
            <th className="!text-right">Gross</th>
            <th className="!text-right">Deductions</th>
            <th className="!text-right">Net / month</th>
            <th>Bank</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id}>
              <td>
                <div className="font-medium text-ink-strong">{s.name}</div>
                <div className="text-xs text-muted">
                  {s.designation} · {s.employeeCode}
                </div>
              </td>
              {s.structure ? (
                <>
                  <td className="text-right tabular-nums">{formatINR(s.structure.gross)}</td>
                  <td className="text-right tabular-nums text-muted">{formatINR(s.structure.deductions)}</td>
                  <td className="text-right tabular-nums font-medium">{formatINR(s.structure.net)}</td>
                </>
              ) : (
                <td colSpan={3} className="text-right">
                  <Tag color="orange">Not set</Tag>
                </td>
              )}
              <td className="text-xs">
                {s.bank.bankAccount ? (
                  <>
                    <div>{s.bank.bankName ?? 'Bank'}</div>
                    <div className="text-muted">{mask(s.bank.bankAccount)}</div>
                  </>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
              <td>
                <div className="flex justify-end gap-1">
                  <Button size="sm" icon={<Landmark className="size-3.5" />} onClick={() => setBankFor(s)}>
                    Bank
                  </Button>
                  <Button size="sm" variant={s.structure ? 'secondary' : 'primary'} icon={<Pencil className="size-3.5" />} onClick={() => setEditing(s)}>
                    {s.structure ? 'Edit' : 'Set salary'}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && <StructureForm staff={editing} onClose={() => setEditing(null)} />}
      {bankFor && <BankForm staff={bankFor} onClose={() => setBankFor(null)} />}
    </>
  );
}

function StructureForm({ staff, onClose }: { staff: StaffRow; onClose: () => void }) {
  const qc = useQueryClient();
  const fields = [...SALARY_EARNING_FIELDS, ...SALARY_DEDUCTION_FIELDS];
  const [v, setV] = useState<Record<string, string>>({
    ...Object.fromEntries(fields.map((f) => [f.key, paiseInput(staff.structure?.[f.key])])),
    effectiveFrom: staff.structure?.effectiveFrom ?? `${monthStr()}-01`,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const amounts = Object.fromEntries(fields.map((f) => [f.key, rupeesInput(v[f.key] ?? '') ?? 0]));
  const t = salaryTotals(amounts);
  const save = useMutation({
    mutationFn: (d: object) => api.put(`/payroll/staff/${staff.id}/structure`, d),
    onSuccess: () => (toast.success('Salary saved'), qc.invalidateQueries({ queryKey: ['payroll'] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const r = zodErrors(salaryStructureSchema, { ...amounts, effectiveFrom: v.effectiveFrom });
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  const row = (f: { key: string; label: string }) => (
    <Field key={f.key} label={`${f.label} (₹)`} error={errors[f.key]}>
      <Input inputMode="decimal" value={v[f.key]} onChange={(e) => setV((x) => ({ ...x, [f.key]: e.target.value }))} placeholder="0" />
    </Field>
  );
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Salary · ${staff.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 pb-2">
        <div className="space-y-3">
          <div className="text-[13px] font-semibold text-muted uppercase tracking-wide">Earnings / month</div>
          {SALARY_EARNING_FIELDS.map(row)}
        </div>
        <div className="space-y-3">
          <div className="text-[13px] font-semibold text-muted uppercase tracking-wide">Deductions / month</div>
          {SALARY_DEDUCTION_FIELDS.map(row)}
          <Field label="Effective from" error={errors.effectiveFrom}>
            <Input type="date" value={v.effectiveFrom} onChange={(e) => setV((x) => ({ ...x, effectiveFrom: e.target.value }))} />
          </Field>
        </div>
        <Card className="sm:col-span-2 p-3 bg-sidebar flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            Gross <b className="tabular-nums">{formatINR(t.gross)}</b>
          </span>
          <span>
            Deductions <b className="tabular-nums">{formatINR(t.deductions)}</b>
          </span>
          <span>
            Net <b className="tabular-nums text-tag-green-ink">{formatINR(t.net)}</b>
          </span>
          {errors.totalDeductions && <span className="text-tag-red-ink">{errors.totalDeductions}</span>}
        </Card>
      </div>
    </Modal>
  );
}

function BankForm({ staff, onClose }: { staff: StaffRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    bankName: staff.bank.bankName ?? '',
    bankAccount: staff.bank.bankAccount ?? '',
    ifsc: staff.bank.ifsc ?? '',
    pan: staff.bank.pan ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (d: object) => api.put(`/payroll/staff/${staff.id}/bank`, d),
    onSuccess: () => (toast.success('Bank details saved'), qc.invalidateQueries({ queryKey: ['payroll'] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const r = zodErrors(staffBankSchema, v);
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  const input = (k: keyof typeof v, label: string, placeholder = '') => (
    <Field label={label} error={errors[k]}>
      <Input value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} placeholder={placeholder} />
    </Field>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={`Bank details · ${staff.name}`}
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
        {input('bankName', 'Bank name', 'State Bank of India')}
        {input('bankAccount', 'Account number')}
        {input('ifsc', 'IFSC', 'SBIN0001234')}
        {input('pan', 'PAN', 'ABCDE1234F')}
      </div>
    </Modal>
  );
}

// ───────── One month ─────────

function MonthPage() {
  const { month = monthStr() } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [rule, setRule] = useState<'PRESENT' | 'ABSENT'>('PRESENT');
  const [adjusting, setAdjusting] = useState<Slip | null>(null);
  const [paying, setPaying] = useState<Slip | 'all' | null>(null);
  const q = useQuery({ queryKey: ['payroll', 'month', month], queryFn: async () => (await api.get<MonthData>(`/payroll/months/${month}`)).data });
  const act = useMutation({
    mutationFn: async ({ path, body, method = 'post' }: { path: string; body?: object; method?: 'post' | 'delete' }) =>
      method === 'delete' ? api.delete(path) : api.post(path, body ?? {}),
    onSuccess: (_d, v) => {
      toast.success(
        v.path.endsWith('generate') ? 'Payroll generated' : v.path.endsWith('finalize') ? 'Payroll finalized' : v.path.endsWith('reopen') ? 'Payroll reopened' : 'Done',
      );
      qc.invalidateQueries({ queryKey: ['payroll'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 7000 }),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const status = d.payroll?.status;
  const exportCsv = () =>
    downloadCsv(`salary-register-${month}.csv`, [
      ['Emp. code', 'Name', 'Designation', 'Working days', 'Paid days', 'Gross', 'Deductions', 'Loss of pay', 'Net', 'Paid on', 'Mode', 'Bank account', 'IFSC'],
      ...d.payslips.map((p) => [
        p.staff.employeeCode,
        p.staff.name,
        p.staff.designation,
        p.workingDays,
        p.paidDays,
        p.gross / 100,
        p.deductions / 100,
        p.lopDeduction / 100,
        p.net / 100,
        p.paidAt ?? '',
        modeLabel(p.paymentMode),
        p.staff.bankAccount ?? '',
        p.staff.ifsc ?? '',
      ]),
    ]);

  return (
    <>
      <Link to="/payroll" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Salary
      </Link>
      <PageHeader
        icon="💼"
        title={`Payroll · ${d.label}`}
        description={`${d.calendar.workingDays} working days (${d.calendar.daysInMonth} days − ${d.calendar.sundays} Sundays${d.calendar.holidayDays ? ` − ${d.calendar.holidayDays} holidays` : ''})`}
        actions={
          <div className="flex items-center gap-1 rounded-md border border-line bg-white">
            <button className="px-2 h-8 hover:bg-hover rounded-l-md text-sm" onClick={() => nav(`/payroll/${shiftMonth(month, -1)}`)}>
              ←
            </button>
            <span className="text-sm px-1">{fmtMonthLabel(month)}</span>
            <button className="px-2 h-8 hover:bg-hover rounded-r-md text-sm disabled:opacity-30" disabled={d.isFuture || month >= monthStr()} onClick={() => nav(`/payroll/${shiftMonth(month, 1)}`)}>
              →
            </button>
          </div>
        }
      />

      {/* Status & actions */}
      <Card className="p-4 mb-4 flex flex-wrap items-center gap-3">
        {status ? (
          <Tag color={status === 'FINALIZED' ? 'green' : 'yellow'}>
            {status === 'FINALIZED' ? (
              <>
                <Lock className="size-3" /> Finalized
              </>
            ) : (
              'Draft — review, then finalize'
            )}
          </Tag>
        ) : (
          <span className="text-sm text-muted">{d.isFuture ? 'This month has not started yet.' : `Not generated yet · ${d.eligible} staff ready`}</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {status !== 'FINALIZED' && !d.isFuture && (
            <>
              <Select value={rule} onChange={(e) => setRule(e.target.value as 'PRESENT' | 'ABSENT')} className="w-auto !h-8 text-[13px]" title="Days with no attendance record">
                <option value="PRESENT">Unmarked days = present</option>
                <option value="ABSENT">Unmarked days = absent</option>
              </Select>
              <Button
                variant={status ? 'secondary' : 'primary'}
                icon={<RefreshCw className="size-4" />}
                loading={act.isPending && act.variables?.path.endsWith('generate')}
                onClick={() => act.mutate({ path: `/payroll/months/${month}/generate`, body: { treatUnmarkedAs: rule } })}
              >
                {status ? 'Regenerate' : 'Generate payroll'}
              </Button>
            </>
          )}
          {status === 'DRAFT' && (
            <>
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => confirm('Discard this draft payroll?') && act.mutate({ path: `/payroll/months/${month}`, method: 'delete' })}>
                Discard
              </Button>
              <Button
                variant="primary"
                icon={<Lock className="size-4" />}
                onClick={() => confirm('Finalize? Payslips will be locked.') && act.mutate({ path: `/payroll/months/${month}/finalize` })}
              >
                Finalize
              </Button>
            </>
          )}
          {status === 'FINALIZED' && (
            <>
              {d.totals.paid === 0 && (
                <Button icon={<Unlock className="size-4" />} onClick={() => act.mutate({ path: `/payroll/months/${month}/reopen` })}>
                  Reopen
                </Button>
              )}
              {d.totals.paid < d.totals.count && (
                <Button variant="primary" icon={<Banknote className="size-4" />} onClick={() => setPaying('all')}>
                  Mark all paid
                </Button>
              )}
            </>
          )}
          {!!d.payslips.length && (
            <>
              <Button icon={<Download className="size-4" />} onClick={exportCsv}>
                Register
              </Button>
              <Button icon={<Printer className="size-4" />} onClick={() => nav(`/payroll/${month}/print`)}>
                Print all
              </Button>
            </>
          )}
        </div>
      </Card>

      {d.notes.length > 0 && (
        <div className="rounded-md bg-tag-yellow text-tag-yellow-ink px-3 py-2 text-sm mb-4 space-y-0.5">
          {d.notes.map((n) => (
            <div key={n.staffId}>
              <b>{n.name}:</b> {n.message}
              {n.kind === 'missing' && ' — set it under Salary structures.'}
            </div>
          ))}
        </div>
      )}

      {!!d.payslips.length && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label="Gross" value={formatINR(d.totals.gross)} />
            <Stat label="Deductions" value={formatINR(d.totals.deductions)} />
            <Stat label="Loss of pay" value={formatINR(d.totals.lop)} />
            <Stat label="Net payable" value={formatINR(d.totals.net)} sub={`${d.totals.paid}/${d.totals.count} paid`} />
          </div>
          <Table>
            <thead>
              <tr>
                <th>Staff</th>
                <th className="!text-right">Paid days</th>
                <th className="!text-right">Gross</th>
                <th className="!text-right">Deductions</th>
                <th className="!text-right">LOP</th>
                <th className="!text-right">Net</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.payslips.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="font-medium text-ink-strong">{p.staff.name}</div>
                    <div className="text-xs text-muted">
                      {p.staff.designation}
                      {p.breakdown.adjustment.note && <span className="text-tag-purple-ink"> · {p.breakdown.adjustment.note}</span>}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">
                    {days(p.paidDays)}/{p.workingDays}
                    {p.leaveDays > 0 && <div className="text-[11px] text-muted">{days(p.leaveDays)} leave</div>}
                  </td>
                  <td className="text-right tabular-nums">{formatINR(p.gross)}</td>
                  <td className="text-right tabular-nums text-muted">{formatINR(p.deductions)}</td>
                  <td className={cn('text-right tabular-nums', p.lopDeduction ? 'text-tag-red-ink' : 'text-faint')}>{p.lopDeduction ? formatINR(p.lopDeduction) : '—'}</td>
                  <td className="text-right tabular-nums font-semibold">{formatINR(p.net)}</td>
                  <td>
                    {p.paidAt ? (
                      <Tag color="green">Paid {fmtDate(p.paidAt, { day: 'numeric', month: 'short' })}</Tag>
                    ) : (
                      <Tag color={status === 'FINALIZED' ? 'orange' : 'gray'}>Unpaid</Tag>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {status === 'DRAFT' && (
                        <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setAdjusting(p)}>
                          Adjust
                        </Button>
                      )}
                      {status === 'FINALIZED' && !p.paidAt && (
                        <Button size="sm" onClick={() => setPaying(p)}>
                          Pay
                        </Button>
                      )}
                      {p.paidAt && (
                        <Button size="sm" variant="ghost" onClick={() => confirm('Undo this payment?') && act.mutate({ path: `/payroll/payslips/${p.id}/unpay` })}>
                          Undo
                        </Button>
                      )}
                      <Link to={`/payroll/payslip/${p.id}`}>
                        <Button size="sm" icon={<Printer className="size-3.5" />}>
                          Slip
                        </Button>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {d.treatUnmarkedAs && (
            <p className="text-xs text-muted mt-2">
              Generated with days without attendance counted as {d.treatUnmarkedAs === 'PRESENT' ? 'present' : 'absent'}. Up to 1.5 leave days a month are paid.
            </p>
          )}
        </>
      )}
      {adjusting && <AdjustForm slip={adjusting} onClose={() => setAdjusting(null)} />}
      {paying && <PayForm month={month} slip={paying === 'all' ? null : paying} onClose={() => setPaying(null)} />}
    </>
  );
}

function AdjustForm({ slip, onClose }: { slip: Slip; onClose: () => void }) {
  const qc = useQueryClient();
  const a = slip.breakdown.adjustment;
  const [v, setV] = useState({ extraAllowance: paiseInput(a.extraAllowance || null), extraDeduction: paiseInput(a.extraDeduction || null), note: a.note ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (d: object) => api.put(`/payroll/payslips/${slip.id}`, d),
    onSuccess: () => (toast.success('Payslip updated'), qc.invalidateQueries({ queryKey: ['payroll'] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const r = zodErrors(payslipAdjustSchema, {
      extraAllowance: rupeesInput(v.extraAllowance) ?? 0,
      extraDeduction: rupeesInput(v.extraDeduction) ?? 0,
      note: v.note,
    });
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust · ${slip.staff.name}`}
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
        <Field label="Extra allowance (₹)" hint="Bonus, arrears…" error={errors.extraAllowance}>
          <Input inputMode="decimal" value={v.extraAllowance} onChange={(e) => setV({ ...v, extraAllowance: e.target.value })} placeholder="0" />
        </Field>
        <Field label="Extra deduction (₹)" hint="Advance recovery…" error={errors.extraDeduction}>
          <Input inputMode="decimal" value={v.extraDeduction} onChange={(e) => setV({ ...v, extraDeduction: e.target.value })} placeholder="0" />
        </Field>
        <Field label="Note" error={errors.note} className="col-span-2">
          <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="e.g. Diwali bonus" />
        </Field>
      </div>
    </Modal>
  );
}

function PayForm({ month, slip, onClose }: { month: string; slip: Slip | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ paidAt: todayStr(), mode: 'BANK_TRANSFER', reference: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (d: object) => api.post(slip ? `/payroll/payslips/${slip.id}/pay` : `/payroll/months/${month}/pay-all`, d),
    onSuccess: () => {
      toast.success('Payment recorded');
      qc.invalidateQueries({ queryKey: ['payroll'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const r = zodErrors(payslipPaySchema, v);
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={slip ? `Pay ${slip.staff.name} · ${formatINR(slip.net)}` : 'Mark all unpaid salaries as paid'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 pb-2">
        <Field label="Paid on" error={errors.paidAt}>
          <Input type="date" value={v.paidAt} max={todayStr()} min={`${month}-01`} onChange={(e) => setV({ ...v, paidAt: e.target.value })} />
        </Field>
        <Field label="Mode" error={errors.mode}>
          <Select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
            {FINANCE_PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {modeLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference (UTR / cheque no.)" error={errors.reference} className="col-span-2">
          <Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ───────── Payslip print ─────────

function PayslipDoc({ slip, monthLabel }: { slip: Slip; monthLabel: string }) {
  const b = slip.breakdown;
  const s = slip.staff;
  const rows = Math.max(b.earnings.length, b.deductions.length + (slip.lopDeduction ? 1 : 0));
  const deductions = [...b.deductions, ...(slip.lopDeduction ? [{ key: 'lop', label: `Loss of pay (${days(slip.unpaidDays)} days)`, amount: slip.lopDeduction }] : [])];
  return (
    <PrintSheet>
      <Letterhead title={`Salary slip · ${monthLabel}`} />
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-4">
        {[
          ['Name', s.name],
          ['Employee code', s.employeeCode],
          ['Designation', s.designation],
          ['Date of joining', s.joiningDate ? fmtDate(s.joiningDate) : '—'],
          ['Bank', s.bankName ?? '—'],
          ['Account no.', mask(s.bankAccount)],
          ['IFSC', s.ifsc ?? '—'],
          ['PAN', s.pan ?? '—'],
          ['Working days', String(slip.workingDays)],
          ['Paid days', days(slip.paidDays)],
        ].map(([k, val]) => (
          <div key={k} className="flex gap-2">
            <span className="w-32 text-gray-600">{k}</span>
            <span className="font-medium">{val}</span>
          </div>
        ))}
      </div>
      <table className="w-full border border-black border-collapse text-[13px]">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-black px-2 py-1 text-left">Earnings</th>
            <th className="border border-black px-2 py-1 text-right w-28">Amount</th>
            <th className="border border-black px-2 py-1 text-left">Deductions</th>
            <th className="border border-black px-2 py-1 text-right w-28">Amount</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td className="border-x border-black px-2 py-0.5">{b.earnings[i]?.label ?? ''}</td>
              <td className="border-x border-black px-2 py-0.5 text-right tabular-nums">{b.earnings[i] ? formatINR(b.earnings[i].amount) : ''}</td>
              <td className="border-x border-black px-2 py-0.5">{deductions[i]?.label ?? ''}</td>
              <td className="border-x border-black px-2 py-0.5 text-right tabular-nums">{deductions[i] ? formatINR(deductions[i].amount) : ''}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="border border-black px-2 py-1">Gross earnings</td>
            <td className="border border-black px-2 py-1 text-right tabular-nums">{formatINR(slip.gross)}</td>
            <td className="border border-black px-2 py-1">Total deductions</td>
            <td className="border border-black px-2 py-1 text-right tabular-nums">{formatINR(slip.deductions + slip.lopDeduction)}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-4 border border-black px-3 py-2 flex flex-wrap justify-between gap-2">
        <span className="font-bold">Net pay: {formatINR(slip.net)}</span>
        <span className="italic">{amountInWords(slip.net)}</span>
      </div>
      {b.adjustment.note && <div className="mt-2 text-[12px]">Note: {b.adjustment.note}</div>}
      {slip.paidAt && (
        <div className="mt-2 text-[12px]">
          Paid on {fmtDate(slip.paidAt)} by {modeLabel(slip.paymentMode)}
          {slip.reference ? ` (Ref. ${slip.reference})` : ''}
        </div>
      )}
      <Signatures labels={['Employee', 'Accountant', 'Principal']} />
    </PrintSheet>
  );
}

function PayslipPrintPage() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ['payroll', 'payslip', id],
    queryFn: async () => (await api.get<Slip & { monthLabel: string }>(`/payroll/payslips/${id}`)).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <>
      <PrintToolbar title={`Payslip · ${q.data!.staff.name}`} />
      <PayslipDoc slip={q.data!} monthLabel={q.data!.monthLabel} />
    </>
  );
}

function BulkPrintPage() {
  const { month = '' } = useParams();
  const q = useQuery({ queryKey: ['payroll', 'month', month], queryFn: async () => (await api.get<MonthData>(`/payroll/months/${month}`)).data });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <>
      <PrintToolbar title={`All payslips · ${q.data!.label}`} />
      <div className="space-y-6 print:space-y-0">
        {q.data!.payslips.map((p, i) => (
          <div key={p.id} className={i < q.data!.payslips.length - 1 ? 'page-break' : ''}>
            <PayslipDoc slip={p} monthLabel={q.data!.label} />
          </div>
        ))}
      </div>
    </>
  );
}
