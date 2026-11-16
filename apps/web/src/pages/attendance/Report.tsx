import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, ErrorBox, Loading, PageHeader, Tag } from '../../components/ui';
import { GridCell, MonthNav } from '../../components/attendance';
import { monthStr } from '../../lib/utils';

interface Report {
  month: string;
  days: number;
  workingDays: number;
  section: { id: string; label: string };
  students: {
    studentId: string;
    rollNo: number | null;
    name: string;
    admissionNo: string;
    grid: Record<string, string>;
    totals: Record<string, number>;
    percent: number | null;
  }[];
}

export function AttendanceReportPage() {
  const { sectionId } = useParams();
  const [month, setMonth] = useState(monthStr());
  const q = useQuery({
    queryKey: ['att-report', sectionId, month],
    queryFn: async () => (await api.get<Report>(`/attendance/sections/${sectionId}/report`, { params: { month } })).data,
  });
  const r = q.data;

  return (
    <>
      <Link to={`/attendance/${sectionId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-4">
        <ArrowLeft className="size-4" /> Back to marking
      </Link>
      <PageHeader
        icon="📊"
        title={r ? `Attendance register · ${r.section.label}` : 'Attendance register'}
        description={r ? `${r.workingDays} working days recorded` : undefined}
        actions={<MonthNav month={month} onChange={setMonth} max={monthStr()} />}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr className="text-[12px] text-muted">
                <th className="sticky left-0 bg-white z-10 text-left font-normal px-3 py-2 border-b border-line min-w-44">Student</th>
                {Array.from({ length: r!.days }, (_, i) => (
                  <th key={i} className="font-normal px-0.5 py-2 border-b border-line w-7 text-center">
                    {i + 1}
                  </th>
                ))}
                <th className="font-normal px-2 py-2 border-b border-line">P</th>
                <th className="font-normal px-2 py-2 border-b border-line">A</th>
                <th className="font-normal px-3 py-2 border-b border-line text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {r!.students.map((s) => (
                <tr key={s.studentId} className="hover:bg-[#fafaf9]">
                  <td className="sticky left-0 bg-white z-10 px-3 py-1.5 border-b border-line whitespace-nowrap">
                    <span className="text-faint tabular-nums mr-2">{s.rollNo}</span>
                    <span className="font-medium text-ink-strong">{s.name}</span>
                  </td>
                  {Array.from({ length: r!.days }, (_, i) => (
                    <td key={i} className="px-0.5 py-1.5 border-b border-line text-center">
                      <GridCell v={s.grid[i + 1]} />
                    </td>
                  ))}
                  <td className="px-2 border-b border-line tabular-nums text-center">{s.totals.PRESENT + s.totals.LATE}</td>
                  <td className="px-2 border-b border-line tabular-nums text-center">{s.totals.ABSENT}</td>
                  <td className="px-3 border-b border-line text-right">
                    {s.percent == null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <Tag color={s.percent >= 90 ? 'green' : s.percent >= 75 ? 'yellow' : 'red'}>{s.percent}%</Tag>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
