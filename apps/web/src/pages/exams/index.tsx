import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ExamsHome } from './Home';
import { ExamPage } from './Exam';
import { MarksEntryPage } from './Marks';
import { RemarksPage } from './Remarks';
import { ResultsPage } from './Results';
import { ReportCardsPage } from './ReportCard';
import { AdmitCardsPage } from './AdmitCard';
import { GradeScalePage } from './Grades';
import { ParentExams } from './Parent';

/**
 * Exams & results. Mounted at /exams/* for all views.
 *  - Admin (exams.manage): exams, date sheets, grade scale, publish, results, report & admit cards.
 *  - Teacher (marks.enter): marks entry for own class / subjects; results, remarks & cards for own class.
 *  - Parent: date sheets, admit cards, published report cards of their children.
 */
export function ExamsModule() {
  const { user } = useAuth();
  const parent = user?.view === 'parent';
  return (
    <Routes>
      <Route index element={parent ? <ParentExams /> : <ExamsHome />} />
      <Route path=":examId/report-cards" element={<ReportCardsPage />} />
      <Route path=":examId/admit-cards" element={<AdmitCardsPage />} />
      {!parent && (
        <>
          <Route path="grades" element={<GradeScalePage />} />
          <Route path=":examId" element={<ExamPage />} />
          <Route path=":examId/marks" element={<MarksEntryPage />} />
          <Route path=":examId/remarks" element={<RemarksPage />} />
          <Route path=":examId/results" element={<ResultsPage />} />
        </>
      )}
      <Route path="*" element={<Navigate to="/exams" replace />} />
    </Routes>
  );
}
