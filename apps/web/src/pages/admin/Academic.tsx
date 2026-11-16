import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { staffName, useClasses, useStaff, type ClassRow } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Tag } from '../../components/ui';
import { cn, fmtDate } from '../../lib/utils';

export function AcademicPage() {
  const [tab, setTab] = useState<'classes' | 'subjects' | 'sessions'>('classes');
  return (
    <>
      <PageHeader icon="📚" title="Classes & subjects" description="Set up classes, sections, class teachers, subjects and academic sessions." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'classes', label: 'Classes & sections' },
          { value: 'subjects', label: 'Subjects' },
          { value: 'sessions', label: 'Sessions' },
        ]}
      />
      {tab === 'classes' && <ClassesTab />}
      {tab === 'subjects' && <SubjectsTab />}
      {tab === 'sessions' && <SessionsTab />}
    </>
  );
}

function useInvalidate(...keys: string[]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

// ───────── Classes ─────────

function ClassesTab() {
  const classes = useClasses();
  const staff = useStaff();
  const refresh = useInvalidate('classes', 'staff', 'attendance-sections');
  const [addClass, setAddClass] = useState(false);
  const [subjectsFor, setSubjectsFor] = useState<ClassRow | null>(null);

  const updateSection = useMutation({
    mutationFn: ({ id, classTeacherId }: { id: string; classTeacherId: string | null }) => api.put(`/academic/sections/${id}`, { classTeacherId }),
    onSuccess: () => (toast.success('Class teacher updated'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const addSection = useMutation({
    mutationFn: ({ classId, name }: { classId: string; name: string }) => api.post(`/academic/classes/${classId}/sections`, { name }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const delSection = useMutation({
    mutationFn: (id: string) => api.delete(`/academic/sections/${id}`),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (classes.isLoading) return <Loading />;
  if (classes.error) return <ErrorBox error={classes.error} />;
  const teachers = (staff.data ?? []).filter((s) => s.isActive);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAddClass(true)}>
          Add class
        </Button>
      </div>
      <div className="space-y-3">
        {classes.data!.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="font-semibold text-ink-strong text-[15px]">Class {c.name}</span>
              <button onClick={() => setSubjectsFor(c)} className="text-xs text-muted hover:text-ink hover:underline">
                {c.subjects.length} subjects
              </button>
              <button
                className="ml-auto text-xs text-muted hover:text-ink inline-flex items-center gap-1"
                onClick={() => {
                  const next = String.fromCharCode(65 + c.sections.length);
                  addSection.mutate({ classId: c.id, name: next });
                }}
              >
                <Plus className="size-3" /> Section
              </button>
            </div>
            <div className="space-y-1.5">
              {c.sections.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Tag color="blue" className="min-w-12 justify-center">
                    {c.name}-{s.name}
                  </Tag>
                  <span className="text-muted w-20">{s.studentCount} students</span>
                  <Select
                    className="flex-1 min-w-44 max-w-xs !h-8"
                    value={s.classTeacherId ?? ''}
                    onChange={(e) => updateSection.mutate({ id: s.id, classTeacherId: e.target.value || null })}
                  >
                    <option value="">No class teacher</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {staffName(t)} ({t.designation})
                      </option>
                    ))}
                  </Select>
                  {c.sections.length > 1 && s.studentCount === 0 && (
                    <button onClick={() => delSection.mutate(s.id)} className="p-1.5 rounded hover:bg-hover text-faint" title="Delete section">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      {addClass && <AddClassModal nextOrder={classes.data!.length} onClose={() => setAddClass(false)} onDone={refresh} />}
      {subjectsFor && <ClassSubjectsModal cls={subjectsFor} onClose={() => setSubjectsFor(null)} onDone={refresh} />}
    </>
  );
}

function AddClassModal({ nextOrder, onClose, onDone }: { nextOrder: number; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [sections, setSections] = useState('A');
  const save = useMutation({
    mutationFn: () =>
      api.post('/academic/classes', {
        name,
        order: nextOrder,
        sections: sections.split(',').map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: () => (onDone(), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add class"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <Field label="Class name" hint="e.g. 9, X, Nursery">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Sections" hint="Comma separated, e.g. A, B">
          <Input value={sections} onChange={(e) => setSections(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ClassSubjectsModal({ cls, onClose, onDone }: { cls: ClassRow; onClose: () => void; onDone: () => void }) {
  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>('/academic/subjects')).data,
  });
  const [ids, setIds] = useState(cls.subjects.map((s) => s.id));
  const save = useMutation({
    mutationFn: () => api.put(`/academic/classes/${cls.id}/subjects`, { subjectIds: ids }),
    onSuccess: () => (onDone(), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Subjects · Class ${cls.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-2 pb-2">
        {(subjects.data ?? []).map((s) => {
          const on = ids.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() => setIds(on ? ids.filter((x) => x !== s.id) : [...ids, s.id])}
              className={cn('px-3 h-8 rounded-md border text-sm', on ? 'bg-ink-strong text-white border-ink-strong' : 'border-line hover:bg-hover')}
            >
              {s.name}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

// ───────── Subjects ─────────

function SubjectsTab() {
  const refresh = useInvalidate('subjects', 'classes');
  const q = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => (await api.get<{ id: string; name: string; code: string | null; type: string }[]>('/academic/subjects')).data,
  });
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/academic/subjects', { name }),
    onSuccess: () => (setName(''), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/academic/subjects/${id}`),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  return (
    <>
      <form
        className="flex gap-2 mb-3 max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New subject name" />
        <Button variant="primary" type="submit" loading={add.isPending}>
          Add
        </Button>
      </form>
      <Card className="divide-y divide-line max-w-md">
        {q.data!.map((s) => (
          <div key={s.id} className="flex items-center px-4 py-2 text-sm">
            <span className="flex-1">{s.name}</span>
            {s.type === 'CO_SCHOLASTIC' && <Tag className="mr-2">Co-scholastic</Tag>}
            <button onClick={() => del.mutate(s.id)} className="p-1 rounded hover:bg-hover text-faint" title="Delete">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </Card>
    </>
  );
}

// ───────── Sessions ─────────

function SessionsTab() {
  const refresh = useInvalidate('sessions', 'dashboard', 'classes');
  const q = useQuery({
    queryKey: ['sessions'],
    queryFn: async () =>
      (await api.get<{ id: string; name: string; startDate: string; endDate: string; isCurrent: boolean }[]>('/academic/sessions')).data,
  });
  const [open, setOpen] = useState(false);
  const setCurrent = useMutation({
    mutationFn: (id: string) => api.post(`/academic/sessions/${id}/current`),
    onSuccess: () => (toast.success('Current session changed'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  return (
    <>
      <div className="flex justify-end mb-3">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          New session
        </Button>
      </div>
      <Card className="divide-y divide-line max-w-xl">
        {q.data!.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <div className="font-medium text-ink-strong">{s.name}</div>
              <div className="text-xs text-muted">
                {fmtDate(s.startDate)} – {fmtDate(s.endDate)}
              </div>
            </div>
            {s.isCurrent ? (
              <Tag color="green">Current</Tag>
            ) : (
              <Button size="sm" onClick={() => setCurrent.mutate(s.id)}>
                Make current
              </Button>
            )}
          </div>
        ))}
      </Card>
      {open && <NewSessionModal onClose={() => setOpen(false)} onDone={refresh} />}
    </>
  );
}

function NewSessionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const y = new Date().getFullYear() + 1;
  const [v, setV] = useState({ name: `${y}-${String(y + 1).slice(2)}`, startDate: `${y}-04-01`, endDate: `${y + 1}-03-31` });
  const save = useMutation({
    mutationFn: () => api.post('/academic/sessions', v),
    onSuccess: () => (onDone(), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New academic session"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-2">
        <Field label="Name">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Starts">
          <Input type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
        </Field>
        <Field label="Ends">
          <Input type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
        </Field>
      </div>
      <p className="text-xs text-muted pb-2">Student promotion to the new session arrives with the Admissions module.</p>
    </Modal>
  );
}
