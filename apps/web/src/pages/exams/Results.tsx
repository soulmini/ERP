import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, MessageSquareText, Printer } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, SectionTitle, Select, Stat, Tag } from '../../components/ui';
import { cn, downloadCsv } from '../../lib/utils';
import { RESULT_TAG, cellText, fmtMarks, type ResultSheet } from './types';

/** Class result sheet: students × subjects, total, %, grade, rank, result. */
export function ResultsPage() {
  const { examId } = useParams();
  const [params] = useSearchParams();
  const sectionId = params.get('sectionId') ?? '';
  const [sort, setSort] = useState<'roll' | 'rank'>('roll');
  const q = useQuery({
    queryKey: ['exam-results', examId, sectionId],
    queryFn: async () => (await api.get<ResultSheet>(`/exams/${examId}/results`, { params: { sectionId } })).data,
  });
  const rows = useMemo(() => {
    const s = [...(q.data?.students ?? [])];
    if (sort === 'rank') s.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || (a.rollNo ?? 999) - (b.rollNo ?? 999));
    return s;
  }, [q.data, sort]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const h = d.highlights;
  const scholastic = d.subjects.filter((s) => s.type === 'SCHOLASTIC');

  const exportCsv = () => {
    downloadCsv(`Result ${d.exam.name} ${d.section.label}.csv`, [
      ['Roll', 'Adm no', 'Name', ...d.subjects.map((s) => (s.type === 'SCHOLASTIC' ? `${s.name} (${s.maxMarks})` : `${s.name} (grade)`)), 'Total', 'Max', '%', 'Grade', 'Rank', 'Result', 'Below pass in'],
      ...rows.map((r) => [
        r.rollNo,
        r.admissionNo,
        r.name,
        ...d.subjects.map((s) => cellText(r.marks[s.subjectId], s.type)),
        fmtMarks(r.total),
        r.maxTotal,
        r.percent,
        r.grade,
        r.rank,
        RESULT_TAG[r.result].label,
        r.failedSubjects.join('; '),
      ]),
    ]);
  };

  return (
    <>
      <Link to={`/exams/${examId}?tab=results`} className="no-print inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> {d.exam.name}
      </Link>
      <PageHeader
        title={`Result · Class ${d.section.label}`}
        description={`${d.exam.name} ${d.session.name}${d.classTeacher ? ` · Class teacher ${d.classTeacher}` : ''}`}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Link to={`/exams/${examId}/remarks?sectionId=${sectionId}`}>
              <Button icon={<MessageSquareText className="size-4" />}>Remarks</Button>
            </Link>
            <Link to={`/exams/${examId}/report-cards?sectionId=${sectionId}`}>
              <Button icon={<FileText className="size-4" />}>Report cards</Button>
            </Link>
            <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!rows.length}>
              CSV
            </Button>
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      {!d.subjects.length ? (
        <Card>
          <Empty icon="🗓️" title="No date sheet">This class has no subjects in the {d.exam.name} date sheet yet.</Empty>
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty icon="🎒" title="No students in this class" />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat icon="✅" label="Pass %" value={h.passPercent == null ? '—' : `${h.passPercent}%`} sub={`${h.passed} pass · ${h.failed} fail${h.pending ? ` · ${h.pending} pending` : ''}`} />
            <Stat icon="📈" label="Class average" value={h.classAverage == null ? '—' : `${h.classAverage}%`} />
            <Stat icon="🏆" label="Topper" value={<span className="text-base">{h.toppers[0]?.name ?? '—'}</span>} sub={h.toppers[0] ? `${h.toppers[0].percent}%${h.toppers.length > 1 ? ` (+${h.toppers.length - 1} tied)` : ''}` : undefined} />
            <Stat icon="👥" label="Students" value={h.students} sub={d.hasMarks ? undefined : 'No marks entered yet'} />
          </div>

          <div className="flex items-center justify-between mb-2">
            <SectionTitle>Marks</SectionTitle>
            <Select className="w-auto h-8 no-print" value={sort} onChange={(e) => setSort(e.target.value as 'roll' | 'rank')} aria-label="Sort">
              <option value="roll">By roll no.</option>
              <option value="rank">By rank</option>
            </Select>
          </div>
          <div className="overflow-x-auto -mx-4 md:mx-0 border-y md:border border-line md:rounded-lg bg-white">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[12px] text-muted bg-[#fbfbfa]">
                  <th className="sticky left-0 bg-[#fbfbfa] text-left font-normal px-3 py-2 border-b border-line">Student</th>
                  {d.subjects.map((s) => (
                    <th key={s.subjectId} className="font-normal px-2 py-2 border-b border-line text-center whitespace-nowrap">
                      {s.name}
                      <div className="text-[11px] text-faint">{s.type === 'SCHOLASTIC' ? `/${s.maxMarks}` : 'grade'}</div>
                    </th>
                  ))}
                  <th className="font-normal px-2 py-2 border-b border-line text-center">
                    Total
                    <div className="text-[11px] text-faint">/{scholastic.reduce((n, s) => n + s.maxMarks, 0)}</div>
                  </th>
                  <th className="font-normal px-2 py-2 border-b border-line text-center">%</th>
                  <th className="font-normal px-2 py-2 border-b border-line text-center">Grade</th>
                  <th className="font-normal px-2 py-2 border-b border-line text-center">Rank</th>
                  <th className="font-normal px-2 py-2 border-b border-line text-center">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.studentId} className="hover:bg-[#fafaf9]">
                    <td className="sticky left-0 bg-white px-3 py-2 border-b border-line whitespace-nowrap">
                      <span className="text-faint tabular-nums mr-2">{r.rollNo ?? '–'}</span>
                      <span className="font-medium text-ink-strong">{r.name}</span>
                    </td>
                    {d.subjects.map((s) => {
                      const c = r.marks[s.subjectId];
                      const fail = s.type === 'SCHOLASTIC' && c && (c.isAbsent || (c.marks ?? 0) < s.passMarks);
                      return (
                        <td key={s.subjectId} className={cn('px-2 py-2 border-b border-line text-center tabular-nums', fail && 'text-tag-red-ink font-medium bg-[#fdf5f5]', !c && 'text-faint')}>
                          {c ? cellText(c, s.type) : '·'}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 border-b border-line text-center tabular-nums font-semibold">{fmtMarks(r.total)}</td>
                    <td className="px-2 py-2 border-b border-line text-center tabular-nums">{r.percent ?? '—'}</td>
                    <td className="px-2 py-2 border-b border-line text-center">{r.grade ?? '—'}</td>
                    <td className="px-2 py-2 border-b border-line text-center tabular-nums">{r.rank ?? '—'}</td>
                    <td className="px-2 py-2 border-b border-line text-center">
                      <Tag color={RESULT_TAG[r.result].color}>{RESULT_TAG[r.result].label}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-2">
            AB = absent (counted as 0). Red = below pass marks. Rank is by total marks; equal totals share a rank.
          </p>

          <SectionTitle>Subject analysis</SectionTitle>
          <div className="overflow-x-auto -mx-4 md:mx-0 border-y md:border border-line md:rounded-lg bg-white">
            <table className="w-full text-sm border-collapse min-w-[520px] [&_td]:px-3 [&_td]:py-2 [&_td]:border-b [&_td]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:border-b [&_th]:border-line [&_th]:font-normal [&_th]:text-muted [&_th]:text-[12px]">
              <thead>
                <tr className="bg-[#fbfbfa]">
                  <th className="text-left">Subject</th>
                  <th>Entered</th>
                  <th>Average</th>
                  <th>Highest</th>
                  <th>Lowest</th>
                  <th>Pass</th>
                  <th>Fail</th>
                </tr>
              </thead>
              <tbody>
                {h.subjects.map((s) => (
                  <tr key={s.subjectId}>
                    <td className="font-medium text-ink-strong">{s.name}</td>
                    <td className="text-center tabular-nums">
                      {s.entered}/{h.students}
                    </td>
                    {s.type === 'SCHOLASTIC' ? (
                      <>
                        <td className="text-center tabular-nums">{s.average ?? '—'}</td>
                        <td className="text-center tabular-nums">{s.highest ?? '—'}</td>
                        <td className="text-center tabular-nums">{s.lowest ?? '—'}</td>
                        <td className="text-center tabular-nums">{s.passed}</td>
                        <td className={cn('text-center tabular-nums', !!s.failed && 'text-tag-red-ink font-medium')}>{s.failed}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="text-center text-muted">
                        {Object.entries(s.grades ?? {})
                          .sort()
                          .map(([g, n]) => `${g}: ${n}`)
                          .join(' · ') || '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
