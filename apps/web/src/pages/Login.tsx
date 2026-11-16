import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { loginSchema } from '@erp/shared';
import { homePath, useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import { Button, Field, Input } from '../components/ui';
import { useZodForm } from '../lib/form';

export function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const f = useZodForm(loginSchema, { identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homePath(user.view)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const data = f.validate();
    if (!data) return;
    setBusy(true);
    setError('');
    try {
      const me = await login(data.identifier, data.password);
      nav(homePath(me.view), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-5 py-12 bg-white pt-safe">
      <div className="w-full max-w-[340px]">
        <div className="text-5xl mb-5 text-center select-none">🏫</div>
        <h1 className="text-[28px] font-bold tracking-tight text-ink-strong text-center leading-tight">
          Welcome back
        </h1>
        <p className="text-muted text-center mt-1 mb-8">Log in to your school account</p>

        <form onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Mobile number or email" error={f.errors.identifier}>
            <Input {...f.bind('identifier')} autoComplete="username" inputMode="email" placeholder="98xxxxxxxx" autoFocus />
          </Field>
          <Field label="Password" error={f.errors.password}>
            <Input {...f.bind('password')} type="password" autoComplete="current-password" placeholder="••••••••" />
          </Field>
          {error && <div className="rounded-md bg-tag-red text-tag-red-ink px-3 py-2 text-sm">{error}</div>}
          <Button type="submit" variant="primary" size="lg" className="w-full !h-10" loading={busy}>
            Continue
          </Button>
        </form>

        <p className="text-xs text-faint text-center mt-8 leading-relaxed">
          Parents: log in with the mobile number registered with the school.
          <br />
          Forgot password? Contact the school office.
        </p>
      </div>
    </div>
  );
}
