import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { ServerControls } from '@/components/ServerControls';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import type { StatusSnapshot } from '@/lib/ws';

interface Health {
  ok: boolean;
  name: string;
  version: string;
  time: string;
}

export function Dashboard(): JSX.Element {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/api/health'),
    refetchInterval: 5000,
  });
  const status = useQuery({
    queryKey: ['server-status'],
    queryFn: () => api<StatusSnapshot>('/api/server/status'),
    refetchInterval: 3000,
  });

  return (
    <div className="container mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Server overview and quick controls</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Server</CardTitle>
              {status.data && <StatusBadge state={status.data.state} />}
            </div>
            <CardDescription>
              {status.data?.installDir ?? 'Not installed — visit Install'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {status.data && <ServerControls state={status.data.state} />}
            <p className="text-xs text-muted-foreground">
              {status.data?.pid ? `pid ${status.data.pid}` : 'not running'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Backend</CardTitle>
              <Activity
                className={`h-4 w-4 ${health.data?.ok ? 'text-primary' : 'text-muted-foreground'}`}
              />
            </div>
            <CardDescription>
              {health.isLoading
                ? 'Connecting…'
                : health.isError
                  ? 'Unreachable'
                  : `v${health.data?.version}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Last ping: {health.data?.time ?? '—'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Players</CardTitle>
            <CardDescription>Coming soon</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">—</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
