import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { studentQuickSchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { downloadCsv, todayStr } from '../../lib/utils';

async function exportStudents(sectionId: string) {
  try {
    const { data } = await api.get<Record<string, string | number | null>[]>('/students/export', { params: { sectionId: sectionId || undefined } });
    const cols = ['admissionNo', 'srNo', 'name', 'class', 'section', 'rollNo', 'gender', 'dob', 'category', 'aadhaarNo', 'fatherName', 'motherName', 'phone', 'address', 'admissionDate'];
    downloadCsv(`students-${todayStr()}.csv`, [cols, ...data.map((r) => cols.map((c) => r[c]))]);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
import { useAuth } from '../../lib/auth';
import { sectionOptions, useClasses } from '../../lib/queries';
import { useZodForm } from '../../lib/form';
import { Avatar, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tag } from '../../components/ui';
import { fmtDate } from '../../lib/utils';

interface StudentList {
  total: number;
  page: number;
  pageSize: number;
  items: {
    id: string;
    admissionNo: string;
    name: string;
    gender: string;
    dob: string;
    photoUrl: string | null;
    classLabel: string | null;
    rollNo: number | null;
    guardian: { name: string; phone: string; relation: string } | null;
  }[];
}

export function StudentsPage() {
  const { can, user } = useAuth();
  const classes = useClasses();
  const [sectionId, setSectionId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const q = useQuery({
    queryKey: ['students', sectionId, search, page],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<StudentList>('/students', { params: { sectionId: sectionId || undefined, search: search || undefined, page } })).data,
  });
  const options = sectionOptions(classes.data);
  const pages = q.data ? Math.ceil(q.data.total / q.data.pageSize) : 1;

  return (
    <>
      <PageHeader
        icon="🎒"
        title={user?.view === 'teacher' ? 'Students' : 'Students'}
        description={q.data ? `${q.data.total} students in current session` : undefined}
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => exportStudents(sectionId)}>
              Export
            </Button>
            {can('students.manage') && (
              <>
                <Link to="/students/import">
                  <Button icon={<Upload className="size-4" />}>Import</Button>
                </Link>
                <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                  Quick add
                </Button>
                <Link to="/admissions/new">
                  <Button variant="primary" icon={<Plus className="size-4" />}>
                    New admission
                  </Button>
                </Link>
              </>
            )}
          </>
        }
      />
      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={sectionId} onChange={(e) => (setSectionId(e.target.value), setPage(1))} className="w-auto min-w-36">
          <option value="">All classes</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              Class {o.label}
            </option>
          ))}
        </Select>
        <div className="relative flex-1 min-w-48">
          <Search className="size-4 text-faint absolute left-2.5 top-2.5" />
          <Input
            placeholder="Search name, admission no. or parent mobile"
            value={search}
            onChange={(e) => (setSearch(e.target.value), setPage(1))}
            className="pl-8"
          />
        </div>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.items.length ? (
        <Empty icon="🎒" title="No students found">
          {can('students.manage') ? 'Click "Add student" to add your first student.' : 'Try another class or search.'}
        </Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Class</th>
                <th>Adm. no.</th>
                <th>Parent</th>
                <th>Date of birth</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Avatar name={s.name} src={s.photoUrl} size={26} />
                      <Link to={`/students/${s.id}`} className="font-medium text-ink-strong hover:underline">
                        {s.name}
                      </Link>
                    </div>
                  </td>
                  <td>
                    {s.classLabel ? <Tag color="blue">{s.classLabel}</Tag> : '—'}
                    {s.rollNo && <span className="text-xs text-muted ml-1.5">Roll {s.rollNo}</span>}
                  </td>
                  <td className="text-muted">{s.admissionNo}</td>
                  <td>
                    {s.guardian ? (
                      <>
                        <div>{s.guardian.name}</div>
                        <a href={`tel:${s.guardian.phone}`} className="text-xs text-muted hover:underline">
                          {s.guardian.phone}
                        </a>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text-muted">{fmtDate(s.dob)}</td>
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
      {adding && <AddStudentModal onClose={() => setAdding(false)} options={options} />}
    </>
  );
}

function AddStudentModal({ onClose, options }: { onClose: () => void; options: { id: string; label: string }[] }) {
  const qc = useQueryClient();
  const f = useZodForm(studentQuickSchema, { gender: 'MALE', guardianRelation: 'FATHER' });
  const [created, setCreated] = useState<{ name: string; parentLogin: { username: string; initialPassword: string } | null } | null>(null);
  const save = useMutation({
    mutationFn: async (data: unknown) => (await api.post('/students', data)).data,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['classes'] });
      setCreated({ name: `${d.firstName} ${d.lastName ?? ''}`.trim(), parentLogin: d.parentLogin });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (created) {
    return (
      <Modal open onClose={onClose} title="Student added" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <p className="mb-3">
          <b>{created.name}</b> has been admitted.
        </p>
        {created.parentLogin ? (
          <Card className="p-3 bg-sidebar text-sm space-y-1">
            <div className="font-medium">Parent app login</div>
            <div>
              Mobile: <b>{created.parentLogin.username}</b>
            </div>
            <div>
              Password: <b>{created.parentLogin.initialPassword}</b> <span className="text-muted">(same as mobile, ask them to change it)</span>
            </div>
          </Card>
        ) : (
          <p className="text-sm text-muted">Linked to the existing parent account (sibling).</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Add student"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => { const d = f.validate(); if (d) save.mutate(d); }}>
            Add student
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted mb-4">Quick admission. The full admission form with documents is coming in the next phase.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="First name *" error={f.errors.firstName}>
          <Input {...f.bind('firstName')} autoFocus />
        </Field>
        <Field label="Last name" error={f.errors.lastName}>
          <Input {...f.bind('lastName')} />
        </Field>
        <Field label="Gender *" error={f.errors.gender}>
          <Select {...f.bind('gender')}>
            <option value="MALE">Boy</option>
            <option value="FEMALE">Girl</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Date of birth *" error={f.errors.dob}>
          <Input type="date" {...f.bind('dob')} />
        </Field>
        <Field label="Class & section *" error={f.errors.sectionId}>
          <Select {...f.bind('sectionId')}>
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                Class {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Roll no." hint="Auto if empty" error={f.errors.rollNo}>
          <Input type="number" {...f.bind('rollNo')} />
        </Field>
        <Field label="Admission no." hint="Auto if empty" error={f.errors.admissionNo}>
          <Input {...f.bind('admissionNo')} />
        </Field>
        <Field label="Address" error={f.errors.address}>
          <Input {...f.bind('address')} />
        </Field>
      </div>
      <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mt-5 mb-2">Parent / guardian</div>
      <div className="grid sm:grid-cols-3 gap-3 pb-2">
        <Field label="Name *" error={f.errors.guardianName}>
          <Input {...f.bind('guardianName')} />
        </Field>
        <Field label="Relation" error={f.errors.guardianRelation}>
          <Select {...f.bind('guardianRelation')}>
            <option value="FATHER">Father</option>
            <option value="MOTHER">Mother</option>
            <option value="GUARDIAN">Guardian</option>
          </Select>
        </Field>
        <Field label="Mobile *" error={f.errors.guardianPhone} hint="Used for parent app login">
          <Input {...f.bind('guardianPhone')} inputMode="numeric" maxLength={10} />
        </Field>
      </div>
    </Modal>
  );
}
