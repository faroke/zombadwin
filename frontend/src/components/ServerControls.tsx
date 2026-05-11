import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { ServerState, StatusSnapshot } from '@/lib/ws';

interface ServerControlsProps {
  state: ServerState;
}

export function ServerControls({ state }: ServerControlsProps): JSX.Element {
  const qc = useQueryClient();

  const start = useMutation({
    mutationFn: () => api<StatusSnapshot>('/api/server/start', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });
  const stop = useMutation({
    mutationFn: () => api<StatusSnapshot>('/api/server/stop', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });
  const restart = useMutation({
    mutationFn: () => api<StatusSnapshot>('/api/server/restart', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });

  const canStart = state === 'stopped';
  const canStop = state === 'running' || state === 'starting';
  const canRestart = state === 'running';

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => start.mutate()} disabled={!canStart || start.isPending}>
        <Play className="mr-2 h-4 w-4" />
        Start
      </Button>
      <Button
        variant="outline"
        onClick={() => restart.mutate()}
        disabled={!canRestart || restart.isPending}
      >
        <RotateCw className="mr-2 h-4 w-4" />
        Restart
      </Button>
      <Button
        variant="destructive"
        onClick={() => stop.mutate()}
        disabled={!canStop || stop.isPending}
      >
        <Square className="mr-2 h-4 w-4" />
        Stop
      </Button>
    </div>
  );
}
