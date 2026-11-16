import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { DEFAULT_GRADE_SCALE, gradeScaleSchema, type GradeBand } from '@erp/shared';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Card, ErrorBox, Input, Loading, PageHeader } from '../../components/ui';

interface Row {
  grade: string;
  minPercent: string;
  maxPercent: string;
  gradePoint: string;
  remark: string;
}
const toRow = (g: GradeBand): Row => ({
  grade: g.grade,
  minPercent: String(g.minPercent),
  maxPercent: String(g.maxPercent),
  gradePoint: g.gradePoint == null ? '' : String(g.gradePoint),
  remark: g.remark ?? '',
});

/** Grade scale editor (exams.manage). Used for subject & overall grades and co-scholastic grade choices. */
export function GradeScalePage() {
  const { can } = useAuth();
  const manage = can('exams.manage');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['grade-scale'], queryFn: async () => (await api.get<GradeBand[]>('/exams/grades')).data });
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setRows(q.data.map(toRow));
  }, [q.data]);
  const save = useMutation({
    mutationFn: async (grades: unknown) => (await api.put<GradeBand[]>('/exams/grades', { grades })).data,
    onSuccess: (d) => {
      toast.success('Grade scale saved');
      qc.setQueryData(['grade-scale'], d);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const r = gradeScaleSchema.safeParse({ grades: rows });
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Please check the grades');
      return;
    }
    setError(null);
    save.mutate(r.data.grades);
  };
  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <>
      <Link to="/exams" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Exams
      </Link>
      <PageHeader
        icon="📏"
        title="Grade scale"
        description="Grades by percentage, used for subject grades, the overall grade and co-scholastic grades."
        actions={
          manage && (
            <Button icon={<RotateCcw className="size-4" />} onClick={() => setRows(DEFAULT_GRADE_SCALE.map(toRow))}>
              CBSE default
            </Button>
          )
        }
      />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px] [&_th]:text-left [&_th]:font-normal [&_th]:text-muted [&_th]:text-[13px] [&_th]:px-3 [&_th]:py-2 [&_th]:border-b [&_th]:border-line [&_td]:px-2 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-line">
          <thead>
            <tr>
              <th className="w-24">Grade</th>
              <th className="w-24">From %</th>
              <th className="w-24">To %</th>
              <th className="w-24">Grade point</th>
              <th>Remark</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <Input value={r.grade} disabled={!manage} maxLength={4} className="font-semibold uppercase" onChange={(e) => set(i, 'grade', e.target.value)} />
                </td>
                <td>
                  <Input inputMode="decimal" value={r.minPercent} disabled={!manage} onChange={(e) => set(i, 'minPercent', e.target.value)} />
                </td>
                <td>
                  <Input inputMode="decimal" value={r.maxPercent} disabled={!manage} onChange={(e) => set(i, 'maxPercent', e.target.value)} />
                </td>
                <td>
                  <Input inputMode="decimal" value={r.gradePoint} disabled={!manage} onChange={(e) => set(i, 'gradePoint', e.target.value)} />
                </td>
                <td>
                  <Input value={r.remark} disabled={!manage} maxLength={40} onChange={(e) => set(i, 'remark', e.target.value)} />
                </td>
                <td>
                  {manage && (
                    <button className="p-1.5 rounded hover:bg-hover text-muted" aria-label="Remove grade" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {error && <div className="mt-3 rounded-md bg-tag-red text-tag-red-ink px-3 py-2 text-sm">{error}</div>}
      {manage && (
        <div className="flex flex-wrap gap-2 mt-4">
          <Button icon={<Plus className="size-4" />} onClick={() => setRows((rs) => [...rs, { grade: '', minPercent: '', maxPercent: '', gradePoint: '', remark: '' }])}>
            Add grade
          </Button>
          <Button variant="primary" className="ml-auto" loading={save.isPending} onClick={submit}>
            Save grade scale
          </Button>
        </div>
      )}
    </>
  );
}
