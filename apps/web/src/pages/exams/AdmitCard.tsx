import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Empty, ErrorBox, Loading } from '../../components/ui';
import { PrintSheet, PrintToolbar, useSchool } from '../../components/print';
import { fmtDate } from '../../lib/utils';
import { timeRange, type AdmitCards } from './types';

const INSTRUCTIONS = [
  'Bring this admit card to every exam; it may be checked by the invigilator.',
  'Reach the school 15 minutes before the exam starts.',
  'Mobile phones, notes and calculators are not allowed in the exam room.',
];

/** Admit cards: ?sectionId= (whole class, 2 per A4) or ?studentId= (one). */
export function AdmitCardsPage() {
  const { examId } = useParams();
  const [params] = useSearchParams();
  const sectionId = params.get('sectionId') ?? undefined;
  const studentId = params.get('studentId') ?? undefined;
  const q = useQuery({
    queryKey: ['admit-cards', examId, sectionId, studentId],
    queryFn: async () => (await api.get<AdmitCards>(`/exams/${examId}/admit-cards`, { params: { sectionId, studentId } })).data,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const pages: AdmitCards['cards'][] = [];
  for (let i = 0; i < d.cards.length; i += 2) pages.push(d.cards.slice(i, i + 2));

  return (
    <>
      <PrintToolbar title={`Admit card${d.cards.length > 1 ? 's' : ''} · ${d.exam.name} · ${d.section.label}`} />
      {!d.cards.length ? (
        <Empty icon="🎒" title="No students" />
      ) : (
        <div className="space-y-6 print:space-y-0">
          {pages.map((pair, i) => (
            <div key={i} className={i < pages.length - 1 ? 'page-break' : ''}>
              <PrintSheet className="p-4 md:p-6">
                {pair.map((c, j) => (
                  <div key={c.studentId} className={j === 0 && pair.length > 1 ? 'pb-3 mb-3 border-b-2 border-dashed border-[#999]' : ''}>
                    <AdmitCardDoc data={d} card={c} />
                  </div>
                ))}
              </PrintSheet>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AdmitCardDoc({ data: d, card: c }: { data: AdmitCards; card: AdmitCards['cards'][number] }) {
  const { data: s } = useSchool();
  const address = [s?.address, s?.city].filter(Boolean).join(', ');
  const cell = 'border border-black px-2 py-px';
  return (
    <div className="border-2 border-black px-3 py-2 text-[11.5px] leading-snug break-inside-avoid">
      <div className="flex items-center gap-3 border-b border-black pb-1.5 mb-1.5">
        {s?.logoUrl && <img src={s.logoUrl} alt="" className="size-10 object-contain" />}
        <div className="flex-1 text-center">
          <div className="font-bold uppercase tracking-wide text-[14px]">{s?.name}</div>
          {address && <div className="text-[11px]">{address}</div>}
          <div className="inline-block mt-0.5 px-3 py-px border border-black font-semibold uppercase tracking-wider text-[11.5px]">
            Admit Card – {d.exam.name} {d.session.name}
          </div>
        </div>
      </div>

      <div className="flex gap-3 mb-1.5">
        <table className="flex-1 border-collapse table-fixed">
          <tbody>
            {[
              ["Student's name", c.name],
              ["Father's / guardian's name", c.fatherName ?? '—'],
              ['Class & section', d.section.label],
              ['Roll no.', c.rollNo ?? '—'],
              ['Admission no.', c.admissionNo],
            ].map(([k, v]) => (
              <tr key={String(k)}>
                <td className="py-px pr-2 w-44 text-[#555]">{k}</td>
                <td className="py-px font-semibold border-b border-dotted border-[#999]">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="w-[21mm] h-[26mm] border border-black shrink-0 flex items-center justify-center overflow-hidden">
          {c.photoUrl ? <img src={c.photoUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-[#888] text-center px-1">Paste photo</span>}
        </div>
      </div>

      <table className="w-full border-collapse text-center mb-1.5">
        <thead>
          <tr className="bg-[#f1f1ef]">
            <th className={cell}>Date</th>
            <th className={cell}>Day</th>
            <th className={`${cell} text-left`}>Subject</th>
            <th className={cell}>Time</th>
            <th className={`${cell} w-24`}>Invigilator</th>
          </tr>
        </thead>
        <tbody>
          {d.dateSheet.map((e) => (
            <tr key={e.subjectId}>
              <td className={cell}>{e.date ? fmtDate(e.date, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
              <td className={cell}>{e.date ? fmtDate(e.date, { weekday: 'short' }) : ''}</td>
              <td className={`${cell} text-left`}>{e.name}</td>
              <td className={cell}>{timeRange(e.startTime, e.endTime)}</td>
              <td className={cell} />
            </tr>
          ))}
        </tbody>
      </table>

      <ol className="list-decimal pl-4 text-[10px] text-[#333] space-y-0">
        {INSTRUCTIONS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>

      <div className="flex justify-between gap-6 mt-5 text-[11px]">
        {['Class Teacher', 'Principal'].map((l) => (
          <div key={l} className="w-40 text-center border-t border-black pt-0.5">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
