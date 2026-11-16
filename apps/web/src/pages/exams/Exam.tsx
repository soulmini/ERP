import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BadgeCheck, EyeOff, FileText, IdCard, MessageSquareText, Pencil, Table2, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, SectionTitle, Tabs, Tag } from '../../components/ui';
import { cn, fmtDate } from '../../lib/utils';
import { ExamFormModal, useExamScope } from './Home';
import { DateSheetTab } from './DateSheet';
import { examRange, type ExamDetail, type Progress } from './types';

type TabKey = 'marks' | 'datesheet' | 'results';

export const useExam = (examId: string | undefined) =>
  useQuery({ queryKey: ['exam', examId], queryFn: async () => (await api.get<ExamDetail>(`/exams/${examId}`)).data });

export function ExamPage() {
  const { examId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useExam(examId);
  const scope = useExamScope();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const tab = (params.get('tab') as TabKey) ?? 'marks';

  const publish = useMutation({
    mutationFn: async (published: boolean) => api.post(`/exams/${examId}/publish`, { published }),
    onSuccess: (_r, published) => {
      toast.success(published ? 'Results published. Parents can now see report cards.' : 'Results unpublished');
      qc.invalidateQueries({ queryKey: ['exam', examId] });
      qc.invalidateQueries({ queryKey: ['exams'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: async (force: boolean) => api.delete(`/exams/${examId}`, { params: force ? { force: 'true' } : {} }),
    onSuccess: () => {
      toast.success('Exam deleted');
      qc.invalidateQueries({ queryKey: ['exams'] });
      qc.invalidateQueries({ queryKey: ['exam-scope'] });
      nav('/exams');
    },
    onError: (e) => {
      const ax = e as { response?: { status?: number } };
      if (ax.response?.status === 409) setConfirmDelete(errorMessage(e));
      else toast.error(errorMessage(e));
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const exam = q.data!;
  const manage = exam.canManage;

  return (
    <>
      <Link to="/exams" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> All exams
      </Link>
      <PageHeader
        title={exam.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {examRange(exam.firstPaper ?? exam.startDate, exam.lastPaper ?? exam.endDate)} · Session {exam.session.name}
            </span>
            {exam.resultPublished ? <Tag color="green">Result published</Tag> : <Tag>Not published</Tag>}
          </span>
        }
        actions={
          manage && (
            <>
              <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              {exam.resultPublished ? (
                <Button icon={<EyeOff className="size-4" />} loading={publish.isPending} onClick={() => publish.mutate(false)}>
                  Unpublish
                </Button>
              ) : (
                <Button variant="primary" icon={<BadgeCheck className="size-4" />} loading={publish.isPending} onClick={() => publish.mutate(true)}>
                  Publish result
                </Button>
              )}
              <Button variant="danger" icon={<Trash2 className="size-4" />} loading={remove.isPending} onClick={() => remove.mutate(false)} aria-label="Delete exam" />
            </>
          )
        }
      />

      <Tabs<TabKey>
        tabs={[
          { value: 'marks', label: 'Marks entry' },
          { value: 'datesheet', label: 'Date sheet' },
          { value: 'results', label: 'Results & cards' },
        ]}
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
      />

      {tab === 'marks' && <MarksProgress examId={exam.id} />}
      {tab === 'datesheet' && <DateSheetTab exam={exam} />}
      {tab === 'results' && (scope.data ? <ResultsTab examId={exam.id} scope={scope.data} published={exam.resultPublished} /> : <Loading />)}

      <ExamFormModal exam={editing ? exam : null} onClose={() => setEditing(false)} />
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete exam?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(true)}>
              Delete exam and marks
            </Button>
          </>
        }
      >
        <p className="text-sm pb-2">{confirmDelete}</p>
      </Modal>
    </>
  );
}

/** Sections × subjects with how many marks are entered; each subject opens the marks grid. */
function MarksProgress({ examId }: { examId: string }) {
  const q = useQuery({
    queryKey: ['exam-progress', examId],
    queryFn: async () => (await api.get<Progress>(`/exams/${examId}/progress`)).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const sections = q.data!.sections;
  if (!sections.length)
    return (
      <Card>
        <Empty icon="📝" title="Nothing to enter">
          You are not assigned to any class or subject. Ask the Principal to assign subjects to you.
        </Empty>
      </Card>
    );
  return (
    <div className="space-y-4">
      {sections.map((s) => {
        const done = s.subjects.filter((x) => x.scheduled && s.students && x.entered >= s.students).length;
        return (
          <Card key={s.id}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
              <span className="font-semibold text-ink-strong">Class {s.label}</span>
              {s.isClassTeacher && <Tag color="blue">Class teacher</Tag>}
              <span className="text-xs text-muted">
                {s.students} students · {done}/{s.subjects.length} subjects complete
              </span>
              {s.canViewResults && (
                <div className="ml-auto flex gap-1.5">
                  <Link to={`/exams/${examId}/remarks?sectionId=${s.id}`}>
                    <Button size="sm" variant="ghost" icon={<MessageSquareText className="size-3.5" />}>
                      Remarks{s.remarks != null ? ` ${s.remarks}/${s.students}` : ''}
                    </Button>
                  </Link>
                  <Link to={`/exams/${examId}/results?sectionId=${s.id}`}>
                    <Button size="sm" icon={<Table2 className="size-3.5" />}>
                      Results
                    </Button>
                  </Link>
                </div>
              )}
            </div>
            <div className="divide-y divide-line">
              {s.subjects.map((sub) => {
                const complete = s.students > 0 && sub.entered >= s.students;
                const body = (
                  <div className={cn('flex items-center gap-3 px-4 py-2.5', sub.scheduled && 'hover:bg-hover')}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink-strong">
                        {sub.name}
                        {sub.type === 'CO_SCHOLASTIC' && <span className="ml-1.5 text-xs font-normal text-muted">grades</span>}
                      </div>
                      <div className="text-xs text-muted">
                        {sub.scheduled ? (sub.date ? fmtDate(sub.date, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Date not set') : 'Not in date sheet'}
                      </div>
                    </div>
                    {sub.scheduled ? (
                      <Tag color={complete ? 'green' : sub.entered ? 'yellow' : 'gray'}>
                        {sub.entered}/{s.students}
                      </Tag>
                    ) : (
                      <Tag>—</Tag>
                    )}
                  </div>
                );
                return sub.scheduled ? (
                  <Link key={sub.subjectId} to={`/exams/${examId}/marks?sectionId=${s.id}&subjectId=${sub.subjectId}`} className="block">
                    {body}
                  </Link>
                ) : (
                  <div key={sub.subjectId} className="opacity-60">
                    {body}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Sections the user may see results / print cards for. */
function ResultsTab({ examId, scope, published }: { examId: string; scope: import('./types').ExamScope; published: boolean }) {
  const sections = scope.sections.filter((s) => (s.canViewResults || s.canPrintAdmitCards) && s.students > 0);
  if (!sections.length)
    return (
      <Card>
        <Empty icon="📊" title="No classes">
          Results and report cards are available to the class teacher and the exam admin.
        </Empty>
      </Card>
    );
  return (
    <>
      {!published && scope.canManage && (
        <div className="rounded-md bg-tag-yellow text-tag-yellow-ink px-3 py-2 text-sm mb-4">
          Parents will see report cards in the app once you publish the result.
        </div>
      )}
      <SectionTitle>Classes</SectionTitle>
      <Card className="divide-y divide-line">
        {sections.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div className="flex-1 min-w-[120px]">
              <div className="font-medium text-ink-strong">Class {s.label}</div>
              <div className="text-xs text-muted">{s.students} students</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {s.canViewResults && (
                <>
                  <Link to={`/exams/${examId}/results?sectionId=${s.id}`}>
                    <Button size="sm" icon={<Table2 className="size-3.5" />}>
                      Result sheet
                    </Button>
                  </Link>
                  <Link to={`/exams/${examId}/report-cards?sectionId=${s.id}`}>
                    <Button size="sm" icon={<FileText className="size-3.5" />}>
                      Report cards
                    </Button>
                  </Link>
                </>
              )}
              {s.canPrintAdmitCards && (
                <Link to={`/exams/${examId}/admit-cards?sectionId=${s.id}`}>
                  <Button size="sm" icon={<IdCard className="size-3.5" />}>
                    Admit cards
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
