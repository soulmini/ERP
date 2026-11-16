import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronsUpDown, LogOut, Menu } from 'lucide-react';
import type { Permission } from '@erp/shared';
import { useAuth, type Me } from '../lib/auth';
import { Avatar, Modal } from '../components/ui';
import { cn } from '../lib/utils';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  perms?: Permission[];
  staffOnly?: boolean;
  soon?: boolean;
  /** shown in the phone bottom bar */
  primary?: boolean;
  /** sidebar section heading */
  group?: string;
}

const HOME_PATHS = ['/admin', '/teacher', '/parent'];

export const NAV: Record<Me['view'], NavItem[]> = {
  admin: [
    { to: '/admin', label: 'Home', icon: '🏠', primary: true },

    { group: 'Daily', to: '/attendance', label: 'Student attendance', icon: '✅', perms: ['attendance.mark', 'attendance.view'], primary: true },
    { group: 'Daily', to: '/staff-attendance', label: 'Staff attendance', icon: '🕘', perms: ['staff-attendance.manage'] },
    { group: 'Daily', to: '/me/attendance', label: 'My attendance', icon: '📍', staffOnly: true },
    { group: 'Daily', to: '/homework', label: 'Homework', icon: '📒', perms: ['homework.manage'] },
    { group: 'Daily', to: '/notices', label: 'Notices & SMS', icon: '📣', perms: ['notices.manage'] },

    { group: 'Students', to: '/students', label: 'Students', icon: '🎒', perms: ['students.view'], primary: true },
    { group: 'Students', to: '/admissions', label: 'Admissions', icon: '📝', perms: ['students.manage'] },
    { group: 'Students', to: '/certificates', label: 'Certificates & cards', icon: '📜', perms: ['certificates.issue'] },

    { group: 'Academics', to: '/exams', label: 'Exams & results', icon: '🧾', perms: ['exams.manage', 'marks.enter'] },
    { group: 'Academics', to: '/timetable', label: 'Time table', icon: '🗓️', perms: ['timetable.manage'] },
    { group: 'Academics', to: '/academic', label: 'Classes & subjects', icon: '📚', perms: ['academic.manage'] },

    { group: 'Finance', to: '/fees', label: 'Fees', icon: '💰', perms: ['fees.view', 'fees.collect', 'fees.manage'], primary: true },
    { group: 'Finance', to: '/payroll', label: 'Salary', icon: '💼', perms: ['payroll.manage'] },
    { group: 'Finance', to: '/accounts', label: 'Accounts', icon: '📊', perms: ['accounts.manage'] },
    { group: 'Finance', to: '/inventory', label: 'Inventory', icon: '📦', perms: ['inventory.manage'] },

    { group: 'Admin', to: '/staff', label: 'Staff & users', icon: '👥', perms: ['users.view', 'users.manage'] },
    { group: 'Admin', to: '/roles', label: 'Roles & permissions', icon: '🔐', perms: ['roles.manage'] },
    { group: 'Admin', to: '/settings', label: 'School settings', icon: '🏫', perms: ['school.manage'] },

    { to: '/soon/reports', label: 'Reports', icon: '📈', perms: ['reports.view'], soon: true },
  ],
  teacher: [
    { to: '/teacher', label: 'Home', icon: '🏠', primary: true },
    { to: '/attendance', label: 'Mark attendance', icon: '✅', primary: true },
    { to: '/homework', label: 'Homework', icon: '📒', primary: true },
    { to: '/me/attendance', label: 'My attendance', icon: '📍', primary: true },
    { to: '/exams', label: 'Marks & exams', icon: '🧾' },
    { to: '/timetable', label: 'Time table', icon: '🗓️' },
    { to: '/notices', label: 'Notices', icon: '📣' },
    { to: '/students', label: 'My students', icon: '🎒', perms: ['students.view'] },
  ],
  parent: [
    { to: '/parent', label: 'Home', icon: '🏠', primary: true },
    { to: '/parent/attendance', label: 'Attendance', icon: '✅', primary: true },
    { to: '/homework', label: 'Homework', icon: '📒', primary: true },
    { to: '/fees', label: 'Fees', icon: '💰', primary: true },
    { to: '/exams', label: 'Results & admit card', icon: '🧾' },
    { to: '/timetable', label: 'Time table', icon: '🗓️' },
    { to: '/notices', label: 'Notices', icon: '📣' },
  ],
};

export function useNav() {
  const { user, can } = useAuth();
  if (!user) return [];
  return NAV[user.view].filter((i) => (!i.perms || can(...i.perms)) && (!i.staffOnly || user.staff));
}

function NavRow({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={HOME_PATHS.includes(item.to)}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 h-[30px] px-2 rounded-md text-[14px] transition-colors',
          isActive ? 'bg-active text-ink-strong font-medium' : 'text-[#5f5e5b] hover:bg-hover',
          item.soon && 'text-faint',
        )
      }
    >
      <span className="w-5 text-center text-[15px]">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function SchoolBadge({ user }: { user: Me }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover">
      {user.school.logoUrl ? (
        <img src={user.school.logoUrl} className="size-6 rounded object-cover" alt="" />
      ) : (
        <span className="size-6 rounded bg-ink-strong text-white text-[11px] font-bold flex items-center justify-center">
          {user.school.name.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink-strong truncate">{user.school.name}</div>
      </div>
      <ChevronsUpDown className="size-3.5 text-faint" />
    </div>
  );
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const live = items.filter((i) => !i.soon);
  const soon = items.filter((i) => i.soon);
  // Keep original order; emit a heading whenever the group changes.
  let lastGroup: string | undefined;
  return (
    <>
      <div className="space-y-px">
        {live.map((i) => {
          const heading = i.group && i.group !== lastGroup ? i.group : null;
          lastGroup = i.group;
          return (
            <div key={i.to}>
              {heading && <div className="px-2 pt-4 pb-1 text-xs font-medium text-faint">{heading}</div>}
              <NavRow item={i} onClick={onNavigate} />
            </div>
          );
        })}
      </div>
      {soon.length > 0 && (
        <>
          <div className="px-2 pt-4 pb-1 text-xs font-medium text-faint">Coming soon</div>
          <div className="space-y-px">
            {soon.map((i) => (
              <NavRow key={i.to} item={i} onClick={onNavigate} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function AccountRow({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;
  const role = user.kinds.includes('PRINCIPAL') ? 'Principal' : user.staff?.designation ?? (user.view === 'parent' ? 'Parent' : 'Staff');
  return (
    <div className="border-t border-line pt-2 mt-2 space-y-px">
      <button
        onClick={() => (nav('/profile'), onNavigate?.())}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover text-left"
      >
        <Avatar name={user.name} size={24} />
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-strong truncate">{user.name}</div>
          <div className="text-xs text-muted truncate">{role}</div>
        </div>
      </button>
      <button
        onClick={() => logout().then(() => nav('/login'))}
        className="w-full flex items-center gap-2 h-[30px] px-2 rounded-md text-sm text-[#5f5e5b] hover:bg-hover"
      >
        <LogOut className="size-4 mx-0.5" /> Log out
      </button>
    </div>
  );
}

export function AppShell() {
  const { user } = useAuth();
  const items = useNav();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  if (!user) return null;
  const primary = items.filter((i) => i.primary).slice(0, 4);

  return (
    <div className="h-full flex print:block print:h-auto">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar border-r border-line px-2 py-2 print:!hidden">
        <SchoolBadge user={user} />
        <nav className="flex-1 overflow-y-auto mt-1">
          <NavList items={items} />
        </nav>
        <AccountRow />
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col print:block">
        {/* Phone top bar */}
        <header className="md:hidden pt-safe border-b border-line bg-white/90 backdrop-blur sticky top-0 z-30 print:hidden">
          <div className="h-12 flex items-center gap-2 px-4">
            <span className="size-6 rounded bg-ink-strong text-white text-[11px] font-bold flex items-center justify-center">
              {user.school.name.slice(0, 1)}
            </span>
            <span className="font-semibold text-ink-strong truncate flex-1">{user.school.name}</span>
            <NavLink to="/profile" className="p-1">
              <Avatar name={user.name} size={26} />
            </NavLink>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto print:overflow-visible" key={loc.pathname}>
          <div className="max-w-5xl mx-auto px-4 md:px-12 py-6 md:py-12 pb-28 md:pb-12 print:p-0 print:max-w-none">
            <Outlet />
          </div>
        </main>

        {/* Phone bottom tabs */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-line pb-safe print:hidden">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, 1fr)` }}>
            {primary.map((i) => (
              <BottomTab key={i.to} to={i.to} icon={i.icon} label={i.label.replace('Student ', '').replace('Mark ', '')} />
            ))}
            <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted">
              <Menu className="size-5" />
              More
            </button>
          </div>
        </nav>
      </div>

      <Modal open={more} onClose={() => setMore(false)} title="Menu">
        <div className="pb-4">
          <NavList items={items} onNavigate={() => setMore(false)} />
          <AccountRow onNavigate={() => setMore(false)} />
        </div>
      </Modal>
    </div>
  );
}

function BottomTab({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end={HOME_PATHS.includes(to)}
      className={({ isActive }) =>
        cn('flex flex-col items-center gap-0.5 py-2 text-[11px] truncate', isActive ? 'text-ink-strong font-semibold' : 'text-muted')
      }
    >
      <span className="text-lg leading-5">{icon}</span>
      <span className="truncate max-w-full px-1 capitalize">{label}</span>
    </NavLink>
  );
}
