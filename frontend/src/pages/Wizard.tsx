import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Folder, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, apiErrorMessage } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

// -- Types shared with the backend ------------------------------------------

type InstallState =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'installing'
  | 'done'
  | 'error'
  | 'cancelled';

interface InstallStatus {
  state: InstallState;
  targetDir: string | null;
  branch: string | null;
  percent: number | null;
  error: string | null;
  suggestedDir: string;
  persistedBranch?: string | null;
}

interface InstallLog {
  id: number;
  ts: number;
  source: 'out' | 'err' | 'sys';
  text: string;
}

type InstallEvent =
  | { type: 'snapshot'; snapshot: InstallStatus; logs: InstallLog[] }
  | { type: 'log'; log: InstallLog }
  | { type: 'state'; state: InstallStatus }
  | { type: 'error'; message: string };

interface SteamBranch {
  name: string;
  buildid: string | null;
  description: string | null;
  timeUpdated: number | null;
  timeBuildUpdated: number | null;
}

interface SteamBranchesResponse {
  branches: SteamBranch[];
  fetchedAt: number;
  cached: boolean;
}

// -- Wizard frame -----------------------------------------------------------

type StepId = 'build' | 'difficulty' | 'mods' | 'network' | 'recap';

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'build', label: 'Build' },
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'mods', label: 'Mods' },
  { id: 'network', label: 'Network' },
  { id: 'recap', label: 'Recap' },
];

export function Wizard(): JSX.Element {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx]!;

  function goNext(): void {
    setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  }
  function goPrev(): void {
    setStepIdx((i) => Math.max(0, i - 1));
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Setup wizard</h1>
        <p className="text-sm text-muted-foreground">
          One-shot path from a blank machine to a running server. Each step writes its result to
          disk before advancing — you can drop out at any time and pick up via the Install / Mods /
          Config pages.
        </p>
      </header>

      <Stepper currentIdx={stepIdx} />

      {step.id === 'build' && <BuildStep onDone={goNext} />}
      {step.id !== 'build' && (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              Step "{step.label}" not implemented yet — coming next in this milestone.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={goPrev} disabled={stepIdx === 0}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button variant="outline" onClick={goNext} disabled={stepIdx === STEPS.length - 1}>
          Skip step <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Stepper({ currentIdx }: { currentIdx: number }): JSX.Element {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li
            key={s.id}
            className={cn(
              'flex items-center gap-1 rounded-full px-3 py-1 font-medium',
              active
                ? 'bg-primary text-primary-foreground'
                : done
                  ? 'bg-secondary text-secondary-foreground'
                  : 'border border-input text-muted-foreground',
            )}
          >
            <span className="font-mono">{i + 1}.</span> {s.label}
          </li>
        );
      })}
    </ol>
  );
}

// -- Step 1: Build ----------------------------------------------------------

function BuildStep({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const initial = useQuery({
    queryKey: ['install-status'],
    queryFn: () => api<InstallStatus>('/api/install/status'),
  });
  const branchesQuery = useQuery({
    queryKey: ['install-branches'],
    queryFn: () => api<SteamBranchesResponse>('/api/install/branches'),
    // The backend caches for 5 min; refresh on demand only.
    staleTime: 5 * 60 * 1000,
    // Branches require a working SteamCMD install. If it isn't there yet (the
    // very first time the wizard runs), skip the call until install starts.
    enabled: !!initial.data,
  });

  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [logs, setLogs] = useState<InstallLog[]>([]);
  const [targetDir, setTargetDir] = useState('');
  const [branch, setBranch] = useState('');
  const logBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initial.data && !status) {
      setStatus(initial.data);
      setTargetDir(initial.data.targetDir ?? initial.data.suggestedDir);
      // Pre-fill from persistedBranch so an existing install isn't silently
      // re-pointed at the default branch on the next Update.
      const lastBranch = initial.data.branch ?? initial.data.persistedBranch ?? '';
      if (lastBranch) setBranch(lastBranch);
    }
  }, [initial.data, status]);

  // Live updates from /ws/install.
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

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (status?.state === 'done') {
      void qc.invalidateQueries({ queryKey: ['install-status'] });
      void qc.invalidateQueries({ queryKey: ['install-branches'] });
    }
  }, [status?.state, qc]);

  const start = useMutation({
    mutationFn: () =>
      api<InstallStatus>('/api/install/start', {
        method: 'POST',
        body: JSON.stringify({ targetDir, branch: branch.trim() || null }),
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

  // Compare to the install on disk: if the user picked a different branch /
  // dir than what's currently persisted, reinstall is required before Continue.
  const installedAndMatches =
    status?.state === 'done' &&
    status.targetDir === targetDir.trim() &&
    (status.branch ?? '') === branch.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Build &amp; install location</CardTitle>
        <CardDescription>
          Picks where the PZ dedicated server binaries live, and which Steam beta branch they
          come from. Branch list is fetched live from Steam — what you see is what
          <code className="px-1">app_update -beta &lt;name&gt;</code> will actually accept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Install directory</label>
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
        </div>

        <BranchSelector
          branches={branchesQuery.data?.branches ?? []}
          isLoading={branchesQuery.isLoading}
          error={branchesQuery.error}
          value={branch}
          onChange={setBranch}
          disabled={isBusy}
          onRefresh={() =>
            qc.invalidateQueries({ queryKey: ['install-branches'] })
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => start.mutate()}
            disabled={isBusy || !targetDir.trim() || start.isPending}
          >
            {isBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Installing…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" /> {isDone ? 'Reinstall / Update' : 'Install'}
              </>
            )}
          </Button>
          {isBusy && (
            <Button variant="destructive" onClick={() => cancel.mutate()}>
              Cancel
            </Button>
          )}
          {installedAndMatches && (
            <Button variant="default" onClick={onDone}>
              Continue <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {isDone && !installedAndMatches && (
            <span className="text-xs text-muted-foreground">
              Selection differs from the installed copy — Reinstall before continuing.
            </span>
          )}
        </div>

        {start.error && (
          <p className="text-xs text-destructive">{apiErrorMessage(start.error)}</p>
        )}

        {status && status.state !== 'idle' && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{stateLabel(status.state)}</span>
              <span>{status.percent != null ? `${status.percent.toFixed(1)}%` : ''}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn('h-full transition-all', isDone ? 'bg-primary' : 'bg-primary/70')}
                style={{ width: `${status.percent ?? (isDone ? 100 : 25)}%` }}
              />
            </div>
          </div>
        )}

        {logs.length > 0 && (
          <div
            ref={logBoxRef}
            className="h-48 overflow-y-auto rounded-md bg-black/60 p-2 font-mono text-[11px] leading-5"
          >
            {logs.slice(-150).map((line) => (
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BranchSelector(props: {
  branches: SteamBranch[];
  isLoading: boolean;
  error: unknown;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  onRefresh: () => void;
}): JSX.Element {
  const { branches, isLoading, error, value, onChange, disabled, onRefresh } = props;
  const selected = branches.find((b) => b.name === value) ?? null;
  const usingDefault = !value;

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        Steam beta branch (empty = default, currently <code>public</code>)
      </label>
      {error ? (
        <p className="text-xs text-destructive">
          {apiErrorMessage(error, 'Branch list unavailable')} — run an install first to seed
          SteamCMD, then refresh.
          <button
            type="button"
            className="ml-2 underline hover:no-underline"
            onClick={onRefresh}
          >
            Retry
          </button>
        </p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">Fetching branches from Steam…</p>
      ) : branches.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No branches reported. Use the text field as a fallback.
        </p>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm disabled:opacity-50"
        >
          <option value="">(default / public — most users)</option>
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
              {b.description ? ` — ${truncate(b.description, 60)}` : ''}
              {b.buildid ? ` [build ${b.buildid}]` : ''}
            </option>
          ))}
        </select>
      )}
      <p className="text-[11px] text-muted-foreground">
        {usingDefault
          ? 'Default branch is what Steam calls public — for PZ this is currently B41 stable. Pick `unstable` for the latest B42 work.'
          : selected?.description
            ? selected.description
            : `Custom branch \`${value}\` — passed verbatim to app_update -beta.`}
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="…or type a branch name manually"
          className="font-mono"
          maxLength={64}
        />
        <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={disabled}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function stateLabel(s: InstallState): string {
  switch (s) {
    case 'idle':
      return 'Not started';
    case 'downloading':
      return 'Downloading SteamCMD';
    case 'extracting':
      return 'Extracting SteamCMD';
    case 'installing':
      return 'Installing Project Zomboid';
    case 'done':
      return 'Install complete';
    case 'error':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

// Suppress unused-import warning while later steps are not yet wired in.
void CheckCircle2;
