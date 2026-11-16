import { Link, Route, Routes } from 'react-router-dom';
import { CERT_META, CERT_TYPES } from '@erp/shared';
import { Card, PageHeader } from '../../components/ui';
import { IssuePage } from './Issue';
import { CertificateView } from './View';
import { RegisterPage } from './Register';
import { IdCardsPage } from './IdCards';
import { GatePassPage, GatePassPrint } from './GatePass';

/** Certificates & cards module. Mounted at /certificates/*. */
export function CertificatesModule() {
  return (
    <Routes>
      <Route index element={<Hub />} />
      <Route path="register" element={<RegisterPage />} />
      <Route path="view/:id" element={<CertificateView />} />
      <Route path="id-cards" element={<IdCardsPage />} />
      <Route path="gate-pass" element={<GatePassPage />} />
      <Route path="gate-pass/:id" element={<GatePassPrint />} />
      <Route path=":slug/new" element={<IssuePage />} />
    </Routes>
  );
}

function Hub() {
  const tiles = [
    ...CERT_TYPES.map((t) => ({ to: `/certificates/${CERT_META[t].slug}/new`, icon: CERT_META[t].icon, title: CERT_META[t].title, sub: CERT_META[t].description })),
    { to: '/certificates/id-cards', icon: '🪪', title: 'I-cards', sub: 'Student and staff ID cards with photo and QR code, 9 per page.' },
    { to: '/certificates/gate-pass', icon: '🚪', title: 'Gate pass', sub: 'Early leave for students and visitor entry slips.' },
    { to: '/certificates/register', icon: '📚', title: 'Issue register', sub: 'Every certificate issued, reprint or cancel.' },
  ];
  return (
    <>
      <PageHeader icon="📜" title="Certificates & cards" description="Everything is pre-filled from school records — check, edit if needed, and print." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to}>
            <Card className="p-4 h-full hover:bg-[#fafaf9] transition-colors">
              <div className="text-2xl">{t.icon}</div>
              <div className="font-semibold text-ink-strong mt-2">{t.title}</div>
              <div className="text-sm text-muted mt-0.5">{t.sub}</div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
