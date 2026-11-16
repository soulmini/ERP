import { Navigate, Outlet, createBrowserRouter, createHashRouter, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { homePath, useAuth, type View } from './lib/auth';
import { AppShell } from './layouts/AppShell';
import { LoginPage } from './pages/Login';
import { AdminDashboard } from './pages/admin/Dashboard';
import { SettingsPage } from './pages/admin/Settings';
import { AcademicPage } from './pages/admin/Academic';
import { StaffPage } from './pages/admin/Staff';
import { RolesPage } from './pages/admin/Roles';
import { StaffAttendancePage } from './pages/admin/StaffAttendance';
import { AttendanceSectionsPage } from './pages/attendance/Sections';
import { MarkAttendancePage } from './pages/attendance/Mark';
import { AttendanceReportPage } from './pages/attendance/Report';
import { MyAttendancePage } from './pages/attendance/MyAttendance';
import { TeacherDashboard } from './pages/teacher/Dashboard';
import { ParentHome } from './pages/parent/Home';
import { ParentAttendance } from './pages/parent/Attendance';
import { ProfilePage } from './pages/Profile';
import { ComingSoonPage } from './pages/ComingSoon';
import { StudentsModule } from './pages/students';
import { AdmissionsModule } from './pages/admissions';
import { FeesModule } from './pages/fees';
import { HomeworkModule } from './pages/homework';
import { NoticesModule } from './pages/notices';
import { TimetableModule } from './pages/timetable';
import { ExamsModule } from './pages/exams';
import { CertificatesModule } from './pages/certificates';
import { PayrollModule } from './pages/payroll';
import { AccountsModule } from './pages/accounts';
import { InventoryModule } from './pages/inventory';

function RequireAuth() {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

function RequireView({ views }: { views: View[] }) {
  const { user } = useAuth();
  if (user && !views.includes(user.view)) return <Navigate to={homePath(user.view)} replace />;
  return <Outlet />;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homePath(user.view) : '/login'} replace />;
}

const routes = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Home /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/soon/:key', element: <ComingSoonPage /> },
          // Modules used by all three views; each module decides what to show per role.
          { path: '/fees/*', element: <FeesModule /> },
          { path: '/homework/*', element: <HomeworkModule /> },
          { path: '/notices/*', element: <NoticesModule /> },
          { path: '/timetable/*', element: <TimetableModule /> },
          { path: '/exams/*', element: <ExamsModule /> },
          {
            element: <RequireView views={['admin']} />,
            children: [
              { path: '/admin', element: <AdminDashboard /> },
              { path: '/settings', element: <SettingsPage /> },
              { path: '/academic', element: <AcademicPage /> },
              { path: '/staff', element: <StaffPage /> },
              { path: '/roles', element: <RolesPage /> },
              { path: '/staff-attendance', element: <StaffAttendancePage /> },
              { path: '/admissions/*', element: <AdmissionsModule /> },
              { path: '/certificates/*', element: <CertificatesModule /> },
              { path: '/payroll/*', element: <PayrollModule /> },
              { path: '/accounts/*', element: <AccountsModule /> },
              { path: '/inventory/*', element: <InventoryModule /> },
            ],
          },
          {
            element: <RequireView views={['admin', 'teacher']} />,
            children: [
              { path: '/teacher', element: <TeacherDashboard /> },
              { path: '/students/*', element: <StudentsModule /> },
              { path: '/attendance', element: <AttendanceSectionsPage /> },
              { path: '/attendance/:sectionId', element: <MarkAttendancePage /> },
              { path: '/attendance/:sectionId/report', element: <AttendanceReportPage /> },
              { path: '/me/attendance', element: <MyAttendancePage /> },
            ],
          },
          {
            element: <RequireView views={['parent']} />,
            children: [
              { path: '/parent', element: <ParentHome /> },
              { path: '/parent/attendance', element: <ParentAttendance /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Home /> },
];

// Native apps load from a local file origin → hash routing avoids 404s on deep links.
export const router = Capacitor.isNativePlatform() ? createHashRouter(routes) : createBrowserRouter(routes);
