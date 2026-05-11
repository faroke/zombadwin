import { useQuery } from '@tanstack/react-query';
import { Activity, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';

interface Health {
  ok: boolean;
  name: string;
  version: string;
  time: string;
}

interface DashboardProps {
  onLogout: () => void;
}

export function Dashboard({ onLogout }: DashboardProps): JSX.Element {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/api/health'),
    refetchInterval: 5000,
  });

  function logout(): void {
    clearToken();
    onLogout();
  }

  return (
    <div className="container mx-auto p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">zombadwin</h1>
          <p className="text-sm text-muted-foreground">
            Project Zomboid server administration
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Backend</CardTitle>
              <Activity
                className={`h-4 w-4 ${
                  health.data?.ok ? 'text-primary' : 'text-muted-foreground'
                }`}
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
            <CardTitle className="text-base">Server</CardTitle>
            <CardDescription>Not implemented yet</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Start/stop controls land in the next milestone.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Players</CardTitle>
            <CardDescription>Not implemented yet</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">—</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
