import { useMemo, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, FileText, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import { HOMEWORK_MAX_FILES, homeworkSchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useZodForm } from '../../lib/form';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Tag, Textarea } from '../../components/ui';
import { cn, fmtDate, todayStr } from '../../lib/utils';
import { ChildSwitcher } from '../parent/Home';
import { useChildren } from '../parent/useChildren';

interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  url: string | null;
}
interface Homework {
  id: string;
  sectionId: string;
  sectionLabel: string;
  subject: { id: string; name: string } | null;
  title: string;
  description: string | null;
  assignedDate: string;
  dueDate: string | null;
  postedBy: string | null;
  canEdit: boolean;
  attachments: Attachment[];
}
interface SectionOption {
  id: string;
  label: string;
  subjects: { id: string; name: string; mine: boolean }[];
}

/** Homework module. Mounted at /homework/*. */
export function HomeworkModule() {
  return (
    <Routes>
      <Route index element={<HomeworkPage />} />
    </Routes>
  );
}

function HomeworkPage() {
  const { user } = useAuth();
  return user?.view === 'parent' ? <ParentHomework /> : <StaffHomework />;
}

// ───────── Staff (teacher / admin) ─────────

function StaffHomework() {
  const [sectionId, setSectionId] = useState('');
  const [editing, setEditing] = useState<Homework | 'new' | null>(null);
  const options = useQuery({
    queryKey: ['homework-options'],
    queryFn: async () => (await api.get<SectionOption[]>('/homework/options')).data,
  });
  const list = useQuery({
    queryKey: ['homework', sectionId],
    queryFn: async () => (await api.get<Homework[]>('/homework', { params: { sectionId: sectionId || undefined } })).data,
  });
  const canPost = (options.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        icon="📒"
        title="Homework"
        description="Post homework with photos or PDFs. Parents see it instantly in the app."
        actions={
          canPost && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Post homework
            </Button>
          )
        }
      />
      <div className="mb-4">
        <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-auto min-w-40">
          <option value="">All my classes</option>
          {options.data?.map((s) => (
            <option key={s.id} value={s.id}>
              Class {s.label}
            </option>
          ))}
        </Select>
      </div>
      <HomeworkList query={list} onEdit={setEditing} emptyText={canPost ? 'Tap "Post homework" to add the first one.' : 'No class is assigned to you yet.'} />
      {editing && options.data && (
        <HomeworkForm hw={editing === 'new' ? null : editing} options={options.data} defaultSection={sectionId} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

// ───────── Parent ─────────

function ParentHomework() {
  const { children, child, select, isLoading } = useChildren();
  const list = useQuery({
    enabled: !!child,
    queryKey: ['homework', 'child', child?.id],
    queryFn: async () => (await api.get<Homework[]>('/homework', { params: { studentId: child!.id } })).data,
  });
  if (isLoading) return <Loading />;
  return (
    <>
      <PageHeader icon="📒" title="Homework" description={child ? `${child.name} · Class ${child.classLabel ?? '—'}` : undefined} />
      <ChildSwitcher kids={children} child={child} select={select} />
      {!child ? <Empty icon="🎒" title="No student linked" /> : <HomeworkList query={list} emptyText="No homework posted yet." />}
    </>
  );
}

// ───────── List (shared) ─────────

function HomeworkList({
  query,
  onEdit,
  emptyText,
}: {
  query: { data?: Homework[]; isLoading: boolean; error: unknown };
  onEdit?: (h: Homework) => void;
  emptyText: string;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/homework/${id}`),
    onSuccess: () => (toast.success('Homework deleted'), qc.invalidateQueries({ queryKey: ['homework'] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const groups = useMemo(() => {
    const m = new Map<string, Homework[]>();
    for (const h of query.data ?? []) m.set(h.assignedDate, [...(m.get(h.assignedDate) ?? []), h]);
    return [...m.entries()];
  }, [query.data]);

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorBox error={query.error} />;
  if (!groups.length) return <Empty icon="📒" title="No homework yet">{emptyText}</Empty>;
  const today = todayStr();

  return (
    <div className="space-y-6">
      {groups.map(([date, items]) => (
        <div key={date}>
          <div className="text-[13px] font-semibold text-muted mb-2">
            {date === today ? 'Today' : fmtDate(date, { weekday: 'long', day: 'numeric', month: 'short' })}
          </div>
          <div className="space-y-2">
            {items.map((h) => (
              <Card key={h.id} className="p-4">
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  <Tag color="blue">{h.sectionLabel}</Tag>
                  {h.subject && <Tag color="purple">{h.subject.name}</Tag>}
                  {h.dueDate && (
                    <Tag color={h.dueDate < today ? 'gray' : h.dueDate === today ? 'orange' : 'yellow'}>
                      Due {h.dueDate === today ? 'today' : fmtDate(h.dueDate, { day: 'numeric', month: 'short' })}
                    </Tag>
                  )}
                  {h.canEdit && onEdit && (
                    <div className="ml-auto flex gap-0.5">
                      <button className="p-1.5 rounded hover:bg-hover text-muted" title="Edit" onClick={() => onEdit(h)}>
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        className="p-1.5 rounded hover:bg-hover text-muted"
                        title="Delete"
                        onClick={() => confirm('Delete this homework?') && del.mutate(h.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="font-semibold text-ink-strong">{h.title}</div>
                {h.description && <p className="text-sm text-ink mt-1 whitespace-pre-wrap leading-relaxed">{h.description}</p>}
                <Attachments files={h.attachments} />
                {h.postedBy && <div className="text-xs text-faint mt-2">Posted by {h.postedBy}</div>}
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Attachments({ files }: { files: Attachment[] }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {files.map((f) =>
        f.contentType.startsWith('image/') && f.url ? (
          <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="block">
            <img src={f.url} alt={f.fileName} className="h-24 w-24 object-cover rounded-md border border-line hover:opacity-90" />
          </a>
        ) : (
          <a
            key={f.id}
            href={f.url ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-md border border-line text-sm hover:bg-hover max-w-[220px]"
          >
            <FileText className="size-4 text-tag-red-ink shrink-0" />
            <span className="truncate">{f.fileName}</span>
          </a>
        ),
      )}
    </div>
  );
}

// ───────── Post / edit form ─────────

function HomeworkForm({
  hw,
  options,
  defaultSection,
  onClose,
}: {
  hw: Homework | null;
  options: SectionOption[];
  defaultSection: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const f = useZodForm(homeworkSchema, {
    sectionId: hw?.sectionId ?? (defaultSection || (options.length === 1 ? options[0].id : '')),
    subjectId: hw?.subject?.id ?? '',
    title: hw?.title ?? '',
    description: hw?.description ?? '',
    assignedDate: hw?.assignedDate ?? todayStr(),
    dueDate: hw?.dueDate ?? '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const section = options.find((s) => s.id === f.values.sectionId);
  const kept = (hw?.attachments ?? []).filter((a) => !removeIds.includes(a.id));
  const room = HOMEWORK_MAX_FILES - kept.length - files.length;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list].slice(0, Math.max(0, room));
    if (list.length > picked.length) toast.error(`At most ${HOMEWORK_MAX_FILES} files`);
    setFiles((x) => [...x, ...picked]);
  };

  const save = useMutation({
    mutationFn: async (data: object) => {
      const fd = new FormData();
      fd.append('data', JSON.stringify(hw ? { ...data, removeAttachmentIds: removeIds } : data));
      files.forEach((file) => fd.append('files', file));
      return hw ? api.put(`/homework/${hw.id}`, fd) : api.post('/homework', fd);
    },
    onSuccess: () => {
      toast.success(hw ? 'Homework updated' : 'Homework posted');
      qc.invalidateQueries({ queryKey: ['homework'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={hw ? 'Edit homework' : 'Post homework'}
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
            {hw ? 'Save' : 'Post'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Class *" error={f.errors.sectionId}>
            <Select {...f.bind('sectionId')} onChange={(e) => (f.set('sectionId', e.target.value), f.set('subjectId', ''))}>
              <option value="">Select…</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subject" error={f.errors.subjectId}>
            <Select {...f.bind('subjectId')} disabled={!section}>
              <option value="">General</option>
              {section?.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.mine ? ' ★' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Title *" error={f.errors.title}>
          <Input {...f.bind('title')} placeholder="e.g. Learn table of 12" autoFocus={!hw} />
        </Field>
        <Field label="Details" error={f.errors.description}>
          <Textarea {...f.bind('description')} rows={4} placeholder="Page numbers, questions, instructions…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Given on" error={f.errors.assignedDate}>
            <Input type="date" {...f.bind('assignedDate')} />
          </Field>
          <Field label="Submit by" error={f.errors.dueDate}>
            <Input type="date" {...f.bind('dueDate')} min={String(f.values.assignedDate ?? '')} />
          </Field>
        </div>

        <div>
          <div className="text-[13px] font-medium text-muted mb-1.5">Photos / PDF ({HOMEWORK_MAX_FILES} max)</div>
          <div className="flex flex-wrap gap-2">
            {kept.map((a) => (
              <FileChip key={a.id} name={a.fileName} onRemove={() => setRemoveIds((x) => [...x, a.id])} />
            ))}
            {files.map((file, i) => (
              <FileChip key={i} name={file.name} onRemove={() => setFiles((x) => x.filter((_, j) => j !== i))} />
            ))}
          </div>
          {room > 0 && (
            <div className="flex gap-2 mt-2">
              <Button type="button" size="sm" icon={<Paperclip className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                Attach file
              </Button>
              <Button type="button" size="sm" icon={<Camera className="size-3.5" />} onClick={() => cameraRef.current?.click()}>
                Take photo
              </Button>
            </div>
          )}
          <input ref={fileRef} type="file" hidden multiple accept="image/*,application/pdf" onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
          <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
        </div>
      </div>
    </Modal>
  );
}

function FileChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className={cn('inline-flex items-center gap-1 pl-2 pr-1 h-7 rounded-md bg-tag-gray text-sm max-w-[200px]')}>
      <span className="truncate">{name}</span>
      <button type="button" onClick={onRemove} className="p-0.5 rounded hover:bg-hover" aria-label="Remove">
        <X className="size-3.5" />
      </button>
    </span>
  );
}
