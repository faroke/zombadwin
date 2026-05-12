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
      {step.id === 'difficulty' && <DifficultyStep onDone={goNext} />}
      {step.id === 'mods' && <ModsStep onDone={goNext} />}
      {step.id === 'network' && <NetworkStep onDone={goNext} />}
      {step.id === 'recap' && <RecapStep />}

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

// -- Step 2: Difficulty ----------------------------------------------------

interface PresetsResponse {
  presets: string[];
}
interface ApplyPresetResponse {
  ok: true;
  path: string;
  presetSource: string;
  serverName: string;
}

function DifficultyStep({ onDone }: { onDone: () => void }): JSX.Element {
  const presetsQuery = useQuery({
    queryKey: ['sandbox-presets'],
    queryFn: () => api<PresetsResponse>('/api/config/sandbox/presets'),
  });
  const [preset, setPreset] = useState<string>('');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [lastResult, setLastResult] = useState<ApplyPresetResponse | null>(null);

  const apply = useMutation({
    mutationFn: () =>
      api<ApplyPresetResponse>('/api/config/sandbox/apply-preset', {
        method: 'POST',
        body: JSON.stringify({ preset, overwrite: confirmOverwrite }),
      }),
    onSuccess: (data) => setLastResult(data),
  });

  const needsOverwriteConfirm =
    apply.error instanceof Error &&
    /refusing to overwrite/i.test(apiErrorMessage(apply.error));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Difficulty preset</CardTitle>
        <CardDescription>
          Drops a complete <code>&lt;server&gt;_SandboxVars.lua</code> from one of the PZ-bundled
          presets. Skips the "boot the server once just to generate the file" detour — you can
          fine-tune in the Config page afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {presetsQuery.error ? (
          <p className="text-xs text-destructive">
            {apiErrorMessage(presetsQuery.error, 'Presets unavailable')} — Build step must
            complete first so the install dir is known.
          </p>
        ) : presetsQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading preset list…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {presetsQuery.data?.presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPreset(p);
                  setConfirmOverwrite(false);
                }}
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  preset === p
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-input hover:bg-accent/50',
                )}
              >
                <span className="font-semibold">{p}</span>
                <span className="ml-1 text-xs text-muted-foreground">{presetBlurb(p)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => apply.mutate()}
            disabled={!preset || apply.isPending}
          >
            {apply.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Applying…
              </>
            ) : (
              <>Apply {preset || 'preset'}</>
            )}
          </Button>
          {needsOverwriteConfirm && !confirmOverwrite && (
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOverwrite(true);
                apply.reset();
              }}
            >
              Overwrite existing
            </Button>
          )}
          {lastResult && (
            <Button variant="default" onClick={onDone}>
              Continue <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>

        {apply.error && (
          <p className="text-xs text-destructive">{apiErrorMessage(apply.error)}</p>
        )}
        {lastResult && (
          <p className="inline-flex items-center text-xs text-primary">
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Wrote <code className="px-1">{lastResult.path}</code> from preset
            <code className="ml-1 px-1">{preset}</code> for server
            <code className="ml-1 px-1">{lastResult.serverName}</code>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// -- Step 3: Mods ----------------------------------------------------------

interface WorkshopMetadata {
  workshopId: string;
  title: string;
  description: string;
  detectedModIds: string[];
  detectedMapFolders: string[];
  /** Subset of detectedMapFolders the backend flagged as likely spawn-region
   * artifacts ("Many Spawns Louisville", "Anywhere But - Muldraugh", …). The
   * UI defaults these to unchecked. */
  suspectedSpawnRegions: string[];
  timeUpdated: number | null;
  fileSize: number | null;
  isCollection: boolean;
}

interface ResolveResponse {
  ok: true;
  items: WorkshopMetadata[];
  parentCollection: { workshopId: string; title: string } | null;
}

interface ModsResponse {
  path: string;
  serverName: string;
  workshopItems: string[];
  mods: string[];
  map: string[];
}

interface DownloadItem {
  workshopId: string;
  ok: boolean;
  status: string;
}
interface DownloadResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
  items: DownloadItem[];
}

function ModsStep({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: ['mods'],
    queryFn: () => api<ModsResponse>('/api/mods'),
    retry: false,
  });

  const [input, setInput] = useState('');
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  // Map name → included flag. Initialized from heuristic when resolve completes.
  const [mapSelection, setMapSelection] = useState<Record<string, boolean>>({});
  const [downloadResult, setDownloadResult] = useState<DownloadResponse | null>(null);

  const resolve = useMutation({
    mutationFn: (raw: string) =>
      api<ResolveResponse>('/api/mods/resolve', {
        method: 'POST',
        body: JSON.stringify({ input: raw }),
      }),
    onSuccess: (data) => {
      setResolved(data);
      const next: Record<string, boolean> = {};
      for (const it of data.items) {
        const sus = new Set(it.suspectedSpawnRegions);
        for (const m of it.detectedMapFolders) {
          // Same map can appear in multiple items; keep "true" if any item
          // doesn't flag it as suspect — gentlest default.
          if (!(m in next)) next[m] = !sus.has(m);
          else next[m] = next[m] || !sus.has(m);
        }
      }
      setMapSelection(next);
    },
  });

  const apply = useMutation({
    mutationFn: async (): Promise<{ download: DownloadResponse }> => {
      if (!resolved) throw new Error('nothing resolved');
      const workshopItems = resolved.items.map((i) => i.workshopId);
      // Dedupe mods, preserve collection order.
      const modSet = new Set<string>();
      const mods: string[] = [];
      for (const it of resolved.items) {
        for (const m of it.detectedModIds) {
          if (!modSet.has(m)) {
            modSet.add(m);
            mods.push(m);
          }
        }
      }
      const map = Object.entries(mapSelection)
        .filter(([, v]) => v)
        .map(([k]) => k);
      // PZ loads Map= entries first-to-last on top of one another; the vanilla
      // map must come last. If the user kept Muldraugh, KY in the list, leave
      // its position; otherwise append it as the floor.
      if (!map.includes('Muldraugh, KY')) map.push('Muldraugh, KY');
      await api('/api/mods', {
        method: 'PUT',
        body: JSON.stringify({ workshopItems, mods, map }),
      });
      const download = await api<DownloadResponse>('/api/mods/download', {
        method: 'POST',
      });
      return { download };
    },
    onSuccess: ({ download }) => {
      setDownloadResult(download);
      void qc.invalidateQueries({ queryKey: ['mods'] });
    },
  });

  const noInstallYet =
    current.error && /not_found|install_not_configured/.test(apiErrorMessage(current.error));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mods</CardTitle>
        <CardDescription>
          Paste a Steam Workshop collection or single-mod URL. Resolve fetches the children, runs
          the curation heuristic on detected map folders (Many Spawns / Anywhere But / Knox County
          variants default to unchecked), and Apply writes WorkshopItems + Mods + Map to the active
          server's INI and runs SteamCMD downloads. Leave blank to skip mods entirely.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {noInstallYet && (
          <p className="text-xs text-destructive">
            INI not found yet — start the server once from the Profiles page (or finish Build), so
            the active server profile creates its{' '}
            <code className="px-1">&lt;server&gt;.ini</code>.
          </p>
        )}

        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…"
            className="font-mono"
            maxLength={500}
          />
          <Button
            type="button"
            onClick={() => resolve.mutate(input.trim())}
            disabled={!input.trim() || resolve.isPending}
          >
            {resolve.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resolving…
              </>
            ) : (
              'Resolve'
            )}
          </Button>
        </div>
        {resolve.error && (
          <p className="text-xs text-destructive">{apiErrorMessage(resolve.error)}</p>
        )}

        {resolved && <ResolvedSummary
          resolved={resolved}
          mapSelection={mapSelection}
          onMapToggle={(name) =>
            setMapSelection((s) => ({ ...s, [name]: !s[name] }))
          }
        />}

        <div className="flex flex-wrap items-center gap-2">
          {resolved && (
            <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
              {apply.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Writing + downloading…
                </>
              ) : (
                <>Apply &amp; download</>
              )}
            </Button>
          )}
          <Button variant="outline" onClick={onDone}>
            Skip mods <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
          {downloadResult && (
            <Button variant="default" onClick={onDone}>
              Continue <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>

        {apply.error && (
          <p className="text-xs text-destructive">{apiErrorMessage(apply.error)}</p>
        )}
        {downloadResult && <DownloadSummary result={downloadResult} />}
      </CardContent>
    </Card>
  );
}

function ResolvedSummary({
  resolved,
  mapSelection,
  onMapToggle,
}: {
  resolved: ResolveResponse;
  mapSelection: Record<string, boolean>;
  onMapToggle: (name: string) => void;
}): JSX.Element {
  const itemCount = resolved.items.length;
  const modSet = new Set(resolved.items.flatMap((i) => i.detectedModIds));
  const allMaps = Array.from(
    new Set(resolved.items.flatMap((i) => i.detectedMapFolders)),
  ).sort((a, b) => a.localeCompare(b));
  const suspectMaps = new Set(
    resolved.items.flatMap((i) => i.suspectedSpawnRegions),
  );
  const itemsMissingModId = resolved.items
    .filter((i) => i.detectedModIds.length === 0)
    .map((i) => i.title);

  return (
    <div className="space-y-3 rounded-md border bg-secondary/30 p-3 text-sm">
      <div>
        {resolved.parentCollection ? (
          <>
            <span className="font-semibold">{resolved.parentCollection.title}</span>{' '}
            <span className="text-xs text-muted-foreground">
              collection #{resolved.parentCollection.workshopId}
            </span>
          </>
        ) : (
          <span className="font-semibold">{resolved.items[0]?.title ?? '(empty)'}</span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {itemCount} workshop {itemCount === 1 ? 'item' : 'items'} · {modSet.size} mod{' '}
        {modSet.size === 1 ? 'ID' : 'IDs'} · {allMaps.length} detected map{' '}
        {allMaps.length === 1 ? 'folder' : 'folders'} ({suspectMaps.size} flagged as suspect)
      </div>

      {itemsMissingModId.length > 0 && (
        <div className="text-[11px] text-amber-600 dark:text-amber-400">
          {itemsMissingModId.length}{' '}
          {itemsMissingModId.length === 1 ? 'item has' : 'items have'} no Mod ID in their
          description. They'll still be downloaded; you may need to add Mod IDs manually from each
          mod's <code>mod.info</code> after download — check the Mods page.
        </div>
      )}

      {allMaps.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium">Map folders (uncheck non-maps)</div>
          <div className="flex flex-wrap gap-1">
            {allMaps.map((name) => {
              const sel = mapSelection[name] ?? !suspectMaps.has(name);
              const suspect = suspectMaps.has(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onMapToggle(name)}
                  className={cn(
                    'rounded-md border px-2 py-0.5 font-mono text-xs',
                    sel
                      ? suspect
                        ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'border-primary bg-primary/15 text-primary'
                      : 'border-input text-muted-foreground hover:text-foreground',
                  )}
                  title={
                    suspect
                      ? 'Heuristically flagged as a spawn-region payload, not a real map'
                      : ''
                  }
                >
                  {name}
                  {suspect && <span className="ml-1 text-[10px] opacity-75">?</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadSummary({ result }: { result: DownloadResponse }): JSX.Element {
  const ok = result.items.filter((i) => i.ok).length;
  const fail = result.items.length - ok;
  return (
    <div className="rounded-md border bg-secondary/30 p-3 text-xs">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-primary" />
        <span>
          {ok} downloaded, {fail} failed (SteamCMD exit {result.exitCode}).
        </span>
      </div>
      {fail > 0 && (
        <ul className="mt-2 space-y-0.5 font-mono">
          {result.items
            .filter((i) => !i.ok)
            .slice(0, 5)
            .map((i) => (
              <li key={i.workshopId} className="text-destructive">
                {i.workshopId}: {i.status}
              </li>
            ))}
          {fail > 5 && (
            <li className="text-muted-foreground">…and {fail - 5} more — check Mods page.</li>
          )}
        </ul>
      )}
    </div>
  );
}

// -- Step 4: Network --------------------------------------------------------

interface IniResponse {
  path: string;
  serverName: string;
  values: Record<string, string>;
  order: string[];
  // schema/categories are present too but not used here.
}

// The subset of INI keys the wizard's Network step surfaces. The full editor
// lives in /config — this step only exposes the fields a brand-new server
// owner has to set to make the box reachable.
const NETWORK_FIELDS: Array<{ key: string; label: string; placeholder?: string; hint?: string }> = [
  {
    key: 'PublicName',
    label: 'Public name',
    placeholder: 'My PZ Server',
    hint: 'Shown in the in-game server browser when Public is on.',
  },
  {
    key: 'Password',
    label: 'Password',
    placeholder: '(leave blank for open)',
    hint: 'Leave empty if Open is true; otherwise required to join.',
  },
  {
    key: 'MaxPlayers',
    label: 'Max players',
    placeholder: '32',
    hint: 'Above 32 risks map desync — PZ warns about it.',
  },
  {
    key: 'DefaultPort',
    label: 'Default port (UDP)',
    placeholder: '16261',
    hint: 'Main joiner port. Must be reachable / port-forwarded for non-LAN.',
  },
  {
    key: 'UDPPort',
    label: 'Secondary port (UDP)',
    placeholder: '16262',
  },
  { key: 'RCONPort', label: 'RCON port (TCP)', placeholder: '27015' },
  { key: 'RCONPassword', label: 'RCON password' },
  {
    key: 'Public',
    label: 'List in in-game browser (true/false)',
    placeholder: 'false',
  },
  {
    key: 'Open',
    label: 'Allow unregistered accounts (true/false)',
    placeholder: 'true',
  },
];

function NetworkStep({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const ini = useQuery({
    queryKey: ['ini'],
    queryFn: () => api<IniResponse>('/api/config/ini'),
    retry: false,
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api('/api/config/ini', {
        method: 'PUT',
        body: JSON.stringify({ values: edits }),
      }),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['ini'] });
    },
  });

  if (ini.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Loading INI…</CardContent>
      </Card>
    );
  }
  if (ini.error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-destructive">
            {apiErrorMessage(ini.error, 'INI not available')}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            The active server's INI is only generated after the first boot. Skip Network and let
            PZ create defaults — you can come back and edit in the Config page.
          </p>
          <Button variant="outline" className="mt-3" onClick={onDone}>
            Skip <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  const values = ini.data?.values ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Network</CardTitle>
        <CardDescription>
          Sets the handful of INI fields that matter for reachability. Everything else is left at
          the defaults — visit Config for the long tail.
          {ini.data?.serverName && (
            <>
              {' '}
              Editing <code className="px-1">{ini.data.serverName}.ini</code>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {NETWORK_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {f.label} <code className="ml-1 text-[10px]">{f.key}</code>
            </label>
            <Input
              type={f.key === 'Password' || f.key === 'RCONPassword' ? 'password' : 'text'}
              value={edits[f.key] ?? values[f.key] ?? ''}
              onChange={(e) => {
                setSaved(false);
                setEdits((s) => ({ ...s, [f.key]: e.target.value }));
              }}
              placeholder={f.placeholder ?? ''}
              className="font-mono"
            />
            {f.hint && <p className="text-[10px] text-muted-foreground">{f.hint}</p>}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            onClick={() => save.mutate()}
            disabled={Object.keys(edits).length === 0 || save.isPending}
          >
            {save.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              'Save changes'
            )}
          </Button>
          <Button variant="outline" onClick={onDone}>
            {saved ? 'Continue' : 'Skip'} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
          {saved && (
            <span className="inline-flex items-center text-xs text-primary">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> INI saved.
            </span>
          )}
        </div>
        {save.error && (
          <p className="text-xs text-destructive">{apiErrorMessage(save.error)}</p>
        )}
      </CardContent>
    </Card>
  );
}

// -- Step 5: Recap ----------------------------------------------------------

interface ServerStatus {
  state: string;
  pid: number | null;
  installDir: string | null;
}

function RecapStep(): JSX.Element {
  const installStatus = useQuery({
    queryKey: ['install-status'],
    queryFn: () => api<InstallStatus>('/api/install/status'),
  });
  const ini = useQuery({
    queryKey: ['ini'],
    queryFn: () => api<IniResponse>('/api/config/ini'),
    retry: false,
  });
  const mods = useQuery({
    queryKey: ['mods'],
    queryFn: () => api<ModsResponse>('/api/mods'),
    retry: false,
  });
  const status = useQuery({
    queryKey: ['server-status'],
    queryFn: () => api<ServerStatus>('/api/server/status'),
    refetchInterval: 2000,
  });

  const start = useMutation({
    mutationFn: () => api('/api/server/start', { method: 'POST' }),
  });

  const running = status.data && /running|starting|alive/i.test(status.data.state);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recap &amp; start</CardTitle>
        <CardDescription>
          One last look before the JVM boots. Everything below comes from the same endpoints the
          rest of the UI uses, so it stays truthful even after manual edits in Config.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <RecapRow
          label="Install"
          value={
            installStatus.data?.targetDir
              ? `${installStatus.data.targetDir} (branch: ${
                  installStatus.data.branch || 'public / default'
                })`
              : '— not installed'
          }
        />
        <RecapRow
          label="Profile"
          value={ini.data?.serverName ? ini.data.serverName : '— no INI yet'}
        />
        <RecapRow
          label="Network"
          value={
            ini.data
              ? `${ini.data.values.PublicName ?? 'My PZ Server'} on ${
                  ini.data.values.DefaultPort ?? '16261'
                }/${ini.data.values.UDPPort ?? '16262'}${
                  ini.data.values.Password ? ' (password set)' : ''
                }`
              : '—'
          }
        />
        <RecapRow
          label="Mods"
          value={
            mods.data
              ? `${mods.data.workshopItems.length} workshop items · ${mods.data.mods.length} mod IDs · ${mods.data.map.length} map entries`
              : '— none'
          }
        />
        <RecapRow
          label="Server"
          value={status.data ? `${status.data.state}${status.data.pid ? ` (pid ${status.data.pid})` : ''}` : '—'}
        />

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            onClick={() => start.mutate()}
            disabled={start.isPending || !!running}
          >
            {start.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…
              </>
            ) : running ? (
              'Server already running'
            ) : (
              'Start server'
            )}
          </Button>
        </div>
        {start.error && (
          <p className="text-xs text-destructive">{apiErrorMessage(start.error)}</p>
        )}
        {running && (
          <p className="inline-flex items-center text-xs text-primary">
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Up — head to the Console page for live logs.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RecapRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline gap-3 border-b border-border/40 pb-2 last:border-0">
      <span className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function presetBlurb(name: string): string {
  // PZ ships these without metadata — short blurbs come from the community wiki
  // (paraphrased) to give the user a steer at-a-glance.
  switch (name) {
    case 'Apocalypse':
      return '— canonical "hard but fair" preset, sprinters off';
    case 'Survivor':
      return '— stealth-focused, scarce loot';
    case 'Builder':
      return '— peaceful, base-building emphasis';
    case 'Outbreak':
      return '— sprinters, day-zero scenario';
    case 'Rising':
      return '— escalating zombie speed/population';
    case 'SixMonthsLater':
      return '— late-game world, depleted infrastructure';
    case 'Extinction':
      return '— extreme density, sprinter horde';
    default:
      return '';
  }
}
