import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Play, RotateCw, Square } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import type { ServerState, StatusSnapshot } from '@/lib/ws';

interface ServerControlsProps {
  state: ServerState;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
}

function extractMessage(err: Error): string {
  if (err instanceof ApiError) {
    const body = err.body as ApiErrorBody | undefined;
    if (body?.message) return body.message;
    return `HTTP ${err.status}`;
  }
  return err.message;
}

export function ServerControls({ state }: ServerControlsProps): JSX.Element {
  const qc = useQueryClient();
  const [lastError, setLastError] = useState<string | null>(null);

  function clearAfter(ms: number): () => void {
    const t = setTimeout(() => setLastError(null), ms);
    return () => clearTimeout(t);
  }

  const start = useMutation({
    mutationFn: () => api<StatusSnapshot>('/api/server/start', { method: 'POST' }),
    onSuccess: () => {
      setLastError(null);
      void qc.invalidateQueries({ queryKey: ['server-status'] });
    },
    onError: (err: Error) => {
      setLastError(extractMessage(err));
      clearAfter(15_000);
    },
  });
  const stop = useMutation({
    mutationFn: () => api<StatusSnapshot>('/api/server/stop', { method: 'POST' }),
    onSuccess: () => {
      setLastError(null);
      void qc.invalidateQueries({ queryKey: ['server-status'] });
    },
    onError: (err: Error) => {
      setLastError(extractMessage(err));
      clearAfter(15_000);
    },
  });
  const restart = useMutation({
    mutationFn: () => api<StatusSnapshot>('/api/server/restart', { method: 'POST' }),
    onSuccess: () => {
      setLastError(null);
      void qc.invalidateQueries({ queryKey: ['server-status'] });
    },
    onError: (err: Error) => {
      setLastError(extractMessage(err));
      clearAfter(15_000);
    },
  });

  const canStart = state === 'stopped';
  const canStop = state === 'running' || state === 'starting';
  const canRestart = state === 'running';

  return (
    <div className="space-y-2">
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
      {lastError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-snug">{lastError}</span>
        </div>
      )}
    </div>
  );
}
