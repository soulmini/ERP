import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button, Empty, ErrorBox, Loading, Select } from '../../components/ui';
import { Letterhead, PrintSheet, PrintToolbar, Signatures } from '../../components/print';
import { cn, fmtDate } from '../../lib/utils';
import { RESULT_TAG, cellText, fmtMarks, type ReportCards } from './types';

const dmy = (d: string | null) => (d ? fmtDate(d, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

/** Report cards: ?sectionId= (whole class, one per page) or ?studentId= (one). &cumulative=1 → all exams so far. */
export function ReportCardsPage() {
  const { examId } = useParams();
  const [params, setParams] = useSearchParams();
  const sectionId = params.get('sectionId') ?? undefined;
  const studentId = params.get('studentId') ?? undefined;
  const only = params.get('only') ?? '';
  const cumulative = params.get('cumulative') === '1';
  const q = useQuery({
    queryKey: ['report-cards', examId, sectionId, studentId, cumulative],
    queryFn: async () =>
      (await api.get<ReportCards>(`/exams/${examId}/report-cards`, { params: { sectionId, studentId, cumulative: cumulative ? '1' : undefined } })).data,
  });
  const patch = (p: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const cards = only ? d.cards.filter((c) => c.studentId === only) : d.cards;

  return (
    <>
      <PrintToolbar title={`Report card${cards.length > 1 ? 's' : ''} · ${d.exam.name} · ${d.section.label}`}>
        {sectionId && d.cards.length > 1 && (
          <Select className="w-auto" value={only} onChange={(e) => patch({ only: e.target.value || null })} aria-label="Student">
            <option value="">All {d.cards.length} students</option>
            {d.cards.map((c) => (
              <option key={c.studentId} value={c.studentId}>
                {c.rollNo ?? '–'}. {c.name}
              </option>
            ))}
          </Select>
        )}
        <Button onClick={() => patch({ cumulative: cumulative ? null : '1' })}>{cumulative ? 'This exam only' : 'All exams so far'}</Button>
      </PrintToolbar>
      {!cards.length ? (
        <Empty icon="🎒" title="No students" />
      ) : (
        <div className="space-y-6 print:space-y-0">
          {cards.map((c, i) => (
            <div key={c.studentId} className={i < cards.length - 1 ? 'page-break' : ''}>
              <ReportCardDoc data={d} card={c} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ReportCardDoc({ data: d, card: c }: { data: ReportCards; card: ReportCards['cards'][number] }) {
  const scholastic = d.subjects.filter((s) => s.type === 'SCHOLASTIC');
  const co = d.subjects.filter((s) => s.type === 'CO_SCHOLASTIC');
  const exams = d.exams;
  const main = c.results.find((r) => r.examId === d.exam.id) ?? c.results[c.results.length - 1];
  const multi = exams.length > 1;
  const th = 'border border-black px-2 py-1 font-semibold bg-[#f1f1ef]';
  const td = 'border border-black px-2 py-1';
  const parent = c.fatherName ? ["Father's name", c.fatherName] : c.guardianName ? ["Guardian's name", c.guardianName] : null;

  return (
    <PrintSheet className="text-[12.5px]">
      <Letterhead title={`Progress Report ${d.session.name}`} />
      <div className="text-center font-semibold -mt-2 mb-4">{multi ? exams.map((e) => e.name).join(' + ') : `${d.exam.name} Examination`}</div>

      <div className="flex gap-4 mb-4">
        <table className="flex-1 border-collapse table-fixed">
          <tbody>
            {[
              ["Student's name", c.name],
              ...(parent ? [parent] : []),
              ...(c.motherName ? [["Mother's name", c.motherName]] : []),
              ['Class & section', d.section.label],
              ['Roll no. / Adm. no.', `${c.rollNo ?? '—'} / ${c.admissionNo}`],
              ['Date of birth', dmy(c.dob)],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5 pr-3 w-40 text-[#555]">{k}</td>
                <td className="py-0.5 font-semibold border-b border-dotted border-[#999]">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="w-[26mm] h-[32mm] border border-black shrink-0 flex items-center justify-center overflow-hidden">
          {c.photoUrl ? <img src={c.photoUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-[#888]">Photo</span>}
        </div>
      </div>

      {/* Scholastic */}
      <div className="font-semibold mb-1">Part A · Scholastic areas</div>
      <table className="w-full border-collapse text-center mb-4">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')} rowSpan={multi ? 2 : 1}>
              Subject
            </th>
            {multi
              ? exams.map((e) => (
                  <th key={e.id} className={th} colSpan={3}>
                    {e.name}
                  </th>
                ))
              : ['Max marks', 'Marks obtained', 'Grade'].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
          </tr>
          {multi && (
            <tr>
              {exams.flatMap((e) =>
                ['Max', 'Obt.', 'Gr.'].map((h) => (
                  <th key={`${e.id}${h}`} className={th}>
                    {h}
                  </th>
                )),
              )}
            </tr>
          )}
        </thead>
        <tbody>
          {scholastic.map((s) => (
            <tr key={s.subjectId}>
              <td className={cn(td, 'text-left')}>{s.name}</td>
              {exams.map((e, i) => {
                const sch = e.subjects[s.subjectId];
                const cell = c.results[i]?.marks[s.subjectId];
                const fail = sch && cell && (cell.isAbsent || (cell.marks ?? 0) < sch.passMarks);
                return [
                  <td key={`${e.id}m`} className={td}>
                    {sch ? fmtMarks(sch.maxMarks) : '—'}
                  </td>,
                  <td key={`${e.id}o`} className={cn(td, 'font-semibold', fail && 'underline')}>
                    {sch ? cellText(cell, 'SCHOLASTIC') || '—' : '—'}
                  </td>,
                  <td key={`${e.id}g`} className={td}>
                    {cell?.isAbsent ? '—' : (cell?.grade ?? '—')}
                  </td>,
                ];
              })}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className={cn(td, 'text-left')}>Total</td>
            {exams.map((e, i) => {
              const r = c.results[i];
              return [
                <td key={`${e.id}m`} className={td}>
                  {r?.maxTotal ?? '—'}
                </td>,
                <td key={`${e.id}o`} className={td}>
                  {r ? fmtMarks(r.total) : '—'}
                </td>,
                <td key={`${e.id}g`} className={td}>
                  {r?.grade ?? '—'}
                </td>,
              ];
            })}
          </tr>
        </tbody>
      </table>

      {/* Co-scholastic */}
      {co.length > 0 && (
        <>
          <div className="font-semibold mb-1">Part B · Co-scholastic areas</div>
          <table className="w-full border-collapse text-center mb-4">
            <thead>
              <tr>
                <th className={cn(th, 'text-left')}>Activity</th>
                {exams.map((e) => (
                  <th key={e.id} className={th}>
                    {multi ? `${e.name} grade` : 'Grade'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {co.map((s) => (
                <tr key={s.subjectId}>
                  <td className={cn(td, 'text-left')}>{s.name}</td>
                  {exams.map((e, i) => (
                    <td key={e.id} className={cn(td, 'font-semibold')}>
                      {e.subjects[s.subjectId] ? cellText(c.results[i]?.marks[s.subjectId], 'CO_SCHOLASTIC') || '—' : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Summary */}
      <table className="w-full border-collapse text-center mb-4">
        <thead>
          <tr>
            {['Total', 'Percentage', 'Grade', 'Rank', 'Result', 'Attendance'].map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="font-semibold">
            <td className={td}>
              {main ? `${fmtMarks(main.total)} / ${main.maxTotal}` : '—'}
            </td>
            <td className={td}>{main?.percent != null ? `${main.percent}%` : '—'}</td>
            <td className={td}>{main?.grade ?? '—'}</td>
            <td className={td}>{main?.rank ?? '—'}</td>
            <td className={td}>{main ? RESULT_TAG[main.result].label : '—'}</td>
            <td className={td}>
              {c.attendance && c.attendance.workingDays ? `${fmtMarks(c.attendance.present)} / ${c.attendance.workingDays}` : '—'}
            </td>
          </tr>
        </tbody>
      </table>
      {main?.failedSubjects.length ? <div className="mb-3 text-[12px]">Below pass marks in: {main.failedSubjects.join(', ')}</div> : null}

      <div className="border border-black px-3 py-2 min-h-[18mm] mb-3">
        <span className="font-semibold">Class teacher&apos;s remark: </span>
        {c.remark ?? ''}
      </div>

      <div className="text-[10.5px] text-[#444]">
        <span className="font-semibold">Grading scale: </span>
        {[...d.scale]
          .sort((a, b) => b.minPercent - a.minPercent)
          .map((g) => `${g.grade} ${g.minPercent}–${g.maxPercent}%`)
          .join(' · ')}
        {' · '}AB = absent
      </div>

      <Signatures labels={[`Class Teacher${d.classTeacher ? ` (${d.classTeacher})` : ''}`, 'Principal', 'Parent']} />
    </PrintSheet>
  );
}
