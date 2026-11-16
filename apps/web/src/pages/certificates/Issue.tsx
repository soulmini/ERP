import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { CERT_DATA_SCHEMAS, CERT_META, certTypeFromSlug, classInWords, dateInWords, type CertType } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Tag, Textarea } from '../../components/ui';
import { fmtDate } from '../../lib/utils';
import { zodErrors } from '../accounts/zod';
import { StudentSearch, type FoundStudent } from './StudentSearch';

type FieldDef = { key: string; label: string; kind?: 'date' | 'textarea' | 'gender'; wide?: boolean; hint?: string };

const COMMON: FieldDef[] = [
  { key: 'studentName', label: 'Student name' },
  { key: 'gender', label: 'Gender', kind: 'gender' },
  { key: 'fatherName', label: "Father's name" },
  { key: 'motherName', label: "Mother's name" },
  { key: 'admissionNo', label: 'Admission no.' },
  { key: 'srNo', label: 'SR (scholar register) no.' },
  { key: 'className', label: 'Class' },
  { key: 'session', label: 'Session' },
  { key: 'dob', label: 'Date of birth', kind: 'date' },
  { key: 'dobWords', label: 'Date of birth in words', wide: true },
];

const EXTRA: Record<CertType, FieldDef[]> = {
  TC: [
    { key: 'penNo', label: 'PEN (UDISE+)' },
    { key: 'nationality', label: 'Nationality' },
    { key: 'category', label: 'Category (SC/ST/OBC/GEN)' },
    { key: 'admissionDate', label: 'Date of first admission', kind: 'date' },
    { key: 'admissionClass', label: 'Class at first admission' },
    { key: 'lastClass', label: 'Class last studied (figures)' },
    { key: 'lastClassWords', label: 'Class last studied (words)' },
    { key: 'lastExam', label: 'Last exam taken & result', wide: true },
    { key: 'failedInClass', label: 'Whether failed (once/twice)' },
    { key: 'qualifiedForPromotion', label: 'Qualified for promotion?' },
    { key: 'subjects', label: 'Subjects studied', kind: 'textarea', wide: true },
    { key: 'feesPaidUpTo', label: 'Fees paid up to (month)' },
    { key: 'feeConcession', label: 'Fee concession, if any' },
    { key: 'workingDays', label: 'Total working days' },
    { key: 'presentDays', label: 'Days present' },
    { key: 'nccScoutGuide', label: 'NCC / Scout / Guide' },
    { key: 'gamesActivities', label: 'Games / activities' },
    { key: 'conduct', label: 'General conduct' },
    { key: 'applicationDate', label: 'Date of application', kind: 'date' },
    { key: 'leavingReason', label: 'Reason for leaving', wide: true },
  ],
  CC: [
    { key: 'studiedFrom', label: 'Studied from', kind: 'date' },
    { key: 'studiedTo', label: 'Studied till', kind: 'date' },
    { key: 'conduct', label: 'Conduct & character' },
  ],
  DOB: [{ key: 'purpose', label: 'Purpose (optional)', hint: 'e.g. Aadhaar enrolment', wide: true }],
  BONAFIDE: [{ key: 'purpose', label: 'Purpose', hint: 'e.g. opening a bank account, scholarship', wide: true }],
};

interface Prefill {
  student: { id: string; name: string; admissionNo: string; status: string; classLabel: string | null };
  alreadyIssued: { id: string; serialNo: string; issueDate: string }[];
  data: Record<string, string>;
}

export function IssuePage() {
  const { slug } = useParams();
  const type = certTypeFromSlug(slug);
  const [student, setStudent] = useState<FoundStudent | null>(null);
  if (!type) return <Empty title="Unknown certificate" />;
  const meta = CERT_META[type];
  return (
    <>
      <Link to="/certificates" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Certificates
      </Link>
      <PageHeader icon={meta.icon} title={meta.title} description={meta.description} />
      {!student ? (
        <Card className="p-4 max-w-xl">
          <div className="text-sm font-medium text-ink-strong mb-2">Select student</div>
          <StudentSearch onPick={setStudent} activeOnly={type === 'BONAFIDE'} />
        </Card>
      ) : (
        <IssueForm type={type} studentId={student.id} onChangeStudent={() => setStudent(null)} />
      )}
    </>
  );
}

function IssueForm({ type, studentId, onChangeStudent }: { type: CertType; studentId: string; onChangeStudent: () => void }) {
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['cert-prefill', type, studentId],
    queryFn: async () => (await api.get<Prefill>(`/certificates/prefill/${type}/${studentId}`)).data,
    refetchOnWindowFocus: false,
  });
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmLeft, setConfirmLeft] = useState(false);
  const v = values ?? q.data?.data ?? {};

  const issue = useMutation({
    mutationFn: async (body: object) => (await api.post<{ id: string; serialNo: string }>('/certificates', body)).data,
    onSuccess: (d) => {
      toast.success(`Issued ${d.serialNo}`);
      nav(`/certificates/view/${d.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const p = q.data!;

  const set = (k: string, val: string) => {
    const next = { ...v, [k]: val };
    if (k === 'dob') next.dobWords = dateInWords(val);
    if (k === 'lastClass') next.lastClassWords = classInWords(val);
    setValues(next);
  };
  const validate = () => {
    const r = zodErrors(CERT_DATA_SCHEMAS[type], v);
    setErrors(r.errors);
    if (!r.data) toast.error('Please check the highlighted fields');
    return r.data;
  };
  const submit = () => {
    const data = validate();
    if (!data) return;
    if (type === 'TC' && p.student.status === 'ACTIVE') return setConfirmLeft(true);
    issue.mutate({ studentId, type, data });
  };

  const field = (f: FieldDef) => (
    <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]} className={f.wide ? 'sm:col-span-2' : ''}>
      {f.kind === 'gender' ? (
        <Select value={v[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
          <option value="OTHER">Other</option>
        </Select>
      ) : f.kind === 'textarea' ? (
        <Textarea rows={2} value={v[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
      ) : (
        <Input type={f.kind === 'date' ? 'date' : 'text'} value={v[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
      )}
    </Field>
  );

  return (
    <>
      <Card className="p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-ink-strong">{p.student.name}</div>
          <div className="text-xs text-muted">
            {p.student.admissionNo}
            {p.student.classLabel && ` · Class ${p.student.classLabel}`}
          </div>
        </div>
        {p.student.status !== 'ACTIVE' && <Tag>{p.student.status === 'LEFT' ? 'Left school' : 'Passed out'}</Tag>}
        <Button size="sm" onClick={onChangeStudent}>
          Change student
        </Button>
      </Card>
      {p.alreadyIssued.length > 0 && (
        <div className="rounded-md bg-tag-yellow text-tag-yellow-ink px-3 py-2 text-sm mb-4">
          Already issued:{' '}
          {p.alreadyIssued.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ', '}
              <Link className="underline" to={`/certificates/view/${c.id}?duplicate=1`}>
                {c.serialNo}
              </Link>{' '}
              ({fmtDate(c.issueDate)})
            </span>
          ))}
          . Open it to print a duplicate instead of issuing a new one.
        </div>
      )}
      <Card className="p-5">
        <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-3">Student details</div>
        <div className="grid sm:grid-cols-2 gap-3">{COMMON.map(field)}</div>
        <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mt-6 mb-3">Certificate details</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {EXTRA[type].map(field)}
          {field({ key: 'issueDate', label: 'Date of issue', kind: 'date' })}
          {field({ key: 'remarks', label: 'Remarks (optional)', kind: 'textarea', wide: true })}
        </div>
        <div className="flex justify-end mt-5">
          <Button variant="primary" size="lg" loading={issue.isPending} onClick={submit}>
            Issue & print
          </Button>
        </div>
      </Card>
      <Modal
        open={confirmLeft}
        onClose={() => setConfirmLeft(false)}
        title="Issue Transfer Certificate?"
        footer={
          <>
            <Button onClick={() => setConfirmLeft(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={issue.isPending}
              onClick={() => {
                const data = validate();
                if (data) issue.mutate({ studentId, type, data, confirmLeft: true });
              }}
            >
              Yes, issue TC
            </Button>
          </>
        }
      >
        <p className="text-sm pb-2">
          <b>{p.student.name}</b> will be marked as <b>left the school</b> from {fmtDate(v.issueDate ?? '')}. They will no longer appear in class lists or
          attendance. You can undo this by cancelling the TC.
        </p>
      </Modal>
    </>
  );
}
