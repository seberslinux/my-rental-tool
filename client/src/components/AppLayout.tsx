import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard, Calendar, Users, BarChart3, Building2, MoreHorizontal,
  LogOut, DollarSign, Wrench, UserCog, Settings, Star,
  ChevronLeft,
} from 'lucide-react';
import { useState } from 'react';

const mainNav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/calendar', icon: Calendar, label: 'Calendar' },
  { to: '/cleaners', icon: Users, label: 'Cleaners' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/properties', icon: Building2, label: 'Properties' },
  { to: '/more', icon: MoreHorizontal, label: 'More' },
];

const moreNav = [
  { to: '/finances', icon: DollarSign, label: 'Finances' },
  { to: '/maintenance', icon: Wrench, label: 'Maintenance' },
  { to: '/users', icon: UserCog, label: 'Users' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/reviews', icon: Star, label: 'Reviews' },
];

function NavItem({ to, icon: Icon, label, collapsed }: { to: string; icon: typeof LayoutDashboard; label: string; collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-primary-600 text-white'
            : 'text-gray-300 hover:bg-gray-800 hover:text-white'
        } ${collapsed ? 'justify-center' : ''}`
      }
    >
      <Icon size={20} />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const isMoreSection = ['/finances', '/maintenance', '/users', '/settings', '/reviews'].includes(location.pathname);

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar — hidden on mobile */}
      <aside className={`hidden md:flex flex-col bg-gray-900 transition-all ${collapsed ? 'w-16' : 'w-60'} flex-shrink-0`}>
        <div className={`flex items-center gap-2 px-4 h-16 border-b border-gray-800 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">R</div>
          {!collapsed && <span className="text-white font-semibold text-lg">Rental Tool</span>}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {mainNav.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}

          {isMoreSection && (
            <>
              <div className={`border-t border-gray-800 my-3 ${collapsed ? 'mx-1' : ''}`} />
              {moreNav.map((item) => (
                <NavItem key={item.to} {...item} collapsed={collapsed} />
              ))}
            </>
          )}
        </nav>

        <div className="p-3 border-t border-gray-800">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-full p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft size={18} className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
          </button>
          <div className={`flex items-center gap-3 mt-2 px-2 ${collapsed ? 'justify-center' : ''}`}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full" />
            ) : (
              <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                {user?.name?.charAt(0) || '?'}
              </div>
            )}
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.name}</p>
                <p className="text-xs text-gray-400 truncate">{user?.email || user?.role}</p>
              </div>
            )}
            <button onClick={logout} className="text-gray-400 hover:text-white" title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-y-auto pb-20 md:pb-6">
          {children}
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex z-50">
          {mainNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2 text-xs font-medium ${
                  isActive ? 'text-primary-600' : 'text-gray-500'
                }`
              }
            >
              <Icon size={20} />
              <span className="mt-0.5">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
