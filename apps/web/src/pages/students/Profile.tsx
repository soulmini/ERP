import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Camera, FileText, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react';
import {
  GUARDIAN_RELATION_LABELS,
  STUDENT_STATUS_LABELS,
  admissionGuardianSchema,
  studentGuardianUpdateSchema,
  studentLeaveSchema,
  studentUpdateSchema,
  type GuardianRelationKey,
  type StudentStatusKey,
} from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { sectionOptions, useClasses } from '../../lib/queries';
import { Avatar, Button, Card, ErrorBox, Field, Input, Loading, Modal, Select, Stat, Tabs, Tag } from '../../components/ui';
import { fmtDate, todayStr } from '../../lib/utils';
import { zodErrors } from '../accounts/zod';
import { FieldsGrid, GUARDIAN_FIELDS, PROFILE_KEYS, STUDENT_FIELDS, guardianPayload, type Values } from './fields';

interface Guardian {
  id: string;
  name: string;
  relation: GuardianRelationKey;
  phone: string;
  email: string | null;
  occupation: string | null;
  qualification: string | null;
  annualIncome: number | null;
  aadhaarNo: string | null;
  address: string | null;
  isPrimary: boolean;
  hasLogin: boolean;
}
type Summary = { days: number; present: number; absent: number; leave: number; percent: number | null };
interface Profile extends Record<string, unknown> {
  id: string;
  name: string;
  admissionNo: string;
  status: StudentStatusKey;
  leftDate: string | null;
  leftReason: string | null;
  photoUrl: string | null;
  current: { sectionId: string; classLabel: string; rollNo: number | null } | null;
  enrollments: { id: string; session: string; classLabel: string; rollNo: number | null }[];
  guardians: Guardian[];
  documents: { id: string; name: string; contentType: string; size: number; uploadedAt: string; url: string | null }[];
  attendance: { session: Summary; month: Summary };
  canEdit: boolean;
}

const str = (v: unknown) => (v == null ? '' : String(v));

export function StudentProfile() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'details' | 'parents' | 'documents' | 'attendance'>('details');
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['student', id], queryFn: async () => (await api.get<Profile>(`/students/${id}`)).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['student', id] }).then(() => qc.invalidateQueries({ queryKey: ['students'] }));
  const photo = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api.post(`/students/${id}/photo`, fd);
    },
    onSuccess: () => (toast.success('Photo updated'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reactivate = useMutation({
    mutationFn: () => api.post(`/students/${id}/reactivate`, {}),
    onSuccess: () => (toast.success('Student is active again'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data!;

  return (
    <>
      <Link to="/students" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Students
      </Link>
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <button className="relative group" disabled={!s.canEdit} onClick={() => photoRef.current?.click()} title={s.canEdit ? 'Change photo' : undefined}>
          <Avatar name={s.name} src={s.photoUrl} size={72} />
          {s.canEdit && (
            <span className="absolute bottom-0 right-0 size-6 rounded-full bg-ink-strong text-white flex items-center justify-center border-2 border-white">
              <Camera className="size-3" />
            </span>
          )}
        </button>
        <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} />
        <div className="flex-1 min-w-0">
          <PageHeaderLite name={s.name} />
          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-sm text-muted">
            {s.current && <Tag color="blue">{s.current.classLabel}</Tag>}
            {s.current?.rollNo && <span>Roll {s.current.rollNo}</span>}
            <span>· Adm. {s.admissionNo}</span>
            <Tag color={s.status === 'ACTIVE' ? 'green' : 'gray'}>{STUDENT_STATUS_LABELS[s.status]}</Tag>
          </div>
          {s.status !== 'ACTIVE' && (
            <div className="text-xs text-muted mt-1">
              Left on {s.leftDate ? fmtDate(s.leftDate) : '—'} · {s.leftReason}
            </div>
          )}
        </div>
        {s.canEdit && (
          <div className="flex gap-2">
            {s.status === 'ACTIVE' ? (
              <Button variant="danger" onClick={() => setLeaving(true)}>
                Mark as left
              </Button>
            ) : (
              <Button loading={reactivate.isPending} onClick={() => reactivate.mutate()}>
                Re-activate
              </Button>
            )}
          </div>
        )}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'details', label: 'Details' },
          { value: 'parents', label: `Parents (${s.guardians.length})` },
          { value: 'documents', label: `Documents (${s.documents.length})` },
          { value: 'attendance', label: 'Attendance' },
        ]}
      />
      {tab === 'details' && (editing ? <EditDetails s={s} onDone={() => (setEditing(false), refresh())} /> : <ViewDetails s={s} onEdit={() => setEditing(true)} />)}
      {tab === 'parents' && <Parents s={s} refresh={refresh} />}
      {tab === 'documents' && <Documents s={s} refresh={refresh} />}
      {tab === 'attendance' && <Attendance s={s} />}
      {leaving && <LeaveModal id={s.id} name={s.name} onClose={() => setLeaving(false)} onDone={refresh} />}
    </>
  );
}

function PageHeaderLite({ name }: { name: string }) {
  return <h1 className="text-2xl md:text-[30px] font-bold tracking-tight text-ink-strong leading-tight">{name}</h1>;
}

function ViewDetails({ s, onEdit }: { s: Profile; onEdit: () => void }) {
  return (
    <div className="space-y-4">
      {s.canEdit && (
        <Button icon={<Pencil className="size-4" />} onClick={onEdit}>
          Edit details
        </Button>
      )}
      {STUDENT_FIELDS.map((g) => (
        <Card key={g.title} className="p-4">
          <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">{g.title}</div>
          <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            {g.fields.map((f) => {
              let v = str(s[f.key]);
              if (f.key === 'gender') v = v === 'MALE' ? 'Boy' : v === 'FEMALE' ? 'Girl' : v;
              if (f.type === 'date' && v) v = fmtDate(v);
              return (
                <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
                  <dt className="text-xs text-muted">{f.label.replace(' *', '')}</dt>
                  <dd className="text-ink-strong">{v || '—'}</dd>
                </div>
              );
            })}
          </dl>
        </Card>
      ))}
      <Card className="p-4">
        <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">Class history</div>
        {s.enrollments.map((e) => (
          <div key={e.id} className="text-sm">
            {e.session}: Class {e.classLabel}
            {e.rollNo ? `, Roll ${e.rollNo}` : ''}
          </div>
        ))}
      </Card>
    </div>
  );
}

function EditDetails({ s, onDone }: { s: Profile; onDone: () => void }) {
  const classes = useClasses();
  const [v, setV] = useState<Values>({
    ...Object.fromEntries(PROFILE_KEYS.map((k) => [k, str(s[k])])),
    admissionNo: s.admissionNo,
    sectionId: s.current?.sectionId ?? '',
    rollNo: str(s.current?.rollNo),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  const save = useMutation({
    mutationFn: (d: object) => api.put(`/students/${s.id}`, d),
    onSuccess: () => (toast.success('Details saved'), onDone()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const r = zodErrors(studentUpdateSchema, v);
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
    else toast.error('Please check the highlighted fields');
  };
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">Admission</div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Admission no. *" error={errors.admissionNo}>
            <Input value={v.admissionNo} onChange={(e) => set('admissionNo', e.target.value)} />
          </Field>
          {s.current && (
            <>
              <Field label="Class" error={errors.sectionId}>
                <Select value={v.sectionId} onChange={(e) => set('sectionId', e.target.value)}>
                  {sectionOptions(classes.data).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Roll no." error={errors.rollNo}>
                <Input value={v.rollNo} onChange={(e) => set('rollNo', e.target.value)} />
              </Field>
            </>
          )}
        </div>
      </Card>
      {STUDENT_FIELDS.map((g) => (
        <Card key={g.title} className="p-4">
          <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">{g.title}</div>
          <FieldsGrid defs={g.fields} v={v} set={set} errors={errors} />
        </Card>
      ))}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={submit}>
          Save details
        </Button>
      </div>
    </div>
  );
}

function Parents({ s, refresh }: { s: Profile; refresh: () => void }) {
  const [editing, setEditing] = useState<Guardian | 'new' | null>(null);
  const primary = useMutation({
    mutationFn: (gid: string) => api.post<{ parentLogin: { username: string; initialPassword: string } | null }>(`/students/${s.id}/guardians/${gid}/primary`),
    onSuccess: (r) => {
      toast.success(r.data.parentLogin ? `Primary contact changed. App login: ${r.data.parentLogin.username} / ${r.data.parentLogin.initialPassword}` : 'Primary contact changed', { duration: 8000 });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (gid: string) => api.delete(`/students/${s.id}/guardians/${gid}`),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <div className="grid md:grid-cols-2 gap-3">
        {s.guardians.map((g) => (
          <Card key={g.id} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-ink-strong">{g.name}</span>
              <Tag>{GUARDIAN_RELATION_LABELS[g.relation]}</Tag>
              {g.isPrimary && (
                <Tag color="yellow">
                  <Star className="size-3" /> Primary
                </Tag>
              )}
              {g.hasLogin && <Tag color="green">App login</Tag>}
            </div>
            <div className="text-sm space-y-0.5">
              <div>
                <a href={`tel:${g.phone}`} className="hover:underline">
                  {g.phone}
                </a>
                {g.email && <span className="text-muted"> · {g.email}</span>}
              </div>
              {(g.occupation || g.qualification) && <div className="text-muted">{[g.occupation, g.qualification].filter(Boolean).join(' · ')}</div>}
              {g.annualIncome != null && <div className="text-muted">Income ₹{(g.annualIncome / 100).toLocaleString('en-IN')} / year</div>}
            </div>
            {s.canEdit && (
              <div className="flex gap-1 mt-3">
                <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(g)}>
                  Edit
                </Button>
                {!g.isPrimary && (
                  <>
                    <Button size="sm" loading={primary.isPending} onClick={() => primary.mutate(g.id)}>
                      Make primary
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => confirm(`Remove ${g.name}?`) && remove.mutate(g.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
      {s.canEdit && s.guardians.length < 3 && (
        <Button className="mt-3" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          Add parent / guardian
        </Button>
      )}
      {editing && <GuardianModal studentId={s.id} g={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </>
  );
}

function GuardianModal({ studentId, g, onClose, onDone }: { studentId: string; g: Guardian | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<Values>({
    relation: g?.relation ?? 'MOTHER',
    name: g?.name ?? '',
    phone: g?.phone ?? '',
    email: g?.email ?? '',
    occupation: g?.occupation ?? '',
    qualification: g?.qualification ?? '',
    annualIncome: g?.annualIncome != null ? String(g.annualIncome / 100) : '',
    aadhaarNo: g?.aadhaarNo ?? '',
    address: g?.address ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (d: object) => (g ? api.put(`/students/${studentId}/guardians/${g.id}`, d) : api.post(`/students/${studentId}/guardians`, d)),
    onSuccess: () => (toast.success('Saved'), onDone(), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const payload = guardianPayload(v);
    const r = g ? zodErrors(studentGuardianUpdateSchema, payload) : zodErrors(admissionGuardianSchema, { ...payload, isPrimary: false });
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={g ? `Edit ${g.name}` : 'Add parent / guardian'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      {g && <p className="text-xs text-muted mb-3">Changes apply to this parent's other children too. Changing the mobile also changes their app login.</p>}
      <div className="pb-2">
        <FieldsGrid defs={GUARDIAN_FIELDS} v={v} set={(k, val) => setV((x) => ({ ...x, [k]: val }))} errors={errors} />
      </div>
    </Modal>
  );
}

function Documents({ s, refresh }: { s: Profile; refresh: () => void }) {
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const add = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('name', name || f.name);
      fd.append('file', f);
      return api.post(`/students/${s.id}/documents`, fd);
    },
    onSuccess: () => (toast.success('Document uploaded'), setName(''), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (docId: string) => api.delete(`/students/${s.id}/documents/${docId}`),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      {s.canEdit && (
        <Card className="p-4 mb-4 flex flex-wrap items-end gap-2">
          <Field label="Document name" className="flex-1 min-w-48">
            <Select value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">Choose…</option>
              {['Birth certificate', 'Aadhaar card', 'Previous TC', 'Previous marksheet', 'Caste certificate', 'Photo', 'Other'].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" icon={<Upload className="size-4" />} loading={add.isPending} onClick={() => fileRef.current?.click()}>
            Upload image / PDF
          </Button>
          <input ref={fileRef} type="file" hidden accept="image/*,application/pdf" onChange={(e) => (e.target.files?.[0] && add.mutate(e.target.files[0]), (e.target.value = ''))} />
        </Card>
      )}
      {!s.documents.length ? (
        <div className="text-sm text-muted">No documents uploaded.</div>
      ) : (
        <Card className="divide-y divide-line">
          {s.documents.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileText className="size-4 text-tag-red-ink" />
              <a href={d.url ?? '#'} target="_blank" rel="noreferrer" className="flex-1 hover:underline text-ink-strong">
                {d.name}
              </a>
              <span className="text-xs text-muted">
                {Math.ceil(d.size / 1024)} KB · {fmtDate(d.uploadedAt)}
              </span>
              {s.canEdit && (
                <button className="p-1.5 rounded hover:bg-hover text-muted" onClick={() => confirm('Delete this document?') && del.mutate(d.id)}>
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function Attendance({ s }: { s: Profile }) {
  const row = (title: string, a: Summary) => (
    <div>
      <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Attendance" value={a.percent == null ? '—' : `${a.percent}%`} />
        <Stat label="Present" value={a.present} sub={`of ${a.days} days`} />
        <Stat label="Absent" value={a.absent} />
        <Stat label="Leave" value={a.leave} />
      </div>
    </div>
  );
  return (
    <div className="space-y-6">
      {row('This month', s.attendance.month)}
      {row('This session', s.attendance.session)}
    </div>
  );
}

function LeaveModal({ id, name, onClose, onDone }: { id: string; name: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ status: 'LEFT', leftDate: todayStr(), leftReason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (d: object) => api.post(`/students/${id}/leave`, d),
    onSuccess: () => (toast.success(`${name} marked as left`), onDone(), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`${name} is leaving`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={save.isPending}
            onClick={() => {
              const r = zodErrors(studentLeaveSchema, v);
              setErrors(r.errors);
              if (r.data) save.mutate(r.data);
            }}
          >
            Confirm
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <p className="text-sm text-muted">To issue a Transfer Certificate, use Certificates → TC instead (it marks the student as left automatically).</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
              <option value="LEFT">Left school</option>
              <option value="PASSED_OUT">Passed out</option>
            </Select>
          </Field>
          <Field label="Date" error={errors.leftDate}>
            <Input type="date" value={v.leftDate} onChange={(e) => setV({ ...v, leftDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Reason" error={errors.leftReason}>
          <Input value={v.leftReason} onChange={(e) => setV({ ...v, leftReason: e.target.value })} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

