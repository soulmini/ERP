import { Navigate, Route, Routes } from 'react-router-dom';
import { Card, PageHeader } from '../../components/ui';
import { useFeePerms } from './common';
import { FeesHome, StudentFeesPage } from './Collect';
import { ReceiptPage } from './Receipt';
import { ReceiptsPage, ReportsPage } from './Reports';
import { SetupPage } from './Setup';
import { ParentFees } from './Parent';

/** Fees module, mounted at /fees/* for all three views; what shows depends on role & permissions. */
export function FeesModule() {
  const p = useFeePerms();

  if (p.isParent) {
    return (
      <Routes>
        <Route index element={<ParentFees />} />
        <Route path="receipt/:id" element={<ReceiptPage />} />
        <Route path="*" element={<Navigate to="/fees" replace />} />
      </Routes>
    );
  }

  if (!p.any) return <NoFeeAccess />;

  return (
    <Routes>
      <Route index element={<FeesHome />} />
      <Route path="student/:id" element={<StudentFeesPage />} />
      <Route path="receipt/:id" element={<ReceiptPage />} />
      {(p.view || p.collect) && <Route path="receipts" element={<ReceiptsPage />} />}
      {p.view && <Route path="reports" element={<ReportsPage />} />}
      {p.manage && <Route path="setup" element={<SetupPage />} />}
      <Route path="*" element={<Navigate to="/fees" replace />} />
    </Routes>
  );
}

function NoFeeAccess() {
  return (
    <>
      <PageHeader icon="💰" title="Fees" />
      <Card className="p-8 text-center max-w-md mx-auto">
        <div className="text-4xl mb-3">🏫</div>
        <div className="font-semibold text-ink-strong text-lg">Fees are managed by the school office</div>
        <p className="text-sm text-muted mt-2">
          Fee collection, receipts and dues are handled by the office staff. If a parent asks about fees, please direct them to the office or
          the Principal.
        </p>
      </Card>
    </>
  );
}
