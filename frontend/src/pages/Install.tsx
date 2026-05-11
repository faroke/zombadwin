import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Folder, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

type InstallState =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'installing'
  | 'done'
  | 'error'
  | 'cancelled';

interface InstallLog {
  id: number;
  ts: number;
  source: 'out' | 'err' | 'sys';
  text: string;
}

interface InstallStatus {
  state: InstallState;
  targetDir: string | null;
  percent: number | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  suggestedDir: string;
}

type InstallEvent =
  | { type: 'snapshot'; snapshot: InstallStatus; logs: InstallLog[] }
  | { type: 'log'; log: InstallLog }
  | { type: 'state'; state: InstallStatus }
  | { type: 'error'; message: string };

const STATE_LABEL: Record<InstallState, string> = {
  idle: 'Not started',
  downloading: 'Downloading SteamCMD',
  extracting: 'Extracting SteamCMD',
  installing: 'Installing Project Zomboid (this can take a while)',
  done: 'Install complete',
  error: 'Failed',
  cancelled: 'Cancelled',
};

export function Install(): JSX.Element {
  const qc = useQueryClient();
  const initial = useQuery({
    queryKey: ['install-status'],
    queryFn: () => api<InstallStatus>('/api/install/status'),
  });

  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [logs, setLogs] = useState<InstallLog[]>([]);
  const [targetDir, setTargetDir] = useState('');
  const logBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initial.data && !status) {
      setStatus(initial.data);
      if (!targetDir) {
        setTargetDir(initial.data.targetDir ?? initial.data.suggestedDir);
      }
    }
  }, [initial.data, status, targetDir]);

  // Subscribe to /ws/install for live updates.
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    function connect(): WebSocket {
      const token = getToken() ?? '';
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/install?token=${encodeURIComponent(token)}`,
      );
      ws.addEventListener('message', (e) => {
        try {
          const ev = JSON.parse(e.data as string) as InstallEvent;
          if (ev.type === 'snapshot') {
            setStatus((prev) => ({ ...(prev ?? ev.snapshot), ...ev.snapshot }));
            setLogs(ev.logs);
          } else if (ev.type === 'state') {
            setStatus((prev) => ({ ...(prev ?? ev.state), ...ev.state }));
          } else if (ev.type === 'log') {
            setLogs((l) => [...l.slice(-1999), ev.log]);
          }
        } catch {
          /* ignore */
        }
      });
      ws.addEventListener('close', () => {
        if (!stopped) timer = window.setTimeout(connect, 2000);
      });
      return ws;
    }

    const ws = connect();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      ws.close();
    };
  }, []);

  // Refetch status when state flips to "done" so persistent fields catch up.
  useEffect(() => {
    if (status?.state === 'done') {
      void qc.invalidateQueries({ queryKey: ['install-status'] });
      void qc.invalidateQueries({ queryKey: ['server-status'] });
    }
  }, [status?.state, qc]);

  // Autoscroll log box.
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  const start = useMutation({
    mutationFn: () =>
      api<InstallStatus>('/api/install/start', {
        method: 'POST',
        body: JSON.stringify({ targetDir }),
      }),
  });
  const cancel = useMutation({
    mutationFn: () => api<InstallStatus>('/api/install/cancel', { method: 'POST' }),
  });

  const isBusy =
    status?.state === 'downloading' ||
    status?.state === 'extracting' ||
    status?.state === 'installing';
  const isDone = status?.state === 'done';
  const isErr = status?.state === 'error';

  return (
    <div className="container mx-auto space-y-4 p-6">
      <header className="mb-2">
        <h1 className="text-2xl font-bold">Install Project Zomboid server</h1>
        <p className="text-sm text-muted-foreground">
          Downloads SteamCMD and runs <code>app_update 380870 validate</code> with anonymous login.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target directory</CardTitle>
          <CardDescription>
            Where the dedicated server files will be installed. Will be created if missing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Folder className="h-4 w-4 text-muted-foreground" />
            <Input
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              disabled={isBusy}
              placeholder="C:\Users\you\pz-dedicated-server"
              className="font-mono"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => start.mutate()}
              disabled={isBusy || !targetDir.trim() || start.isPending}
            >
              <Download className="mr-2 h-4 w-4" />
              {isBusy ? 'Installing…' : isDone ? 'Reinstall / Update' : 'Install'}
            </Button>
            {isBusy && (
              <Button variant="destructive" onClick={() => cancel.mutate()}>
                Cancel
              </Button>
            )}
            {isDone && (
              <span className="inline-flex items-center text-sm text-primary">
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Installed at {status?.targetDir}
              </span>
            )}
            {isErr && (
              <span className="inline-flex items-center text-sm text-destructive">
                <XCircle className="mr-1 h-4 w-4" />
                {status?.error ?? 'Install failed'}
              </span>
            )}
          </div>

          {status && status.state !== 'idle' && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{STATE_LABEL[status.state]}</span>
                <span>{status.percent != null ? `${status.percent.toFixed(1)}%` : ''}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    'h-full transition-all',
                    isErr
                      ? 'bg-destructive'
                      : isDone
                        ? 'bg-primary'
                        : 'bg-primary/70',
                  )}
                  style={{
                    width: `${
                      status.percent ??
                      (status.state === 'downloading'
                        ? 10
                        : status.state === 'extracting'
                          ? 25
                          : status.state === 'installing'
                            ? 40
                            : isDone
                              ? 100
                              : 0)
                    }%`,
                  }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border py-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Install log — {logs.length} lines
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={logBoxRef}
            className="h-[50vh] overflow-y-auto bg-black/60 p-3 font-mono text-xs leading-5"
          >
            {logs.length === 0 ? (
              <p className="text-muted-foreground">
                No log yet — click Install to begin.
              </p>
            ) : (
              logs.map((line) => (
                <div
                  key={line.id}
                  className={cn(
                    'whitespace-pre-wrap',
                    line.source === 'err' && 'text-red-400',
                    line.source === 'sys' && 'text-amber-300',
                    line.source === 'out' && 'text-zinc-100',
                  )}
                >
                  {line.text}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
