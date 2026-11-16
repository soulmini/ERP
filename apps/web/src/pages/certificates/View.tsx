import type { ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CERT_META, dmyDate, genderWords, type CertSnapshot, type CertType } from '@erp/shared';
import { api } from '../../lib/api';
import { Button, ErrorBox, Loading } from '../../components/ui';
import { Letterhead, PrintSheet, PrintToolbar, Signatures, useSchool } from '../../components/print';

interface Cert {
  id: string;
  type: CertType;
  serialNo: string;
  issueDate: string;
  data: CertSnapshot;
  issuedBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export function CertificateView() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const duplicate = params.get('duplicate') === '1';
  const q = useQuery({ queryKey: ['certificate', id], queryFn: async () => (await api.get<Cert>(`/certificates/view/${id}`)).data });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  return (
    <>
      <PrintToolbar title={`${CERT_META[c.type].title} · ${c.serialNo}`}>
        {!c.cancelledAt && (
          <Button onClick={() => setParams(duplicate ? {} : { duplicate: '1' })}>{duplicate ? 'Print as original' : 'Print as duplicate'}</Button>
        )}
      </PrintToolbar>
      {c.cancelledAt && (
        <div className="no-print rounded-md bg-tag-red text-tag-red-ink px-3 py-2 text-sm mb-4">Cancelled: {c.cancelReason}</div>
      )}
      <PrintSheet className="relative overflow-hidden font-serif text-[14px] leading-relaxed">
        {c.cancelledAt && <Stamp text="CANCELLED" color="#d44c47" />}
        {duplicate && !c.cancelledAt && <Stamp text="DUPLICATE" color="#9b9a97" />}
        <Letterhead title={CERT_META[c.type].title} />
        <div className="flex justify-between text-[13px] mb-5 font-sans">
          <span>
            S. No.: <b>{c.serialNo}</b>
          </span>
          <span>
            Date: <b>{dmyDate(c.issueDate)}</b>
          </span>
        </div>
        {c.type === 'TC' ? <TcBody d={c.data} /> : <ParagraphBody type={c.type} d={c.data} />}
        {c.data.remarks && <p className="mt-4">Remarks: {c.data.remarks}</p>}
        <Signatures labels={c.type === 'TC' ? ['Prepared by', 'Checked by (Class Teacher)', 'Principal (with seal)'] : ['Class Teacher', 'Principal (with seal)']} />
      </PrintSheet>
    </>
  );
}

function Stamp({ text, color }: { text: string; color: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{ color, opacity: 0.18, fontSize: 96, fontWeight: 800, transform: 'rotate(-28deg)', letterSpacing: 8 }}
    >
      {text}
    </div>
  );
}

function TcBody({ d }: { d: CertSnapshot }) {
  const rows: [string, ReactNode][] = [
    ['Name of the pupil', d.studentName],
    ["Mother's name", d.motherName || '—'],
    ["Father's / guardian's name", d.fatherName || '—'],
    ['Nationality', d.nationality],
    ['Whether the candidate belongs to SC / ST / OBC', d.category || '—'],
    ['Date of first admission in the school with class', `${dmyDate(d.admissionDate)}, Class ${d.admissionClass}`],
    ['Date of birth (as per admission register)', `${dmyDate(d.dob)} (${d.dobWords})`],
    ['Class in which the pupil last studied', `${d.lastClass} (${d.lastClassWords})`],
    ['School / board annual examination last taken with result', d.lastExam || '—'],
    ['Whether failed, if so once / twice in the same class', d.failedInClass || 'No'],
    ['Subjects studied', d.subjects || '—'],
    ['Whether qualified for promotion to the higher class', d.qualifiedForPromotion || '—'],
    ['Month up to which the pupil has paid school dues', d.feesPaidUpTo || '—'],
    ['Any fee concession availed', d.feeConcession || 'No'],
    ['Total number of working days', d.workingDays || '—'],
    ['Total number of working days present', d.presentDays || '—'],
    ['Whether NCC cadet / Boy Scout / Girl Guide', d.nccScoutGuide || 'No'],
    ['Games played or extra-curricular activities', d.gamesActivities || '—'],
    ['General conduct', d.conduct],
    ['Date of application for certificate', dmyDate(d.applicationDate)],
    ['Date of issue of certificate', dmyDate(d.issueDate)],
    ['Reason for leaving the school', d.leavingReason],
  ];
  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-[13px] mb-4 font-sans">
        <span>
          Admission No.: <b>{d.admissionNo}</b>
        </span>
        <span>
          S.R. No.: <b>{d.srNo || '—'}</b>
        </span>
        <span>
          PEN: <b>{d.penNo || '—'}</b>
        </span>
      </div>
      <table className="w-full text-[13.5px]">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={label} className="align-top">
              <td className="w-7 py-1">{i + 1}.</td>
              <td className="w-[46%] py-1 pr-3">{label}</td>
              <td className="py-1 font-semibold border-b border-dotted border-gray-400">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ParagraphBody({ type, d }: { type: Exclude<CertType, 'TC'>; d: CertSnapshot }) {
  const { data: school } = useSchool();
  const g = genderWords(d.gender);
  const parents = [d.fatherName && `Shri ${d.fatherName}`, d.motherName && `Smt. ${d.motherName}`].filter(Boolean).join(' and ');
  const who = (
    <>
      <b>{d.studentName}</b>, {g.child} of {parents || '—'}
    </>
  );
  const dob = (
    <>
      <b>{dmyDate(d.dob)}</b> ({d.dobWords})
    </>
  );
  const schoolName = school?.name ?? 'this school';
  return (
    <div className="space-y-4 text-justify mt-6">
      <p className="text-center font-bold tracking-[0.2em] mb-6">TO WHOMSOEVER IT MAY CONCERN</p>
      {type === 'CC' && (
        <>
          <p>
            This is to certify that {who}, Admission No. <b>{d.admissionNo}</b>, was a bonafide student of {schoolName} from <b>{dmyDate(d.studiedFrom)}</b>{' '}
            to <b>{dmyDate(d.studiedTo)}</b> and studied up to Class <b>{d.className}</b>. {g.His} date of birth as per the school records is {dob}.
          </p>
          <p>
            During this period {g.his} conduct and character were <b>{d.conduct}</b>. {g.He} bears a good moral character. We wish {g.him} success in life.
          </p>
        </>
      )}
      {type === 'DOB' && (
        <>
          <p>
            This is to certify that {who}, Admission No. <b>{d.admissionNo}</b>
            {d.srNo && (
              <>
                , S.R. No. <b>{d.srNo}</b>
              </>
            )}
            , {d.currentStudent ? 'is a student of' : 'was a student of'} {schoolName}
            {d.className && (
              <>
                {' '}
                ({d.currentStudent ? 'studying' : 'last studied'} in Class <b>{d.className}</b>)
              </>
            )}
            .
          </p>
          <p>As per the admission register of the school, {g.his} date of birth is {dob}.</p>
          {d.purpose && <p>This certificate is issued on request for the purpose of {d.purpose}.</p>}
        </>
      )}
      {type === 'BONAFIDE' && (
        <>
          <p>
            This is to certify that {who}, Admission No. <b>{d.admissionNo}</b>, is a bonafide student of {schoolName}, studying in Class{' '}
            <b>{d.className}</b> during the academic session <b>{d.session}</b>.
          </p>
          <p>{g.His} date of birth as per the school records is {dob}.</p>
          <p>
            This certificate is issued on {g.his} request{d.purpose ? <> for the purpose of {d.purpose}</> : ''}.
          </p>
        </>
      )}
    </div>
  );
}
