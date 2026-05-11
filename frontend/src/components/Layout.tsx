import { Cog, Download, LayoutDashboard, LogOut, Package, Terminal, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { clearToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface LayoutProps {
  onLogout: () => void;
}

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/console', icon: Terminal, label: 'Console' },
  { to: '/install', icon: Download, label: 'Install' },
  { to: '/config', icon: Cog, label: 'Config' },
  { to: '/players', icon: Users, label: 'Players' },
  { to: '/mods', icon: Package, label: 'Mods' },
];

export function Layout({ onLogout }: LayoutProps): JSX.Element {
  function logout(): void {
    clearToken();
    onLogout();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border bg-card">
        <div className="flex h-16 items-center border-b border-border px-6">
          <span className="text-lg font-bold tracking-tight">zombadwin</span>
        </div>
        <nav className="space-y-1 p-3">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-3 w-56 px-3">
          <Button variant="ghost" size="sm" onClick={logout} className="w-full justify-start">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
