import { useParams } from 'react-router-dom';
import { Card, PageHeader, Tag } from '../components/ui';

const INFO: Record<string, { icon: string; title: string; phase: number; points: string[] }> = {
  admission: { icon: '📝', title: 'Admissions', phase: 2, points: ['Enquiry register', 'Full admission form with documents & photo', 'Excel import', 'Year-end promotion'] },
  fees: { icon: '💰', title: 'Fees & receipts', phase: 3, points: ['Fee heads & class-wise structure', 'Collection with printable receipt', 'Dues & defaulter SMS', 'Online payment for parents'] },
  homework: { icon: '📒', title: 'Homework', phase: 4, points: ['Teachers post homework with photos/PDF', 'Parents see it in the app', 'Push notification'] },
  timetable: { icon: '🗓️', title: 'Time table', phase: 4, points: ['Class & teacher time tables', 'Clash detection', 'Substitution'] },
  notices: { icon: '📣', title: 'Notices & SMS', phase: 4, points: ['Circulars to classes / all parents', 'Absent SMS to parents', 'Holiday calendar'] },
  exams: { icon: '🧾', title: 'Exams & marksheets', phase: 5, points: ['Exam plan & date sheet', 'Marks entry by teachers', 'Report card PDF'] },
  marks: { icon: '🧾', title: 'Marks entry', phase: 5, points: ['Enter marks subject-wise', 'Grades & remarks'] },
  results: { icon: '🧾', title: 'Results & admit card', phase: 5, points: ['Download admit card', 'View & download report card'] },
  certificates: { icon: '📜', title: 'TC, CC, DOB certificates', phase: 6, points: ['Transfer, character, DOB, bonafide', 'Serial numbers & issue register', 'Print-ready PDF with logo'] },
  cards: { icon: '🪪', title: 'I-card, admit card, gate pass', phase: 6, points: ['Bulk I-cards with photo & QR', 'Admit cards per exam', 'Gate pass log'] },
  salary: { icon: '💼', title: 'Salary', phase: 7, points: ['Salary structure', 'Monthly payroll from staff attendance', 'Payslip PDF'] },
  accounts: { icon: '📊', title: 'Accounts & inventory', phase: 7, points: ['Income / expense ledger', 'Day book', 'Stock in / out'] },
  reports: { icon: '📈', title: 'Reports', phase: 8, points: ['Custom report builder', 'Excel & PDF export'] },
};

export function ComingSoonPage() {
  const { key = '' } = useParams();
  const i = INFO[key] ?? { icon: '🚧', title: 'Coming soon', phase: 0, points: [] };
  return (
    <>
      <PageHeader icon={i.icon} title={i.title} description={i.phase ? <Tag color="yellow">Planned · Phase {i.phase}</Tag> : undefined} />
      <Card className="p-5 max-w-lg">
        <div className="text-sm text-muted mb-2">What this module will include</div>
        <ul className="space-y-1.5">
          {i.points.map((p) => (
            <li key={p} className="flex gap-2 text-sm">
              <span className="text-faint">•</span>
              {p}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
