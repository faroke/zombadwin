import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  Cog,
  Download,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Package,
  Server as ServerIcon,
  Sparkles,
  Sparkle,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
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

interface UpdateCheckResponse {
  current: string;
  latest: string | null;
  newer: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  cached: boolean;
  fetchedAt: number;
  error: string | null;
}

const DISMISSED_UPDATE_KEY = 'zombadwin:dismissedUpdate';

export function Layout({ onLogout }: LayoutProps): JSX.Element {
  const active = useQuery({
    queryKey: ['active-server'],
    queryFn: () => api<ProfilesResponse>('/api/servers'),
    refetchInterval: 10_000,
    retry: (count, err) => !(err instanceof ApiError) && count < 1,
  });
  const updates = useQuery({
    queryKey: ['updates-check'],
    queryFn: () => api<UpdateCheckResponse>('/api/updates/check'),
    // Backend caches for an hour anyway — no need to refetch more often.
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // Per-version dismissal: hiding the banner for v0.3.0 should NOT silence
  // v0.3.1 a week later. Stored as the literal version string the user
  // dismissed; the banner reads it once at mount and won't re-show until
  // the user reloads (intentional — keeps the page calm during a session).
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISSED_UPDATE_KEY);
    } catch {
      return null;
    }
  });

  function logout(): void {
    clearToken();
    onLogout();
  }

  const update = updates.data;
  const showBanner =
    !!update?.newer && !!update.latest && dismissedVersion !== update.latest;

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
        {showBanner && update && (
          <UpdateBanner
            update={update}
            onDismiss={() => {
              if (!update.latest) return;
              try {
                localStorage.setItem(DISMISSED_UPDATE_KEY, update.latest);
              } catch {
                /* localStorage may be disabled — banner just won't persist */
              }
              setDismissedVersion(update.latest);
            }}
          />
        )}
        <Outlet />
      </main>
    </div>
  );
}

function UpdateBanner({
  update,
  onDismiss,
}: {
  update: UpdateCheckResponse;
  onDismiss: () => void;
}): JSX.Element {
  // First line of release notes — the body is markdown but a short headline
  // is usually fine without rendering. Cap at ~120 chars so the banner stays
  // single-line on a 1200px viewport.
  const headline = update.releaseNotes
    ? update.releaseNotes.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? ''
    : '';
  const shortHeadline =
    headline.length > 120 ? headline.slice(0, 119).trimEnd() + '…' : headline;
  return (
    <div className="flex items-center gap-3 border-b border-primary/40 bg-primary/10 px-4 py-2 text-sm">
      <Sparkle className="h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1 truncate">
        <span className="font-semibold">Update available — v{update.latest}</span>
        <span className="ml-2 text-muted-foreground">
          (you're on v{update.current})
        </span>
        {shortHeadline && (
          <span className="ml-3 text-muted-foreground hidden md:inline">— {shortHeadline}</span>
        )}
      </div>
      {update.releaseUrl && (
        <a
          href={update.releaseUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-xs font-medium hover:bg-primary/20"
        >
          <ExternalLink className="h-3 w-3" /> View release
        </a>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Dismiss"
        title={`Hide until v${update.latest === null ? '' : 'a newer version'}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
