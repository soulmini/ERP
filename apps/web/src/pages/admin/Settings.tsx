import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { schoolSchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useZodForm } from '../../lib/form';
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader } from '../../components/ui';

const FIELDS: { name: string; label: string; wide?: boolean }[] = [
  { name: 'name', label: 'School name *', wide: true },
  { name: 'code', label: 'School code / UDISE' },
  { name: 'affiliation', label: 'Affiliation / board' },
  { name: 'principalName', label: 'Principal name' },
  { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email' },
  { name: 'website', label: 'Website' },
  { name: 'address', label: 'Address', wide: true },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State' },
  { name: 'pincode', label: 'PIN code' },
];

export function SettingsPage() {
  const { refreshMe } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['school'],
    queryFn: async () => (await api.get<Record<string, string | null>>('/school')).data,
  });
  const f = useZodForm(schoolSchema, {});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.data) f.setValues(Object.fromEntries(FIELDS.map((x) => [x.name, q.data![x.name] ?? ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const save = useMutation({
    mutationFn: (data: unknown) => api.put('/school', data),
    onSuccess: () => {
      toast.success('School details saved');
      qc.invalidateQueries({ queryKey: ['school'] });
      refreshMe();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/school/logo', fd);
    },
    onSuccess: () => {
      toast.success('Logo updated');
      qc.invalidateQueries({ queryKey: ['school'] });
      refreshMe();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;

  return (
    <>
      <PageHeader icon="🏫" title="School settings" description="These details appear on receipts, certificates, I-cards and marksheets." />
      <Card className="p-5 mb-4 flex items-center gap-4">
        {q.data!.logoUrl ? (
          <img src={q.data!.logoUrl} alt="School logo" className="size-16 rounded-lg object-contain border border-line" />
        ) : (
          <div className="size-16 rounded-lg bg-sidebar border border-line flex items-center justify-center text-2xl">🏫</div>
        )}
        <div className="flex-1">
          <div className="font-medium text-ink-strong">School logo</div>
          <div className="text-xs text-muted">PNG, JPG or WEBP, up to 2 MB</div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
        />
        <Button icon={<Upload className="size-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>
          Upload
        </Button>
      </Card>
      <Card className="p-5">
        <div className="grid sm:grid-cols-2 gap-3">
          {FIELDS.map((x) => (
            <Field key={x.name} label={x.label} error={f.errors[x.name]} className={x.wide ? 'sm:col-span-2' : ''}>
              <Input {...f.bind(x.name)} />
            </Field>
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              const d = f.validate();
              if (d) save.mutate(d);
            }}
          >
            Save changes
          </Button>
        </div>
      </Card>
    </>
  );
}
