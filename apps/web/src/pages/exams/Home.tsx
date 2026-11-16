import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight, Plus, Ruler } from 'lucide-react';
import { examSchema } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { zodErrors } from '../accounts/zod';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Tag } from '../../components/ui';
import { examRange, type Exam, type ExamListItem, type ExamScope } from './types';

export const useExamScope = () =>
  useQuery({ queryKey: ['exam-scope'], queryFn: async () => (await api.get<ExamScope>('/exams/scope')).data });

/** Staff landing page: exams of the current session. */
export function ExamsHome() {
  const [editing, setEditing] = useState<Exam | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['exams'],
    queryFn: async () => (await api.get<{ session: { name: string }; exams: ExamListItem[] }>('/exams')).data,
  });
  const scope = useExamScope();
  const manage = scope.data?.canManage ?? false;

  if (list.isLoading || scope.isLoading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} />;
  if (scope.error) return <ErrorBox error={scope.error} />;
  const { exams, session } = list.data!;
  const mySections = scope.data!.sections.filter((s) => s.isClassTeacher);

  return (
    <>
      <PageHeader
        icon="🧾"
        title="Exams & results"
        description={
          manage
            ? `Session ${session.name} · date sheets, marks, results, report cards and admit cards`
            : `Session ${session.name} · enter marks${mySections.length ? `, results of ${mySections.map((s) => s.label).join(', ')}` : ''}`
        }
        actions={
          manage && (
            <>
              <Link to="/exams/grades">
                <Button icon={<Ruler className="size-4" />}>Grade scale</Button>
              </Link>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                New exam
              </Button>
            </>
          )
        }
      />

      {!exams.length ? (
        <Card>
          <Empty icon="🗓️" title="No exams yet">
            {manage ? 'Create the first exam of the session, e.g. "Half Yearly", then add its date sheet.' : 'The exam admin has not created any exams yet.'}
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {exams.map((e) => {
            const pct = e.marksExpected ? Math.round((e.marksEntered / e.marksExpected) * 100) : 0;
            return (
              <Link key={e.id} to={`/exams/${e.id}`}>
                <Card className="p-4 hover:bg-hover transition-colors h-full">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink-strong text-[15px]">{e.name}</span>
                        {e.resultPublished ? <Tag color="green">Result published</Tag> : <Tag>Not published</Tag>}
                      </div>
                      <div className="text-sm text-muted mt-0.5">{examRange(e.firstPaper ?? e.startDate, e.lastPaper ?? e.endDate)}</div>
                    </div>
                    <ChevronRight className="size-4 text-faint mt-1" />
                  </div>
                  {manage && (
                    <div className="mt-3 space-y-1.5">
                      <div className="flex justify-between text-xs text-muted">
                        <span>
                          Date sheet: {e.classesScheduled}/{e.totalClasses} classes · {e.papers} papers
                        </span>
                        <span className="tabular-nums">
                          Marks {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-tag-gray overflow-hidden">
                        <div className="h-full bg-[#448361] rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <ExamFormModal exam={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Create / edit an exam. */
export function ExamFormModal({ exam, onClose }: { exam: Exam | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ name: '', startDate: '', endDate: '', order: '0' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!exam) return;
    setErrors({});
    setV(
      exam === 'new'
        ? { name: '', startDate: '', endDate: '', order: '' }
        : { name: exam.name, startDate: exam.startDate ?? '', endDate: exam.endDate ?? '', order: String(exam.order) },
    );
  }, [exam]);
  const save = useMutation({
    mutationFn: async (body: unknown) =>
      exam === 'new' ? (await api.post<Exam>('/exams', body)).data : (await api.put<Exam>(`/exams/${(exam as Exam).id}`, body)).data,
    onSuccess: () => {
      toast.success(exam === 'new' ? 'Exam created' : 'Exam updated');
      qc.invalidateQueries({ queryKey: ['exams'] });
      qc.invalidateQueries({ queryKey: ['exam'] });
      qc.invalidateQueries({ queryKey: ['exam-scope'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const { data, errors } = zodErrors(examSchema, { ...v, order: v.order === '' ? 0 : v.order });
    setErrors(errors);
    if (data) save.mutate(data);
  };
  const bind = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value })) });
  return (
    <Modal
      open={!!exam}
      onClose={onClose}
      title={exam === 'new' ? 'New exam' : 'Edit exam'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <Field label="Exam name" error={errors.name}>
          <Input autoFocus placeholder="e.g. Half Yearly" {...bind('name')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" error={errors.startDate}>
            <Input type="date" {...bind('startDate')} />
          </Field>
          <Field label="Ends" error={errors.endDate}>
            <Input type="date" {...bind('endDate')} />
          </Field>
        </div>
        <Field label="Order" error={errors.order} hint="Exams are listed (and shown on cumulative report cards) in this order">
          <Input type="number" min={0} inputMode="numeric" placeholder="1" {...bind('order')} />
        </Field>
      </div>
    </Modal>
  );
}
