import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Pencil, Plus, Power } from 'lucide-react';
import { staffUserSchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { staffName, useRoles, useStaff, type StaffRow } from '../../lib/queries';
import { useZodForm } from '../../lib/form';
import { Avatar, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tag } from '../../components/ui';
import { cn, fmtDate } from '../../lib/utils';

export function StaffPage() {
  const { can } = useAuth();
  const staff = useStaff();
  const [editing, setEditing] = useState<StaffRow | 'new' | null>(null);
  const [resetFor, setResetFor] = useState<StaffRow | null>(null);
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (id: string) => api.post(`/users/staff/${id}/toggle-active`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const manage = can('users.manage');

  return (
    <>
      <PageHeader
        icon="👥"
        title="Staff & users"
        description="Everyone who works at the school. Each person logs in with their mobile number."
        actions={
          manage && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add staff
            </Button>
          )
        }
      />
      {staff.isLoading ? (
        <Loading />
      ) : staff.error ? (
        <ErrorBox error={staff.error} />
      ) : !staff.data!.length ? (
        <Empty title="No staff yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Class teacher</th>
              <th>Mobile</th>
              <th>Last login</th>
              {manage && <th />}
            </tr>
          </thead>
          <tbody>
            {staff.data!.map((s) => (
              <tr key={s.id} className={cn(!s.isActive && 'opacity-50')}>
                <td>
                  <div className="flex items-center gap-2">
                    <Avatar name={staffName(s)} size={26} />
                    <div>
                      <div className="font-medium text-ink-strong">{staffName(s)}</div>
                      <div className="text-xs text-muted">
                        {s.designation} · {s.employeeCode}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {s.roles.map((r) => (
                      <Tag key={r.id} color={r.kind === 'PRINCIPAL' ? 'purple' : r.kind === 'TEACHER' ? 'blue' : 'brown'}>
                        {r.name}
                      </Tag>
                    ))}
                    {!s.isActive && <Tag color="red">Disabled</Tag>}
                  </div>
                </td>
                <td>{s.classTeacherOf.length ? s.classTeacherOf.map((c) => c.label).join(', ') : <span className="text-faint">—</span>}</td>
                <td className="text-muted">{s.phone}</td>
                <td className="text-muted text-xs">{s.user?.lastLoginAt ? fmtDate(s.user.lastLoginAt) : 'Never'}</td>
                {manage && (
                  <td>
                    <div className="flex justify-end gap-0.5">
                      <IconBtn title="Edit" onClick={() => setEditing(s)}>
                        <Pencil className="size-3.5" />
                      </IconBtn>
                      <IconBtn title="Reset password" onClick={() => setResetFor(s)}>
                        <KeyRound className="size-3.5" />
                      </IconBtn>
                      <IconBtn title={s.isActive ? 'Disable login' : 'Enable login'} onClick={() => toggle.mutate(s.id)}>
                        <Power className="size-3.5" />
                      </IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <StaffModal staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {resetFor && <ResetPasswordModal staff={resetFor} onClose={() => setResetFor(null)} />}
    </>
  );
}

const IconBtn = (p: { title: string; onClick: () => void; children: React.ReactNode }) => (
  <button title={p.title} onClick={p.onClick} className="p-1.5 rounded hover:bg-hover text-muted">
    {p.children}
  </button>
);

function StaffModal({ staff, onClose }: { staff: StaffRow | null; onClose: () => void }) {
  const roles = useRoles();
  const qc = useQueryClient();
  const f = useZodForm(staffUserSchema, {
    firstName: staff?.firstName ?? '',
    lastName: staff?.lastName ?? '',
    phone: staff?.phone ?? '',
    email: staff?.email ?? '',
    designation: staff?.designation ?? 'Teacher',
    gender: staff?.gender ?? 'FEMALE',
    joiningDate: staff?.joiningDate?.slice(0, 10) ?? '',
    roleIds: staff?.roles.filter((r) => r.kind !== 'PARENT').map((r) => r.id) ?? [],
  });
  const roleIds = (f.values.roleIds as string[]) ?? [];
  const save = useMutation({
    mutationFn: async (data: unknown) =>
      staff ? (await api.put(`/users/staff/${staff.id}`, data)).data : (await api.post('/users/staff', data)).data,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      toast.success(staff ? 'Saved' : `Staff added.${d.initialPassword ? ` Initial password: ${d.initialPassword}` : ''}`, { duration: 8000 });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const assignable = (roles.data ?? []).filter((r) => r.kind !== 'PARENT' && (r.kind !== 'PRINCIPAL' || roleIds.includes(r.id)));

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={staff ? 'Edit staff' : 'Add staff'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              const d = f.validate();
              if (d) save.mutate({ ...d, joiningDate: f.values.joiningDate || undefined });
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="First name *" error={f.errors.firstName}>
          <Input {...f.bind('firstName')} autoFocus />
        </Field>
        <Field label="Last name" error={f.errors.lastName}>
          <Input {...f.bind('lastName')} />
        </Field>
        <Field label="Mobile * (login)" error={f.errors.phone}>
          <Input {...f.bind('phone')} inputMode="numeric" maxLength={10} />
        </Field>
        <Field label="Email" error={f.errors.email}>
          <Input {...f.bind('email')} type="email" />
        </Field>
        <Field label="Designation *" error={f.errors.designation}>
          <Input {...f.bind('designation')} placeholder="Teacher, Accountant…" />
        </Field>
        <Field label="Gender" error={f.errors.gender}>
          <Select {...f.bind('gender')}>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Joining date" error={f.errors.joiningDate}>
          <Input type="date" {...f.bind('joiningDate')} />
        </Field>
      </div>
      <div className="mt-4 mb-1 text-[13px] font-medium text-muted">Roles *</div>
      <div className="flex flex-wrap gap-2 pb-2">
        {assignable.map((r) => {
          const on = roleIds.includes(r.id);
          return (
            <button
              type="button"
              key={r.id}
              onClick={() => f.set('roleIds', on ? roleIds.filter((x) => x !== r.id) : [...roleIds, r.id])}
              className={cn(
                'px-3 h-8 rounded-md border text-sm transition-colors',
                on ? 'bg-ink-strong text-white border-ink-strong' : 'bg-white border-line hover:bg-hover',
              )}
            >
              {r.name}
            </button>
          );
        })}
      </div>
      {f.errors.roleIds && <div className="text-xs text-tag-red-ink">{f.errors.roleIds}</div>}
      {!staff && <p className="text-xs text-muted mt-2">Initial password will be their mobile number.</p>}
    </Modal>
  );
}

function ResetPasswordModal({ staff, onClose }: { staff: StaffRow; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/users/staff/${staff.id}/reset-password`, { password }),
    onSuccess: () => (toast.success('Password reset. They have been logged out of all devices.'), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password · ${staffName(staff)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={password.length < 6} loading={save.isPending} onClick={() => save.mutate()}>
            Reset
          </Button>
        </>
      }
    >
      <Card className="p-0 border-0">
        <Field label="New password" hint="At least 6 characters">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
      </Card>
    </Modal>
  );
}
