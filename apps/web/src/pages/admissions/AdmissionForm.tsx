import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { admissionSchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { sectionOptions, useClasses } from '../../lib/queries';
import { Button, Card, Field, Input, Modal, PageHeader, Select } from '../../components/ui';
import { todayStr } from '../../lib/utils';
import { zodErrors } from '../accounts/zod';
import { FieldsGrid, GUARDIAN_FIELDS, PROFILE_KEYS, STUDENT_FIELDS, guardianPayload, type Values } from '../students/fields';
import type { Enquiry } from './index';

const emptyGuardian = (relation: string, isPrimary = false): Values & { isPrimary?: string } => ({
  relation,
  name: '',
  phone: '',
  email: '',
  occupation: '',
  qualification: '',
  annualIncome: '',
  aadhaarNo: '',
  address: '',
  isPrimary: isPrimary ? '1' : '',
});

export function AdmissionForm() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const enquiryId = params.get('enquiry');
  const classes = useClasses();
  const options = sectionOptions(classes.data);
  const nextNo = useQuery({ queryKey: ['next-admission-no'], queryFn: async () => (await api.get<{ admissionNo: string }>('/admissions/next-number')).data });
  const enquiry = useQuery({
    queryKey: ['enquiry', enquiryId],
    enabled: !!enquiryId,
    queryFn: async () => (await api.get<Enquiry[]>('/admissions/enquiries')).data.find((e) => e.id === enquiryId) ?? null,
  });
  const [v, setV] = useState<Values>({
    ...Object.fromEntries(PROFILE_KEYS.map((k) => [k, ''])),
    gender: 'MALE',
    nationality: 'Indian',
    state: 'Uttar Pradesh',
    admissionDate: todayStr(),
    sectionId: '',
    rollNo: '',
    admissionNo: '',
  });
  const [guardians, setGuardians] = useState([emptyGuardian('FATHER', true), emptyGuardian('MOTHER')]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ id: string; name: string; admissionNo: string; parentLogin: { username: string; initialPassword: string } | null } | null>(null);
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));

  // Prefill from the enquiry being converted.
  useEffect(() => {
    const e = enquiry.data;
    if (!e) return;
    const [firstName, ...rest] = e.studentName.split(' ');
    const cls = classes.data?.find((c) => c.id === e.classId);
    setV((x) => ({
      ...x,
      firstName,
      lastName: rest.join(' '),
      gender: e.gender ?? x.gender,
      dob: e.dob ?? '',
      address: e.address ?? '',
      email: e.email ?? '',
      sectionId: cls?.sections.length === 1 ? cls.sections[0].id : x.sectionId,
    }));
    setGuardians((g) => [{ ...g[0], name: e.guardianName, phone: e.phone }, ...g.slice(1)]);
  }, [enquiry.data, classes.data]);

  const save = useMutation({
    mutationFn: async (d: object) => (await api.post('/admissions/admit', d)).data,
    onSuccess: (d) => setDone(d),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    const payload = {
      ...v,
      enquiryId: enquiryId ?? '',
      guardians: guardians
        .filter((g) => g.name.trim() || g.isPrimary)
        .map((g) => ({ ...guardianPayload(g), isPrimary: !!g.isPrimary })),
    };
    const r = zodErrors(admissionSchema, payload);
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
    else toast.error(r.errors.guardians ?? 'Please check the highlighted fields');
  };

  return (
    <>
      <Link to="/admissions" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Admissions
      </Link>
      <PageHeader icon="📝" title="New admission" description={enquiry.data ? `From enquiry · ${enquiry.data.studentName}` : 'Fill what you have now — everything can be completed later from the student profile.'} />

      <Card className="p-4 mb-4">
        <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">Admission</div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Class & section *" error={errors.sectionId}>
            <Select value={v.sectionId} onChange={(e) => set('sectionId', e.target.value)}>
              <option value="">Select…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  Class {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Roll no." hint="Next number if empty" error={errors.rollNo}>
            <Input value={v.rollNo} onChange={(e) => set('rollNo', e.target.value)} />
          </Field>
          <Field label="Admission no." hint={nextNo.data ? `Automatic: ${nextNo.data.admissionNo}` : undefined} error={errors.admissionNo}>
            <Input value={v.admissionNo} onChange={(e) => set('admissionNo', e.target.value)} placeholder={nextNo.data?.admissionNo} />
          </Field>
        </div>
      </Card>

      {STUDENT_FIELDS.map((g) => (
        <Card key={g.title} className="p-4 mb-4">
          <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">{g.title}</div>
          <FieldsGrid defs={g.fields} v={v} set={set} errors={errors} />
        </Card>
      ))}

      <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">Parents / guardian</div>
      {guardians.map((g, i) => {
        const gErr = Object.fromEntries(
          Object.entries(errors)
            .filter(([k]) => k.startsWith(`guardians.${i}.`))
            .map(([k, msg]) => [k.split('.')[2], msg]),
        );
        return (
          <Card key={i} className="p-4 mb-3">
            <div className="flex items-center gap-3 mb-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="primary"
                  checked={!!g.isPrimary}
                  onChange={() => setGuardians((gs) => gs.map((x, j) => ({ ...x, isPrimary: j === i ? '1' : '' })))}
                />
                Primary contact — gets the parent app login (mobile = password)
              </label>
              {guardians.length > 1 && (
                <button className="ml-auto p-1.5 rounded hover:bg-hover text-muted" onClick={() => setGuardians((gs) => gs.filter((_, j) => j !== i))} title="Remove">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <FieldsGrid defs={GUARDIAN_FIELDS} v={g} set={(k, val) => setGuardians((gs) => gs.map((x, j) => (j === i ? { ...x, [k]: val } : x)))} errors={gErr} />
          </Card>
        );
      })}
      {guardians.length < 3 && (
        <Button icon={<Plus className="size-4" />} onClick={() => setGuardians((gs) => [...gs, emptyGuardian('GUARDIAN')])}>
          Add guardian
        </Button>
      )}

      <div className="sticky bottom-20 md:bottom-4 mt-6 z-20">
        <div className="rounded-lg bg-white border border-line shadow-pop px-4 py-3 flex items-center gap-3">
          <span className="flex-1 text-sm text-muted">Photo and documents can be added on the next screen.</span>
          <Button variant="primary" size="lg" loading={save.isPending} onClick={submit}>
            Admit student
          </Button>
        </div>
      </div>

      <Modal
        open={!!done}
        onClose={() => nav(`/students/${done!.id}`)}
        title="Admission done 🎉"
        footer={
          <>
            <Button onClick={() => window.location.reload()}>Admit another</Button>
            <Button variant="primary" onClick={() => nav(`/students/${done!.id}`)}>
              Open profile (add photo)
            </Button>
          </>
        }
      >
        {done && (
          <div className="space-y-3 pb-2 text-sm">
            <p>
              <b>{done.name}</b> is admitted with admission no. <b>{done.admissionNo}</b>.
            </p>
            {done.parentLogin ? (
              <Card className="p-3 bg-sidebar">
                <div className="font-medium mb-1">Parent app login</div>
                <div>
                  Mobile: <b>{done.parentLogin.username}</b>
                </div>
                <div>
                  Password: <b>{done.parentLogin.initialPassword}</b> <span className="text-muted">(same as mobile; ask them to change it)</span>
                </div>
              </Card>
            ) : (
              <p className="text-muted">Linked to the existing parent account (brother / sister already studying here).</p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
