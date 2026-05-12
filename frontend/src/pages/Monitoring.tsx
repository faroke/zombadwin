import { useQuery } from '@tanstack/react-query';
import {
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Save,
  Server as ServerIcon,
  Users,
  Zap,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 2000;
const HISTORY_LENGTH = 60;

interface MonitoringSnapshot {
  timestamp: number;
  host: {
    cpuPercent: number;
    memTotalBytes: number;
    memUsedBytes: number;
    uptimeSeconds: number;
    platform: string;
    cores: number;
  };
  pz: {
    state: string;
    pid: number | null;
    workingSetBytes: number | null;
    cpuPercent: number | null;
    uptimeSeconds: number | null;
    sampleError: string | null;
  };
  disk: {
    installDir: string | null;
    installDirFreeBytes: number | null;
    installDirTotalBytes: number | null;
    saveDir: string | null;
    saveDirSizeBytes: number | null;
    saveDirError: string | null;
  };
  players: {
    count: number | null;
    queriedAt: number | null;
    error: string | null;
  };
}

interface SeriesPoint {
  /** Epoch ms — used for X-axis spacing when samples come in irregularly. */
  t: number;
  hostCpu: number;
  hostMem: number;
  pzWs: number | null;
  pzCpu: number | null;
  diskFree: number | null;
  saveSize: number | null;
  players: number | null;
}

export function Monitoring(): JSX.Element {
  const query = useQuery({
    queryKey: ['monitoring-snapshot'],
    queryFn: () => api<MonitoringSnapshot>('/api/monitoring/snapshot'),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // Rolling buffer kept in a ref so we don't render on every push — the
  // useQuery state update is what triggers the paint.
  const seriesRef = useRef<SeriesPoint[]>([]);
  useEffect(() => {
    if (!query.data) return;
    const s = query.data;
    const point: SeriesPoint = {
      t: s.timestamp,
      hostCpu: s.host.cpuPercent,
      hostMem: s.host.memTotalBytes === 0 ? 0 : (s.host.memUsedBytes / s.host.memTotalBytes) * 100,
      pzWs: s.pz.workingSetBytes,
      pzCpu: s.pz.cpuPercent,
      diskFree: s.disk.installDirFreeBytes,
      saveSize: s.disk.saveDirSizeBytes,
      players: s.players.count,
    };
    seriesRef.current = [...seriesRef.current.slice(-(HISTORY_LENGTH - 1)), point];
  }, [query.data]);

  const series = seriesRef.current;
  const snap = query.data;

  return (
    <div className="container mx-auto space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-bold">Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Live readings polled every {POLL_INTERVAL_MS / 1000}s. Last {HISTORY_LENGTH} samples are
          kept in memory and reset on page reload. Save dir size refreshes every 30s; player count
          every 15s.
        </p>
      </header>

      {query.error && (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            {apiErrorMessage(query.error, 'snapshot failed')}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <MetricCard
          icon={Cpu}
          title="Host CPU"
          description={snap ? `${snap.host.cores} cores · ${snap.host.platform}` : '—'}
          value={snap ? `${snap.host.cpuPercent.toFixed(1)}%` : '—'}
          values={series.map((p) => p.hostCpu)}
          max={100}
          formatY={(v) => `${v.toFixed(0)}%`}
        />
        <MetricCard
          icon={Gauge}
          title="Host RAM"
          description={
            snap
              ? `${formatBytes(snap.host.memUsedBytes)} / ${formatBytes(snap.host.memTotalBytes)}`
              : '—'
          }
          value={
            snap && snap.host.memTotalBytes > 0
              ? `${((snap.host.memUsedBytes / snap.host.memTotalBytes) * 100).toFixed(1)}%`
              : '—'
          }
          values={series.map((p) => p.hostMem)}
          max={100}
          formatY={(v) => `${v.toFixed(0)}%`}
        />
        <MetricCard
          icon={ServerIcon}
          title="PZ working set"
          description={
            snap
              ? snap.pz.state === 'stopped'
                ? 'server stopped'
                : snap.pz.sampleError
                  ? `error: ${snap.pz.sampleError.slice(0, 60)}`
                  : `pid ${snap.pz.pid ?? '—'} · uptime ${formatDuration(snap.pz.uptimeSeconds)}`
              : '—'
          }
          value={snap?.pz.workingSetBytes != null ? formatBytes(snap.pz.workingSetBytes) : '—'}
          values={seriesNumbersOrZero(series.map((p) => p.pzWs))}
          formatY={formatBytes}
        />
        <MetricCard
          icon={Zap}
          title="PZ CPU"
          description={snap?.pz.cpuPercent != null ? `${snap.host.cores} cores total` : '—'}
          value={snap?.pz.cpuPercent != null ? `${snap.pz.cpuPercent.toFixed(0)}%` : '—'}
          subtitle={
            snap?.pz.cpuPercent != null && snap.host.cores > 0
              ? `${(snap.pz.cpuPercent / snap.host.cores).toFixed(1)}% of host`
              : undefined
          }
          values={seriesNumbersOrZero(series.map((p) => p.pzCpu))}
          // Clamp axis to the max of (observed, 100*cores) so multi-core spikes
          // don't squish the rest of the line.
          max={
            snap && snap.host.cores
              ? Math.max(100, snap.host.cores * 100)
              : 100
          }
          formatY={(v) => `${v.toFixed(0)}%`}
        />
        <MetricCard
          icon={HardDrive}
          title="Install disk free"
          description={
            snap?.disk.installDir
              ? truncatePath(snap.disk.installDir, 36)
              : 'install dir not set'
          }
          value={
            snap?.disk.installDirFreeBytes != null
              ? formatBytes(snap.disk.installDirFreeBytes)
              : '—'
          }
          subtitle={
            snap?.disk.installDirTotalBytes != null
              ? `of ${formatBytes(snap.disk.installDirTotalBytes)} total`
              : undefined
          }
          values={seriesNumbersOrZero(series.map((p) => p.diskFree))}
          formatY={formatBytes}
        />
        <MetricCard
          icon={Save}
          title="Save dir size"
          description={
            snap?.disk.saveDir
              ? truncatePath(snap.disk.saveDir, 36)
              : '—'
          }
          value={
            snap?.disk.saveDirSizeBytes != null
              ? formatBytes(snap.disk.saveDirSizeBytes)
              : '—'
          }
          subtitle={snap?.disk.saveDirError ? `error: ${snap.disk.saveDirError.slice(0, 60)}` : undefined}
          values={seriesNumbersOrZero(series.map((p) => p.saveSize))}
          formatY={formatBytes}
        />
        <MetricCard
          icon={Users}
          title="Players connected"
          description={
            snap?.players.queriedAt
              ? `last queried ${secondsAgo(snap.players.queriedAt)}s ago`
              : snap?.pz.state === 'running'
                ? 'querying…'
                : 'server not running'
          }
          value={snap?.players.count != null ? String(snap.players.count) : '—'}
          values={seriesNumbersOrZero(series.map((p) => p.players))}
          formatY={(v) => v.toFixed(0)}
        />
        <MetricCard
          icon={Database}
          title="Host uptime"
          description={snap ? new Date(snap.timestamp).toLocaleTimeString() : ''}
          value={snap ? formatDuration(snap.host.uptimeSeconds) : '—'}
          subtitle={
            snap?.pz.uptimeSeconds != null
              ? `server up ${formatDuration(snap.pz.uptimeSeconds)}`
              : undefined
          }
          // No sparkline — uptime is monotonic, not interesting as a line.
          values={[]}
        />
      </div>
    </div>
  );
}

// -- Card --------------------------------------------------------------------

function MetricCard(props: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  value: string;
  subtitle?: string;
  values: number[];
  max?: number;
  formatY?: (v: number) => string;
}): JSX.Element {
  const { icon: Icon, title, description, value, subtitle, values, max, formatY } = props;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <CardDescription className="truncate text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-1">
        <div className="font-mono text-2xl font-semibold tabular-nums">{value}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        {values.length >= 2 && (
          <Sparkline values={values} max={max} formatY={formatY ?? ((v) => v.toFixed(0))} />
        )}
        {values.length === 0 && <div className="h-8" />}
        {values.length === 1 && (
          <div className="text-[10px] text-muted-foreground">collecting…</div>
        )}
      </CardContent>
    </Card>
  );
}

// -- Sparkline ---------------------------------------------------------------

function Sparkline(props: {
  values: number[];
  max?: number;
  formatY: (v: number) => string;
}): JSX.Element {
  const { values, max, formatY } = props;
  // Auto-fit Y axis if no explicit max — but leave a 10% headroom so the line
  // doesn't ride the top edge.
  const observed = Math.max(...values, 0);
  const effectiveMax = max ?? Math.max(observed * 1.1, 1);
  const w = 200;
  const h = 36;
  const stepX = values.length > 1 ? w / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = i * stepX;
    const y = h - (Math.max(0, Math.min(v, effectiveMax)) / effectiveMax) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = pts.join(' ');
  const fill = `0,${h} ${polyline} ${w},${h}`;
  const last = values[values.length - 1];
  const min = Math.min(...values);
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className={cn('h-8 w-full', 'text-primary')}
      >
        <polygon points={fill} className="fill-current opacity-15" />
        <polyline
          points={polyline}
          className="fill-none stroke-current"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>min {formatY(min)}</span>
        <span>now {formatY(last ?? 0)}</span>
        <span>max {formatY(observed)}</span>
      </div>
    </div>
  );
}

// -- Helpers ----------------------------------------------------------------

function seriesNumbersOrZero(values: Array<number | null>): number[] {
  // The sparkline doesn't handle gaps — render nulls as 0 so a stopped server
  // shows a flat baseline rather than disappearing entirely. Acceptable
  // because every nullable metric has its own description text explaining the
  // state ("server stopped", "querying…").
  return values.map((v) => (v == null ? 0 : v));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function truncatePath(path: string, max: number): string {
  if (path.length <= max) return path;
  return '…' + path.slice(-(max - 1));
}

function secondsAgo(ts: number): number {
  return Math.floor((Date.now() - ts) / 1000);
}
