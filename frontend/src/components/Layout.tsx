import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  Cog,
  Download,
  LayoutDashboard,
  LogOut,
  Package,
  Server as ServerIcon,
  Sparkles,
  Terminal,
  Users,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface LayoutProps {
  onLogout: () => void;
}

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/wizard', icon: Sparkles, label: 'Setup wizard' },
  { to: '/console', icon: Terminal, label: 'Console' },
  { to: '/monitoring', icon: Activity, label: 'Monitoring' },
  { to: '/servers', icon: ServerIcon, label: 'Profiles' },
  { to: '/install', icon: Download, label: 'Install' },
  { to: '/config', icon: Cog, label: 'Config' },
  { to: '/players', icon: Users, label: 'Players' },
  { to: '/mods', icon: Package, label: 'Mods' },
  { to: '/saves', icon: Archive, label: 'Saves' },
];

interface ProfilesResponse {
  activeServer: string;
}

export function Layout({ onLogout }: LayoutProps): JSX.Element {
  const active = useQuery({
    queryKey: ['active-server'],
    queryFn: () => api<ProfilesResponse>('/api/servers'),
    refetchInterval: 10_000,
    retry: (count, err) => !(err instanceof ApiError) && count < 1,
  });

  function logout(): void {
    clearToken();
    onLogout();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-16 items-center border-b border-border px-6">
          <span className="text-lg font-bold tracking-tight">zombadwin</span>
        </div>
        <div className="border-b border-border px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Active profile
          </p>
          <p className="truncate font-mono text-sm font-medium">
            {active.data?.activeServer ?? '—'}
          </p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
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
        <div className="border-t border-border p-3">
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
