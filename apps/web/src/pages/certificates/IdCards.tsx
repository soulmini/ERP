import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../../lib/api';
import { sectionOptions, useClasses } from '../../lib/queries';
import { Button, Empty, ErrorBox, Loading, PageHeader, Select, Tabs } from '../../components/ui';
import { useSchool } from '../../components/print';
import { fmtDate, initials } from '../../lib/utils';

interface StudentCard {
  id: string;
  name: string;
  classLabel: string | null;
  rollNo: number | null;
  admissionNo: string;
  dob: string;
  bloodGroup: string | null;
  fatherName: string;
  phone: string;
  address: string;
  photoUrl: string | null;
}
interface StaffCard {
  id: string;
  name: string;
  designation: string;
  employeeCode: string;
  phone: string;
  address: string | null;
  photoUrl: string | null;
}

export function IdCardsPage() {
  const [tab, setTab] = useState<'students' | 'staff'>('students');
  const classes = useClasses();
  const options = sectionOptions(classes.data);
  const [sectionId, setSectionId] = useState('');
  const students = useQuery({
    queryKey: ['id-cards', 'students', sectionId],
    enabled: tab === 'students' && !!sectionId,
    queryFn: async () => (await api.get<{ session: string; cards: StudentCard[] }>('/certificates/id-cards/students', { params: { sectionId } })).data,
  });
  const staff = useQuery({
    queryKey: ['id-cards', 'staff'],
    enabled: tab === 'staff',
    queryFn: async () => (await api.get<{ session: string; cards: StaffCard[] }>('/certificates/id-cards/staff')).data,
  });
  const q = tab === 'students' ? students : staff;

  return (
    <>
      <div className="no-print">
        <Link to="/certificates" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
          <ArrowLeft className="size-4" /> Certificates
        </Link>
        <PageHeader icon="🪪" title="I-cards" description="Prints 9 cards per A4 sheet (54 × 86 mm). Add student photos from the student profile." />
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'students', label: 'Students' },
            { value: 'staff', label: 'Staff' },
          ]}
        />
        <div className="flex flex-wrap gap-2 mb-4">
          {tab === 'students' && (
            <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-auto min-w-40">
              <option value="">Select class…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  Class {o.label}
                </option>
              ))}
            </Select>
          )}
          <Button variant="primary" icon={<Printer className="size-4" />} disabled={!q.data?.cards.length} onClick={() => window.print()}>
            Print cards
          </Button>
        </div>
      </div>
      {tab === 'students' && !sectionId ? (
        <Empty icon="🪪" title="Choose a class to print its I-cards" />
      ) : q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data!.cards.length ? (
        <Empty title="No students in this class" />
      ) : (
        <div className="flex flex-wrap gap-3 print:gap-[3mm] justify-center print:justify-start">
          {tab === 'students'
            ? (q.data as { session: string; cards: StudentCard[] }).cards.map((c) => <StudentId key={c.id} c={c} session={q.data!.session} />)
            : (q.data as { session: string; cards: StaffCard[] }).cards.map((c) => <StaffId key={c.id} c={c} session={q.data!.session} />)}
        </div>
      )}
    </>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  const { data: school } = useSchool();
  return (
    <div className="w-[54mm] h-[86mm] rounded-[3mm] border border-[#d3d3d0] bg-white overflow-hidden flex flex-col text-black break-inside-avoid font-sans">
      <div className="bg-[#1f3a5f] text-white px-[2.5mm] py-[2mm] flex items-center gap-[2mm]">
        {school?.logoUrl ? (
          <img src={school.logoUrl} className="size-[8mm] rounded bg-white object-contain" alt="" />
        ) : (
          <span className="size-[8mm] rounded bg-white text-[#1f3a5f] font-bold flex items-center justify-center text-[11px]">{school?.name.slice(0, 1)}</span>
        )}
        <div className="min-w-0 leading-tight">
          <div className="text-[8.5px] font-bold uppercase truncate">{school?.name}</div>
          <div className="text-[6.5px] opacity-80 truncate">{[school?.city, school?.state].filter(Boolean).join(', ')}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Photo({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img src={url} alt="" className="w-[20mm] h-[24mm] object-cover rounded-[1.5mm] border border-[#d3d3d0]" />
  ) : (
    <div className="w-[20mm] h-[24mm] rounded-[1.5mm] border border-dashed border-[#b0b0ad] bg-[#f7f7f5] flex items-center justify-center text-[14px] font-semibold text-[#9b9a97]">
      {initials(name)}
    </div>
  );
}

const Line = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-[1mm] text-[7.5px] leading-[1.35]">
    <span className="w-[13mm] shrink-0 text-[#666]">{k}</span>
    <span className="font-medium truncate">{v || '—'}</span>
  </div>
);

function StudentId({ c, session }: { c: StudentCard; session: string }) {
  return (
    <CardShell>
      <div className="flex flex-col items-center pt-[2.5mm] px-[2.5mm] flex-1">
        <Photo url={c.photoUrl} name={c.name} />
        <div className="text-[10px] font-bold mt-[1.5mm] text-center leading-tight">{c.name}</div>
        <div className="text-[7.5px] text-[#1f3a5f] font-semibold mb-[1.5mm]">
          Class {c.classLabel}
          {c.rollNo ? ` · Roll ${c.rollNo}` : ''}
        </div>
        <div className="w-full">
          <Line k="Adm. no." v={c.admissionNo} />
          <Line k="DOB" v={fmtDate(c.dob)} />
          <Line k="Father" v={c.fatherName} />
          <Line k="Phone" v={c.phone} />
          <Line k="Blood gr." v={c.bloodGroup} />
        </div>
      </div>
      <div className="flex items-end justify-between px-[2.5mm] pb-[2mm]">
        <QRCodeSVG value={JSON.stringify({ a: c.admissionNo, n: c.name })} size={40} />
        <div className="text-right">
          <div className="text-[6px] text-[#666]">Valid for {session}</div>
          <div className="border-t border-black w-[18mm] mt-[4mm] text-[6px] text-center">Principal</div>
        </div>
      </div>
    </CardShell>
  );
}

function StaffId({ c, session }: { c: StaffCard; session: string }) {
  return (
    <CardShell>
      <div className="flex flex-col items-center pt-[2.5mm] px-[2.5mm] flex-1">
        <Photo url={c.photoUrl} name={c.name} />
        <div className="text-[10px] font-bold mt-[1.5mm] text-center leading-tight">{c.name}</div>
        <div className="text-[7.5px] text-[#1f3a5f] font-semibold mb-[1.5mm]">{c.designation}</div>
        <div className="w-full">
          <Line k="Emp. code" v={c.employeeCode} />
          <Line k="Phone" v={c.phone} />
          <Line k="Address" v={c.address} />
        </div>
      </div>
      <div className="flex items-end justify-between px-[2.5mm] pb-[2mm]">
        <QRCodeSVG value={JSON.stringify({ e: c.employeeCode, n: c.name })} size={40} />
        <div className="text-right">
          <div className="text-[6px] text-[#666]">Session {session}</div>
          <div className="border-t border-black w-[18mm] mt-[4mm] text-[6px] text-center">Principal</div>
        </div>
      </div>
    </CardShell>
  );
}
