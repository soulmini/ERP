import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Printer } from 'lucide-react';
import { gatePassSchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, PageHeader, Tabs, Tag } from '../../components/ui';
import { Letterhead, PrintSheet, PrintToolbar, Signatures } from '../../components/print';
import { fmtDate, fmtTime, todayStr } from '../../lib/utils';
import { zodErrors } from '../accounts/zod';
import { StudentSearch, type FoundStudent } from './StudentSearch';

interface Pass {
  id: string;
  serialNo: string;
  kind: 'STUDENT' | 'VISITOR';
  student: { name: string; admissionNo: string; classLabel: string | null } | null;
  visitorName: string | null;
  personName: string;
  relation: string | null;
  phone: string | null;
  reason: string;
  outTime: string;
  returnTime: string | null;
}

export function GatePassPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'STUDENT' | 'VISITOR'>('STUDENT');
  const [date, setDate] = useState(todayStr());
  const [student, setStudent] = useState<FoundStudent | null>(null);
  const [v, setV] = useState({ personName: '', relation: '', phone: '', reason: '', visitorName: '', whomToMeet: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const list = useQuery({
    queryKey: ['gate-passes', date],
    queryFn: async () => (await api.get<Pass[]>('/certificates/gate-passes', { params: { date } })).data,
  });
  const issue = useMutation({
    mutationFn: async (d: object) => (await api.post<Pass>('/certificates/gate-passes', d)).data,
    onSuccess: (p) => {
      toast.success(`Gate pass ${p.serialNo} issued`);
      qc.invalidateQueries({ queryKey: ['gate-passes'] });
      nav(`/certificates/gate-pass/${p.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const back = useMutation({
    mutationFn: (id: string) => api.post(`/certificates/gate-passes/${id}/return`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gate-passes'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (k: keyof typeof v, val: string) => setV((x) => ({ ...x, [k]: val }));
  const submit = () => {
    const payload =
      kind === 'STUDENT'
        ? { kind, studentId: student?.id ?? '', personName: v.personName, relation: v.relation, phone: v.phone, reason: v.reason }
        : { kind, visitorName: v.visitorName, phone: v.phone, whomToMeet: v.whomToMeet, reason: v.reason };
    const r = zodErrors(gatePassSchema, payload);
    setErrors(r.errors);
    if (r.data) issue.mutate(r.data);
  };

  return (
    <>
      <Link to="/certificates" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Certificates
      </Link>
      <PageHeader icon="🚪" title="Gate pass" description="Issue a slip when a student leaves early or a visitor comes in." />
      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-4">
          <Tabs
            value={kind}
            onChange={(k) => (setKind(k), setErrors({}))}
            tabs={[
              { value: 'STUDENT', label: 'Student leaving early' },
              { value: 'VISITOR', label: 'Visitor' },
            ]}
          />
          <div className="space-y-3">
            {kind === 'STUDENT' ? (
              <>
                {student ? (
                  <div className="flex items-center gap-2 rounded-md bg-sidebar px-3 py-2">
                    <div className="flex-1">
                      <div className="font-medium text-ink-strong">{student.name}</div>
                      <div className="text-xs text-muted">
                        {student.admissionNo} · Class {student.classLabel}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setStudent(null)}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <div>
                    <StudentSearch activeOnly onPick={(s) => (setStudent(s), set('personName', s.fatherName), set('relation', s.fatherName ? 'Father' : ''))} />
                    {errors.studentId && <div className="text-xs text-tag-red-ink mt-1">{errors.studentId}</div>}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Collected by *" error={errors.personName}>
                    <Input value={v.personName} onChange={(e) => set('personName', e.target.value)} />
                  </Field>
                  <Field label="Relation *" error={errors.relation}>
                    <Input value={v.relation} onChange={(e) => set('relation', e.target.value)} placeholder="Father, Mother, Uncle…" />
                  </Field>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Visitor name *" error={errors.visitorName}>
                  <Input value={v.visitorName} onChange={(e) => set('visitorName', e.target.value)} />
                </Field>
                <Field label="To meet *" error={errors.whomToMeet}>
                  <Input value={v.whomToMeet} onChange={(e) => set('whomToMeet', e.target.value)} placeholder="Principal, class teacher…" />
                </Field>
              </div>
            )}
            <Field label="Mobile *" error={errors.phone}>
              <Input inputMode="numeric" maxLength={10} value={v.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="Reason *" error={errors.reason}>
              <Input value={v.reason} onChange={(e) => set('reason', e.target.value)} placeholder={kind === 'STUDENT' ? 'e.g. not feeling well' : 'e.g. admission enquiry'} />
            </Field>
            <Button variant="primary" className="w-full" size="lg" loading={issue.isPending} onClick={submit}>
              Issue & print gate pass
            </Button>
          </div>
        </Card>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-semibold text-muted uppercase tracking-wide">{date === todayStr() ? "Today's passes" : fmtDate(date)}</div>
            <Input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className="w-auto !h-8" />
          </div>
          {list.isLoading ? (
            <Loading />
          ) : list.error ? (
            <ErrorBox error={list.error} />
          ) : !list.data!.length ? (
            <Empty icon="🚪" title="No gate passes" />
          ) : (
            <Card className="divide-y divide-line">
              {list.data!.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ink-strong truncate">
                      {p.student ? `${p.student.name} (${p.student.classLabel})` : p.visitorName}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {p.serialNo} · {fmtTime(p.outTime)} · {p.kind === 'STUDENT' ? `with ${p.personName} (${p.relation})` : `to meet ${p.personName}`}
                    </div>
                  </div>
                  {p.returnTime ? (
                    <Tag color="green">Back {fmtTime(p.returnTime)}</Tag>
                  ) : p.kind === 'VISITOR' ? (
                    <Button size="sm" onClick={() => back.mutate(p.id)}>
                      Mark left
                    </Button>
                  ) : (
                    <Tag color="orange">Out</Tag>
                  )}
                  <Link to={`/certificates/gate-pass/${p.id}`} className="p-1.5 rounded hover:bg-hover text-muted" title="Print">
                    <Printer className="size-4" />
                  </Link>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export function GatePassPrint() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['gate-pass', id], queryFn: async () => (await api.get<Pass>(`/certificates/gate-passes/${id}`)).data });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const p = q.data!;
  const rows: [string, string][] =
    p.kind === 'STUDENT'
      ? [
          ['Student', p.student?.name ?? ''],
          ['Class / Adm. no.', `${p.student?.classLabel ?? ''} / ${p.student?.admissionNo ?? ''}`],
          ['Collected by', `${p.personName} (${p.relation ?? ''})`],
          ['Mobile', p.phone ?? ''],
          ['Reason', p.reason],
        ]
      : [
          ['Visitor', p.visitorName ?? ''],
          ['To meet', p.personName],
          ['Mobile', p.phone ?? ''],
          ['Purpose', p.reason],
        ];
  return (
    <>
      <PrintToolbar title={`Gate pass ${p.serialNo}`} />
      <PrintSheet className="max-w-[148mm]">
        <Letterhead title={p.kind === 'STUDENT' ? 'Gate pass · student' : 'Visitor pass'} compact />
        <div className="flex justify-between text-[13px] mb-3">
          <span>
            No. <b>{p.serialNo}</b>
          </span>
          <span>
            {fmtDate(p.outTime)} · <b>{fmtTime(p.outTime)}</b>
          </span>
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {rows.map(([k, val]) => (
              <tr key={k}>
                <td className="py-1 w-36 text-gray-600">{k}</td>
                <td className="py-1 font-medium border-b border-dotted border-gray-400">{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Signatures labels={p.kind === 'STUDENT' ? ['Parent / guardian', 'Class teacher', 'Gate keeper'] : ['Visitor', 'Office', 'Gate keeper']} />
      </PrintSheet>
    </>
  );
}
