import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useRoles, type RoleRow } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Tag } from '../../components/ui';
import { cn } from '../../lib/utils';

type Groups = Record<string, Record<string, string>>;

export function RolesPage() {
  const roles = useRoles();
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  return (
    <>
      <PageHeader
        icon="🔐"
        title="Roles & permissions"
        description="Create roles like Accountant or Receptionist and choose exactly what they can do."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New role
          </Button>
        }
      />
      {roles.isLoading ? (
        <Loading />
      ) : roles.error ? (
        <ErrorBox error={roles.error} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {roles.data!.map((r) => (
            <Card
              key={r.id}
              className="p-4 hover:bg-[#fafaf9] cursor-pointer transition-colors"
              onClick={() => r.kind !== 'PRINCIPAL' && r.kind !== 'PARENT' && setEditing(r)}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink-strong">{r.name}</span>
                {r.isSystem && <Tag>Built-in</Tag>}
                <span className="ml-auto text-xs text-muted">{r.userCount} users</span>
              </div>
              <div className="text-sm text-muted mt-1">{r.description}</div>
              <div className="text-xs text-faint mt-2 flex items-center gap-1">
                {r.kind === 'PRINCIPAL' ? (
                  <>
                    <Lock className="size-3" /> Full access to everything
                  </>
                ) : r.kind === 'PARENT' ? (
                  <>
                    <Lock className="size-3" /> Sees only their own children
                  </>
                ) : (
                  `${r.permissions.length} permissions`
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <RoleModal role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RoleModal({ role, onClose }: { role: RoleRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['permissions'], queryFn: async () => (await api.get<Groups>('/users/permissions')).data });
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const done = () => {
    qc.invalidateQueries({ queryKey: ['roles'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, permissions: perms };
      return role ? api.put(`/users/roles/${role.id}`, body) : api.post('/users/roles', body);
    },
    onSuccess: () => (toast.success('Role saved. Users get new permissions on next login.'), done()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/users/roles/${role!.id}`),
    onSuccess: () => (toast.success('Role deleted'), done()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = (p: string) => setPerms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={role ? `Edit role · ${role.name}` : 'New role'}
      footer={
        <>
          {role && !role.isSystem && (
            <Button variant="danger" icon={<Trash2 className="size-4" />} loading={del.isPending} onClick={() => del.mutate()} className="mr-auto">
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
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <Field label="Role name">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={role?.isSystem} placeholder="e.g. Accountant" />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={role?.isSystem} />
        </Field>
      </div>
      {groups.isLoading ? (
        <Loading />
      ) : (
        <div className="space-y-4 pb-2">
          {Object.entries(groups.data ?? {}).map(([group, items]) => (
            <div key={group}>
              <div className="text-[13px] font-semibold text-muted mb-1.5">{group}</div>
              <div className="grid sm:grid-cols-2 gap-1.5">
                {Object.entries(items).map(([key, label]) => (
                  <label
                    key={key}
                    className={cn(
                      'flex items-start gap-2 px-2.5 py-2 rounded-md border cursor-pointer text-sm transition-colors',
                      perms.includes(key) ? 'border-[#2383e2]/40 bg-tag-blue/60' : 'border-line hover:bg-hover',
                    )}
                  >
                    <input type="checkbox" className="mt-0.5 accent-[#2383e2]" checked={perms.includes(key)} onChange={() => toggle(key)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
