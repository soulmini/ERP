import { useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { ENQUIRY_SOURCE_LABELS, ENQUIRY_STATUS_LABELS, ENQUIRY_SOURCES, enquirySchema, type EnquiryStatusKey } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { useClasses } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Tag, Textarea, type TagColor } from '../../components/ui';
import { cn, fmtDate, todayStr } from '../../lib/utils';
import { zodErrors } from '../accounts/zod';
import { AdmissionForm } from './AdmissionForm';
import { PromotePage } from './Promote';

export interface Enquiry {
  id: string;
  studentName: string;
  gender: string | null;
  dob: string | null;
  classId: string | null;
  class: { id: string; name: string } | null;
  guardianName: string;
  phone: string;
  email: string | null;
  address: string | null;
  source: string | null;
  status: EnquiryStatusKey;
  followUpDate: string | null;
  followUpDue: boolean;
  notes: string | null;
  student: { id: string; admissionNo: string } | null;
  createdAt: string;
}

const STATUS_COLOR: Record<EnquiryStatusKey, TagColor> = { NEW: 'blue', FOLLOW_UP: 'orange', CONVERTED: 'green', CLOSED: 'gray' };

/** Admissions module. Mounted at /admissions/*. */
export function AdmissionsModule() {
  return (
    <Routes>
      <Route index element={<AdmissionsHome />} />
      <Route path="new" element={<AdmissionForm />} />
      <Route path="promote" element={<PromotePage />} />
    </Routes>
  );
}

function AdmissionsHome() {
  return (
    <>
      <PageHeader
        icon="📝"
        title="Admissions"
        description="Track enquiries, admit students with the full form, and promote classes at year end."
        actions={
          <>
            <Link to="/admissions/promote">
              <Button>Promote students</Button>
            </Link>
            <Link to="/admissions/new">
              <Button variant="primary" icon={<UserPlus className="size-4" />}>
                New admission
              </Button>
            </Link>
          </>
        }
      />
      <Enquiries />
    </>
  );
}

function Enquiries() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('OPEN');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Enquiry | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['enquiries', search],
    queryFn: async () => (await api.get<Enquiry[]>('/admissions/enquiries', { params: { search: search || undefined } })).data,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admissions/enquiries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enquiries'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const all = q.data ?? [];
  const rows = all.filter((e) => (status === 'OPEN' ? e.status === 'NEW' || e.status === 'FOLLOW_UP' : status === 'DUE' ? e.followUpDue : !status || e.status === status));
  const due = all.filter((e) => e.followUpDue).length;

  return (
    <>
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'OPEN', label: 'Open enquiries' },
          { value: 'DUE', label: `Follow-up today${due ? ` (${due})` : ''}` },
          { value: 'CONVERTED', label: 'Admitted' },
          { value: 'CLOSED', label: 'Closed' },
          { value: '', label: 'All' },
        ]}
      />
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="size-4 text-faint absolute left-2.5 top-2.5" />
          <Input placeholder="Search name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          Add enquiry
        </Button>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !rows.length ? (
        <Empty icon="📝" title="No enquiries here">Log walk-in and phone enquiries so nobody is forgotten.</Empty>
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((e) => (
            <div key={e.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', e.followUpDue && 'bg-[#fffcf5]')}>
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-strong">{e.studentName}</span>
                  <Tag color={STATUS_COLOR[e.status]}>{ENQUIRY_STATUS_LABELS[e.status]}</Tag>
                  {e.class && <Tag color="purple">For class {e.class.name}</Tag>}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {e.guardianName} ·{' '}
                  <a href={`tel:${e.phone}`} className="hover:underline">
                    {e.phone}
                  </a>
                  {e.source && ` · ${ENQUIRY_SOURCE_LABELS[e.source as keyof typeof ENQUIRY_SOURCE_LABELS] ?? e.source}`} · {fmtDate(e.createdAt, { day: 'numeric', month: 'short' })}
                  {e.followUpDate && e.status !== 'CONVERTED' && (
                    <span className={e.followUpDue ? 'text-tag-orange-ink font-medium' : ''}> · Follow up {fmtDate(e.followUpDate, { day: 'numeric', month: 'short' })}</span>
                  )}
                </div>
                {e.notes && <div className="text-xs text-ink mt-1 line-clamp-2">{e.notes}</div>}
              </div>
              <div className="flex gap-1">
                {e.status !== 'CONVERTED' && e.status !== 'CLOSED' && (
                  <Button size="sm" variant="primary" onClick={() => nav(`/admissions/new?enquiry=${e.id}`)}>
                    Admit
                  </Button>
                )}
                {e.student && (
                  <Link to={`/students/${e.student.id}`}>
                    <Button size="sm">{e.student.admissionNo}</Button>
                  </Link>
                )}
                <button className="p-1.5 rounded hover:bg-hover text-muted" title="Edit" onClick={() => setEditing(e)}>
                  <Pencil className="size-3.5" />
                </button>
                {e.status !== 'CONVERTED' && (
                  <button className="p-1.5 rounded hover:bg-hover text-muted" title="Delete" onClick={() => confirm('Delete this enquiry?') && del.mutate(e.id)}>
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      {editing && <EnquiryForm e={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EnquiryForm({ e, onClose }: { e: Enquiry | null; onClose: () => void }) {
  const qc = useQueryClient();
  const classes = useClasses();
  const [v, setV] = useState<Record<string, string>>({
    studentName: e?.studentName ?? '',
    gender: e?.gender ?? '',
    dob: e?.dob ?? '',
    classId: e?.classId ?? '',
    guardianName: e?.guardianName ?? '',
    phone: e?.phone ?? '',
    email: e?.email ?? '',
    address: e?.address ?? '',
    source: e?.source ?? 'walk-in',
    notes: e?.notes ?? '',
    followUpDate: e?.followUpDate ?? '',
    status: e && e.status !== 'CONVERTED' ? e.status : 'NEW',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  const save = useMutation({
    mutationFn: (d: object) => (e ? api.put(`/admissions/enquiries/${e.id}`, d) : api.post('/admissions/enquiries', d)),
    onSuccess: () => (toast.success('Enquiry saved'), qc.invalidateQueries({ queryKey: ['enquiries'] }), onClose()),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const submit = () => {
    const r = zodErrors(enquirySchema, { ...v, status: e?.status === 'CONVERTED' ? undefined : v.status });
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  const input = (k: string, label: string, type = 'text') => (
    <Field label={label} error={errors[k]}>
      <Input type={type} value={v[k]} onChange={(x) => set(k, x.target.value)} />
    </Field>
  );
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={e ? 'Edit enquiry' : 'New enquiry'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3 pb-2">
        {input('studentName', 'Child name *')}
        <Field label="Admission for class" error={errors.classId}>
          <Select value={v.classId} onChange={(x) => set('classId', x.target.value)}>
            <option value="">—</option>
            {classes.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gender" error={errors.gender}>
          <Select value={v.gender} onChange={(x) => set('gender', x.target.value)}>
            <option value="">—</option>
            <option value="MALE">Boy</option>
            <option value="FEMALE">Girl</option>
          </Select>
        </Field>
        {input('dob', 'Date of birth', 'date')}
        {input('guardianName', 'Parent name *')}
        {input('phone', 'Mobile *')}
        <Field label="How did they hear about us?" error={errors.source}>
          <Select value={v.source} onChange={(x) => set('source', x.target.value)}>
            {ENQUIRY_SOURCES.map((s) => (
              <option key={s} value={s}>
                {ENQUIRY_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Follow up on" error={errors.followUpDate}>
          <Input type="date" min={todayStr()} value={v.followUpDate} onChange={(x) => set('followUpDate', x.target.value)} />
        </Field>
        {e && e.status !== 'CONVERTED' && (
          <Field label="Status">
            <Select value={v.status} onChange={(x) => set('status', x.target.value)}>
              <option value="NEW">New</option>
              <option value="FOLLOW_UP">Follow-up</option>
              <option value="CLOSED">Closed (not joining)</option>
            </Select>
          </Field>
        )}
        {input('address', 'Address')}
        <Field label="Notes" error={errors.notes} className="sm:col-span-2">
          <Textarea rows={2} value={v.notes} onChange={(x) => set('notes', x.target.value)} placeholder="Fees discussed, visit planned…" />
        </Field>
      </div>
    </Modal>
  );
}
