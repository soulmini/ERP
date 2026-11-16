import { useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Paperclip, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { NOTICE_AUDIENCE_LABELS, SMS_PURPOSES, holidaySchema, noticeSchema, type NoticeAudience } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useZodForm } from '../../lib/form';
import { sectionOptions, useClasses } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Tag, Textarea, type TagColor } from '../../components/ui';
import { cn, fmtDate, fmtTime, todayStr } from '../../lib/utils';

interface Notice {
  id: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  sectionIds: string[];
  sections: string[];
  pinned: boolean;
  publishedAt: string;
  expiresOn: string | null;
  expired: boolean;
  postedBy: string | null;
  attachment: { name: string | null; url: string | null } | null;
}
interface Holiday {
  id: string;
  name: string;
  date: string;
  endDate: string | null;
  days: number;
}

const AUDIENCE_COLOR: Record<NoticeAudience, TagColor> = { ALL: 'green', STAFF: 'purple', PARENTS: 'blue', SECTIONS: 'orange' };

/** Notices, holidays and SMS log. Mounted at /notices/*. */
export function NoticesModule() {
  return (
    <Routes>
      <Route index element={<NoticesPage />} />
    </Routes>
  );
}

function NoticesPage() {
  const { user, can } = useAuth();
  const manage = user?.view === 'admin' && can('notices.manage');
  const [tab, setTab] = useState<'notices' | 'holidays' | 'sms'>('notices');
  return (
    <>
      <PageHeader icon="📣" title={manage ? 'Notices & SMS' : 'Notices'} description="Circulars, announcements and the holiday calendar." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'notices', label: 'Notices' },
          { value: 'holidays', label: 'Holidays' },
          ...(manage ? [{ value: 'sms' as const, label: 'SMS log' }] : []),
        ]}
      />
      {tab === 'notices' && <NoticesTab manage={manage} />}
      {tab === 'holidays' && <HolidaysTab manage={manage} />}
      {tab === 'sms' && manage && <SmsLogTab />}
    </>
  );
}

// ───────── Notices ─────────

function NoticesTab({ manage }: { manage: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Notice | 'new' | null>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notices', showAll],
    queryFn: async () => (await api.get<Notice[]>('/notices', { params: { all: showAll ? 1 : undefined } })).data,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/notices/${id}`),
    onSuccess: () => (toast.success('Notice deleted'), qc.invalidateQueries({ queryKey: ['notices'] })),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      {manage && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New notice
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show expired
          </label>
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.length ? (
        <Empty icon="📣" title="No notices">{manage ? 'Post the first notice for staff or parents.' : 'Nothing new from the school.'}</Empty>
      ) : (
        <div className="space-y-3">
          {q.data!.map((n) => (
            <Card key={n.id} className={cn('p-4 md:p-5', n.pinned && 'border-[#e6d7b8] bg-[#fffdf7]', n.expired && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                {n.pinned && (
                  <Tag color="yellow">
                    <Pin className="size-3" /> Pinned
                  </Tag>
                )}
                <Tag color={AUDIENCE_COLOR[n.audience]}>
                  {n.audience === 'SECTIONS' ? `Class ${n.sections.join(', ')}` : NOTICE_AUDIENCE_LABELS[n.audience]}
                </Tag>
                {n.expired && <Tag>Expired</Tag>}
                <span className="text-xs text-muted">{fmtDate(n.publishedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                {manage && (
                  <div className="ml-auto flex gap-0.5">
                    <button className="p-1.5 rounded hover:bg-hover text-muted" title="Edit" onClick={() => setEditing(n)}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button className="p-1.5 rounded hover:bg-hover text-muted" title="Delete" onClick={() => confirm('Delete this notice?') && del.mutate(n.id)}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <h3 className="text-[17px] font-semibold text-ink-strong">{n.title}</h3>
              <p className="text-sm mt-1.5 whitespace-pre-wrap leading-relaxed">{n.body}</p>
              {n.attachment?.url && (
                <a
                  href={n.attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 px-2.5 h-8 rounded-md border border-line text-sm hover:bg-hover"
                >
                  <FileText className="size-4 text-tag-red-ink" /> {n.attachment.name ?? 'Attachment'}
                </a>
              )}
              <div className="text-xs text-faint mt-3">
                {n.postedBy && `Posted by ${n.postedBy}`}
                {n.expiresOn && ` · Visible till ${fmtDate(n.expiresOn, { day: 'numeric', month: 'short' })}`}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <NoticeForm notice={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function NoticeForm({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const qc = useQueryClient();
  const classes = useClasses();
  const options = sectionOptions(classes.data);
  const f = useZodForm(noticeSchema, {
    title: notice?.title ?? '',
    body: notice?.body ?? '',
    audience: notice?.audience ?? 'ALL',
    sectionIds: notice?.sectionIds ?? [],
    pinned: notice?.pinned ?? false,
    expiresOn: notice?.expiresOn ?? '',
    sendSms: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const audience = f.values.audience as NoticeAudience;
  const sectionIds = (f.values.sectionIds as string[]) ?? [];

  const save = useMutation({
    mutationFn: async (data: object) => {
      const fd = new FormData();
      fd.append('data', JSON.stringify(notice ? { ...data, removeAttachment } : data));
      if (file) fd.append('file', file);
      return (notice ? await api.put(`/notices/${notice.id}`, fd) : await api.post('/notices', fd)).data as { smsQueued?: number };
    },
    onSuccess: (d) => {
      toast.success(notice ? 'Notice updated' : `Notice published${d.smsQueued ? ` · SMS to ${d.smsQueued} parents` : ''}`);
      qc.invalidateQueries({ queryKey: ['notices'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={notice ? 'Edit notice' : 'New notice'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              const d = f.validate();
              if (d) save.mutate(d);
            }}
          >
            {notice ? 'Save' : 'Publish'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <Field label="Title *" error={f.errors.title}>
          <Input {...f.bind('title')} autoFocus={!notice} placeholder="e.g. Winter vacation from 25 December" />
        </Field>
        <Field label="Notice *" error={f.errors.body}>
          <Textarea {...f.bind('body')} rows={6} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Who should see it" error={f.errors.audience}>
            <Select {...f.bind('audience')}>
              {(Object.keys(NOTICE_AUDIENCE_LABELS) as NoticeAudience[]).map((k) => (
                <option key={k} value={k}>
                  {NOTICE_AUDIENCE_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Show until" hint="Leave empty to keep it" error={f.errors.expiresOn}>
            <Input type="date" {...f.bind('expiresOn')} min={todayStr()} />
          </Field>
        </div>
        {audience === 'SECTIONS' && (
          <div>
            <div className="text-[13px] font-medium text-muted mb-1.5">Classes *</div>
            <div className="flex flex-wrap gap-1.5">
              {options.map((o) => {
                const on = sectionIds.includes(o.id);
                return (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => f.set('sectionIds', on ? sectionIds.filter((x) => x !== o.id) : [...sectionIds, o.id])}
                    className={cn('px-2.5 h-7 rounded-md border text-sm', on ? 'bg-ink-strong text-white border-ink-strong' : 'border-line hover:bg-hover')}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {f.errors.sectionIds && <div className="text-xs text-tag-red-ink mt-1">{f.errors.sectionIds}</div>}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!f.values.pinned} onChange={(e) => f.set('pinned', e.target.checked)} /> Pin to top
          </label>
          {!notice && audience !== 'STAFF' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!f.values.sendSms} onChange={(e) => f.set('sendSms', e.target.checked)} /> Also send SMS to parents
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notice?.attachment && !removeAttachment && !file && (
            <span className="inline-flex items-center gap-1 text-sm bg-tag-gray px-2 h-7 rounded-md">
              {notice.attachment.name}
              <button type="button" className="text-muted px-1" onClick={() => setRemoveAttachment(true)}>
                ×
              </button>
            </span>
          )}
          {file && <span className="text-sm bg-tag-gray px-2 h-7 inline-flex items-center rounded-md">{file.name}</span>}
          <Button type="button" size="sm" icon={<Paperclip className="size-3.5" />} onClick={() => fileRef.current?.click()}>
            {file || notice?.attachment ? 'Replace attachment' : 'Attach image / PDF'}
          </Button>
          <input ref={fileRef} type="file" hidden accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>
    </Modal>
  );
}

// ───────── Holidays ─────────

function HolidaysTab({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const q = useQuery({ queryKey: ['holidays'], queryFn: async () => (await api.get<Holiday[]>('/notices/holidays')).data });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/notices/holidays/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const today = todayStr();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const upcoming = q.data!.filter((h) => (h.endDate ?? h.date) >= today);
  const past = q.data!.filter((h) => (h.endDate ?? h.date) < today);

  return (
    <>
      {manage && (
        <Button variant="primary" className="mb-4" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          Add holiday
        </Button>
      )}
      {!q.data!.length ? (
        <Empty icon="🏖️" title="No holidays added">{manage ? 'Add the holidays of this session.' : undefined}</Empty>
      ) : (
        <Card className="divide-y divide-line">
          {[...upcoming, ...past].map((h) => {
            const isPast = (h.endDate ?? h.date) < today;
            return (
              <div key={h.id} className={cn('flex items-center gap-3 px-4 py-3', isPast && 'opacity-50')}>
                <div className="w-12 text-center shrink-0">
                  <div className="text-[11px] uppercase text-muted">{fmtDate(h.date, { month: 'short' })}</div>
                  <div className="text-lg font-semibold text-ink-strong leading-tight">{fmtDate(h.date, { day: 'numeric' })}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-ink-strong">{h.name}</div>
                  <div className="text-xs text-muted">
                    {fmtDate(h.date, { weekday: 'long' })}
                    {h.endDate && ` – ${fmtDate(h.endDate, { day: 'numeric', month: 'short' })} · ${h.days} days`}
                  </div>
                </div>
                {manage && (
                  <div className="flex gap-0.5">
                    <button className="p-1.5 rounded hover:bg-hover text-muted" onClick={() => setEditing(h)} title="Edit">
                      <Pencil className="size-3.5" />
                    </button>
                    <button className="p-1.5 rounded hover:bg-hover text-muted" onClick={() => confirm(`Delete ${h.name}?`) && del.mutate(h.id)} title="Delete">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
      {editing && <HolidayForm holiday={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function HolidayForm({ holiday, onClose }: { holiday: Holiday | null; onClose: () => void }) {
  const qc = useQueryClient();
  const f = useZodForm(holidaySchema, { name: holiday?.name ?? '', date: holiday?.date ?? '', endDate: holiday?.endDate ?? '' });
  const save = useMutation({
    mutationFn: (d: object) => (holiday ? api.put(`/notices/holidays/${holiday.id}`, d) : api.post('/notices/holidays', d)),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['holidays'] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={holiday ? 'Edit holiday' : 'Add holiday'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => { const d = f.validate(); if (d) save.mutate(d); }}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <Field label="Holiday *" error={f.errors.name}>
          <Input {...f.bind('name')} placeholder="e.g. Diwali" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From *" error={f.errors.date}>
            <Input type="date" {...f.bind('date')} />
          </Field>
          <Field label="To" hint="For vacations" error={f.errors.endDate}>
            <Input type="date" {...f.bind('endDate')} min={String(f.values.date ?? '')} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ───────── SMS log ─────────

interface SmsLogRow {
  id: string;
  to: string;
  message: string;
  purpose: string;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
  error: string | null;
  createdAt: string;
}
const SMS_COLOR: Record<SmsLogRow['status'], TagColor> = { SENT: 'green', QUEUED: 'yellow', FAILED: 'red', SKIPPED: 'gray' };

function SmsLogTab() {
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['sms-log', purpose, status, page],
    queryFn: async () =>
      (await api.get<{ total: number; pageSize: number; provider: string; items: SmsLogRow[] }>('/notices/sms-log', {
        params: { purpose: purpose || undefined, status: status || undefined, page },
      })).data,
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <>
      {q.data?.provider === 'log' && (
        <div className="rounded-md bg-tag-yellow text-tag-yellow-ink px-3 py-2 text-sm mb-3">
          SMS sending is off (test mode). Messages are recorded here as “Skipped”. Set SMS_PROVIDER, SMS_API_KEY and DLT templates on the server to send real SMS.
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        <Select value={purpose} onChange={(e) => (setPurpose(e.target.value), setPage(1))} className="w-auto">
          <option value="">All types</option>
          {Object.entries(SMS_PURPOSES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="w-auto">
          <option value="">All status</option>
          {Object.keys(SMS_COLOR).map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty icon="💬" title="No SMS yet">Absent alerts and notice SMS will appear here.</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>To</th>
                <th>Type</th>
                <th>Message</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap text-muted text-xs">
                    {fmtDate(s.createdAt, { day: 'numeric', month: 'short' })} {fmtTime(s.createdAt)}
                  </td>
                  <td className="tabular-nums">{s.to}</td>
                  <td className="whitespace-nowrap">{SMS_PURPOSES[s.purpose] ?? s.purpose}</td>
                  <td className="text-xs max-w-md">{s.message}</td>
                  <td>
                    <Tag color={SMS_COLOR[s.status]}>{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</Tag>
                    {s.error && <div className="text-[11px] text-tag-red-ink mt-0.5">{s.error}</div>}
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
    </>
  );
}
