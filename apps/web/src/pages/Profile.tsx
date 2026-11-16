import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogOut } from 'lucide-react';
import { changePasswordSchema } from '@erp/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useZodForm } from '../lib/form';
import { Avatar, Button, Card, Field, Input, PageHeader, SectionTitle, Tag } from '../components/ui';

export function ProfilePage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const f = useZodForm(changePasswordSchema, { currentPassword: '', newPassword: '' });
  const save = useMutation({
    mutationFn: (d: unknown) => api.post('/auth/change-password', d),
    onSuccess: () => (toast.success('Password changed'), f.reset()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!user) return null;

  return (
    <>
      <PageHeader icon="🙂" title="My account" />
      <Card className="p-5 flex items-center gap-4 max-w-lg">
        <Avatar name={user.name} size={52} />
        <div>
          <div className="text-lg font-semibold text-ink-strong">{user.name}</div>
          <div className="text-sm text-muted">{[user.phone, user.email].filter(Boolean).join(' · ')}</div>
          <div className="flex gap-1 mt-1.5">
            {user.kinds.map((k) => (
              <Tag key={k} color={k === 'PRINCIPAL' ? 'purple' : k === 'TEACHER' ? 'blue' : 'gray'}>
                {k.charAt(0) + k.slice(1).toLowerCase()}
              </Tag>
            ))}
          </div>
        </div>
      </Card>

      <SectionTitle>Change password</SectionTitle>
      <Card className="p-5 max-w-lg space-y-3">
        <Field label="Current password" error={f.errors.currentPassword}>
          <Input type="password" {...f.bind('currentPassword')} autoComplete="current-password" />
        </Field>
        <Field label="New password" error={f.errors.newPassword}>
          <Input type="password" {...f.bind('newPassword')} autoComplete="new-password" />
        </Field>
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() => {
            const d = f.validate();
            if (d) save.mutate(d);
          }}
        >
          Update password
        </Button>
      </Card>

      <div className="mt-8">
        <Button variant="danger" icon={<LogOut className="size-4" />} onClick={() => logout().then(() => nav('/login'))}>
          Log out
        </Button>
      </div>
    </>
  );
}
