import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { cpus, freemem, platform, totalmem, uptime, type CpuInfo } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { defaultUserDir } from './paths.js';
import { getPzProcess } from './pzProcess.js';

export interface MonitoringSnapshot {
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
  diskIo: {
    /** Aggregate read throughput across all physical disks, in bytes/sec. */
    readBytesPerSec: number | null;
    /** Aggregate write throughput across all physical disks, in bytes/sec. */
    writeBytesPerSec: number | null;
    /** PerfMon "% Disk Time" on _Total. >100% means the queue is saturated
     *  across multiple spindles — we don't clamp because the raw counter is
     *  what's useful for diagnosing thrash. */
    activePercent: number | null;
    error: string | null;
  };
  players: {
    count: number | null;
    queriedAt: number | null;
    error: string | null;
  };
}

const SAVE_SIZE_CACHE_MS = 30_000;
const PLAYER_CACHE_MS = 15_000;
const PZ_SAMPLE_TIMEOUT_MS = 1500;
const DISK_IO_SAMPLE_TIMEOUT_MS = 1500;

interface PzCpuSample {
  /** PZ process pid this sample is for — discarded if pid changes. */
  pid: number;
  /** Cumulative CPU time across all cores at sample time, in milliseconds. */
  processorTimeMs: number;
  /** Wall clock when we read processorTimeMs. */
  sampledAtMs: number;
}

interface SaveSizeCache {
  saveDir: string;
  serverName: string;
  bytes: number;
  computedAt: number;
}

interface PlayerCache {
  count: number;
  queriedAt: number;
}

interface DiskIoSample {
  /** Sum of `sectors read` * 512 across every block device in /proc/diskstats. */
  readBytesCumulative: number;
  /** Sum of `sectors written` * 512. */
  writeBytesCumulative: number;
  /** Sum of `time spent doing I/Os, ms`. */
  ioActiveMs: number;
  sampledAtMs: number;
}

class MonitoringService {
  /** Previous os.cpus() reading — needed to compute % between snapshots. */
  private lastCpus: CpuInfo[] | null = null;
  private lastPzCpu: PzCpuSample | null = null;
  private saveSizeCache: SaveSizeCache | null = null;
  private playersCache: PlayerCache | null = null;
  /** Prevents re-entrant player queries from piling up if the previous one is
   * still waiting for PZ to reply. */
  private playerQueryInFlight: Promise<unknown> | null = null;
  /** Previous /proc/diskstats reading (Linux only) — Windows uses Win32_Perf*
   * which already returns delta-applied rates. */
  private lastDiskIo: DiskIoSample | null = null;

  async snapshot(): Promise<MonitoringSnapshot> {
    const ts = Date.now();
    const cfg = loadConfig();
    const userDir = cfg.pzUserDir ?? defaultUserDir();
    const status = getPzProcess().getStatus();
    // pzProcess only updates its internal `serverName` when start() is called;
    // before the first run it reports the hardcoded default. The on-disk save
    // dir we care about is whichever profile is currently *active*.
    const serverName = status.state === 'stopped' ? cfg.activeServer : status.serverName;

    const [host, pz, disk, diskIo] = await Promise.all([
      this.sampleHost(),
      this.samplePz(status.pid),
      this.sampleDisk(cfg.pzInstallDir, userDir, serverName),
      this.sampleDiskIo(),
    ]);

    return {
      timestamp: ts,
      host,
      pz: { ...pz, state: status.state, uptimeSeconds: pzUptimeSeconds(status.startedAt) },
      disk,
      diskIo,
      players: this.samplePlayers(status.state),
    };
  }

  // -- Host ----------------------------------------------------------------

  private sampleHost(): MonitoringSnapshot['host'] {
    const curr = cpus();
    let cpuPercent = 0;
    if (this.lastCpus && this.lastCpus.length === curr.length) {
      let totalIdle = 0;
      let totalTotal = 0;
      for (let i = 0; i < curr.length; i++) {
        const c = curr[i]!.times;
        const p = this.lastCpus[i]!.times;
        const idle = c.idle - p.idle;
        const tot = c.user - p.user + (c.nice - p.nice) + (c.sys - p.sys) + idle + (c.irq - p.irq);
        totalIdle += idle;
        totalTotal += tot;
      }
      cpuPercent = totalTotal === 0 ? 0 : Math.max(0, Math.min(100, (1 - totalIdle / totalTotal) * 100));
    }
    this.lastCpus = curr;

    const memTotalBytes = totalmem();
    const memUsedBytes = memTotalBytes - freemem();
    return {
      cpuPercent,
      memTotalBytes,
      memUsedBytes,
      uptimeSeconds: uptime(),
      platform: platform(),
      cores: curr.length,
    };
  }

  // -- PZ process ----------------------------------------------------------

  private async samplePz(pid: number | null): Promise<Omit<MonitoringSnapshot['pz'], 'state' | 'uptimeSeconds'>> {
    if (pid == null) {
      // The process is gone — reset the CPU tracker so a re-start doesn't get
      // a bogus delta against a stale processorTime from the previous pid.
      this.lastPzCpu = null;
      return { pid: null, workingSetBytes: null, cpuPercent: null, sampleError: null };
    }
    try {
      const raw = await readPzProcessStats(pid);
      let cpuPercent: number | null = null;
      const now = Date.now();
      if (this.lastPzCpu && this.lastPzCpu.pid === pid) {
        const wallDelta = now - this.lastPzCpu.sampledAtMs;
        const cpuDelta = raw.processorTimeMs - this.lastPzCpu.processorTimeMs;
        if (wallDelta > 0) {
          // Normalise so 100% = one full core. Multi-core JVM can exceed 100%.
          cpuPercent = Math.max(0, (cpuDelta / wallDelta) * 100);
        }
      }
      this.lastPzCpu = { pid, processorTimeMs: raw.processorTimeMs, sampledAtMs: now };
      return {
        pid,
        workingSetBytes: raw.workingSetBytes,
        cpuPercent,
        sampleError: null,
      };
    } catch (err) {
      // First sample after start often races the spawn — log once but keep
      // returning so the snapshot stays well-formed.
      return {
        pid,
        workingSetBytes: null,
        cpuPercent: null,
        sampleError: (err as Error).message,
      };
    }
  }

  // -- Disk ----------------------------------------------------------------

  private async sampleDisk(
    installDir: string | null,
    userDir: string,
    serverName: string,
  ): Promise<MonitoringSnapshot['disk']> {
    let installDirFreeBytes: number | null = null;
    let installDirTotalBytes: number | null = null;
    if (installDir && existsSync(installDir)) {
      try {
        const s = await statfs(installDir);
        installDirFreeBytes = Number(s.bavail) * Number(s.bsize);
        installDirTotalBytes = Number(s.blocks) * Number(s.bsize);
      } catch {
        // Some Windows network mounts don't support statfs — leave null.
      }
    }

    const saveDir = join(userDir, 'Saves', 'Multiplayer', serverName);
    let saveDirSizeBytes: number | null = null;
    let saveDirError: string | null = null;
    try {
      const cached = this.saveSizeCache;
      if (
        cached &&
        cached.saveDir === saveDir &&
        cached.serverName === serverName &&
        Date.now() - cached.computedAt < SAVE_SIZE_CACHE_MS
      ) {
        saveDirSizeBytes = cached.bytes;
      } else if (existsSync(saveDir)) {
        const bytes = directorySize(saveDir);
        this.saveSizeCache = { saveDir, serverName, bytes, computedAt: Date.now() };
        saveDirSizeBytes = bytes;
      } else {
        saveDirSizeBytes = 0;
      }
    } catch (err) {
      saveDirError = (err as Error).message;
    }

    return {
      installDir,
      installDirFreeBytes,
      installDirTotalBytes,
      saveDir,
      saveDirSizeBytes,
      saveDirError,
    };
  }

  // -- Disk I/O ------------------------------------------------------------

  private async sampleDiskIo(): Promise<MonitoringSnapshot['diskIo']> {
    try {
      if (platform() === 'win32') {
        return await sampleDiskIoWindows();
      }
      return this.sampleDiskIoLinux();
    } catch (err) {
      return {
        readBytesPerSec: null,
        writeBytesPerSec: null,
        activePercent: null,
        error: (err as Error).message,
      };
    }
  }

  private async sampleDiskIoLinux(): Promise<MonitoringSnapshot['diskIo']> {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile('/proc/diskstats', 'utf8');
    let readSectors = 0;
    let writeSectors = 0;
    let ioMs = 0;
    for (const line of raw.split('\n')) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 14) continue;
      const dev = fields[2] ?? '';
      // Skip per-partition entries (sda1, sdb2, …); keep whole-disk only.
      // The kernel exposes both — counting both would double the totals.
      if (/\d+$/.test(dev) && !/^nvme\d+n\d+$/.test(dev)) continue;
      readSectors += Number(fields[5] ?? 0);
      writeSectors += Number(fields[9] ?? 0);
      ioMs += Number(fields[12] ?? 0);
    }
    const sectorSize = 512;
    const now = Date.now();
    const sample: DiskIoSample = {
      readBytesCumulative: readSectors * sectorSize,
      writeBytesCumulative: writeSectors * sectorSize,
      ioActiveMs: ioMs,
      sampledAtMs: now,
    };
    const prev = this.lastDiskIo;
    this.lastDiskIo = sample;
    if (!prev) {
      // First reading — return zeros instead of null so the line starts
      // somewhere; the next sample will produce a real rate.
      return { readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0, error: null };
    }
    const wallDelta = sample.sampledAtMs - prev.sampledAtMs;
    if (wallDelta <= 0) {
      return { readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0, error: null };
    }
    return {
      readBytesPerSec: ((sample.readBytesCumulative - prev.readBytesCumulative) * 1000) / wallDelta,
      writeBytesPerSec: ((sample.writeBytesCumulative - prev.writeBytesCumulative) * 1000) / wallDelta,
      activePercent: ((sample.ioActiveMs - prev.ioActiveMs) / wallDelta) * 100,
      error: null,
    };
  }

  // -- Players -------------------------------------------------------------

  /** Returns the cached player count and triggers a refresh if stale. The
   *  query writes to PZ stdin (`players` command) so we don't run it on every
   *  2-second monitoring poll — at most once per PLAYER_CACHE_MS. */
  private samplePlayers(state: string): MonitoringSnapshot['players'] {
    const running = state === 'running';
    if (!running) {
      this.playersCache = null;
      this.playerQueryInFlight = null;
      return { count: null, queriedAt: null, error: null };
    }
    const cache = this.playersCache;
    const cacheFresh = cache && Date.now() - cache.queriedAt < PLAYER_CACHE_MS;
    if (!cacheFresh && !this.playerQueryInFlight) {
      this.playerQueryInFlight = getPzProcess()
        .queryPlayers()
        .then((players) => {
          this.playersCache = { count: players.length, queriedAt: Date.now() };
        })
        .catch(() => {
          // Swallow — surface as `error` on the next poll if cache is empty.
        })
        .finally(() => {
          this.playerQueryInFlight = null;
        });
    }
    if (cache) {
      return { count: cache.count, queriedAt: cache.queriedAt, error: null };
    }
    return { count: null, queriedAt: null, error: null };
  }
}

function pzUptimeSeconds(startedAt: number | null): number | null {
  if (startedAt == null) return null;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

/**
 * Walks a directory and sums file sizes. Synchronous because the call site
 * already throttles via SAVE_SIZE_CACHE_MS; using async fs here would just
 * fan-out the work without changing total wall time.
 */
function directorySize(dir: string): number {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const next = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(next);
    } catch {
      continue;
    }
    for (const name of entries) {
      const p = join(next, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(p);
      else if (st.isFile()) total += st.size;
    }
  }
  return total;
}

/**
 * Reads working-set RAM and cumulative CPU time for a given pid. Windows uses
 * PowerShell's Get-Process (only stdlib available); Linux reads /proc/<pid>/.
 */
async function readPzProcessStats(pid: number): Promise<{ workingSetBytes: number; processorTimeMs: number }> {
  if (platform() === 'win32') {
    return readPzProcessStatsWindows(pid);
  }
  return readPzProcessStatsLinux(pid);
}

function readPzProcessStatsWindows(pid: number): Promise<{ workingSetBytes: number; processorTimeMs: number }> {
  // PowerShell's Get-Process exposes WorkingSet64 (bytes RSS) and
  // TotalProcessorTime (cumulative across cores). Emitting a one-line JSON
  // keeps the parser trivial and survives a quoting hiccup.
  const script = `Get-Process -Id ${pid} -ErrorAction Stop | ` +
    `Select-Object -Property @{N='ws';E={[int64]$_.WorkingSet64}},` +
    `@{N='ms';E={[int64]$_.TotalProcessorTime.TotalMilliseconds}} | ` +
    `ConvertTo-Json -Compress`;
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      rejectPromise(new Error(`Get-Process timed out for pid ${pid}`));
    }, PZ_SAMPLE_TIMEOUT_MS);
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (e) => {
      clearTimeout(timer);
      rejectPromise(e);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(new Error(`Get-Process exited ${code}: ${stderr.trim().slice(0, 200)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as { ws: number; ms: number };
        resolvePromise({ workingSetBytes: Number(parsed.ws), processorTimeMs: Number(parsed.ms) });
      } catch (e) {
        rejectPromise(new Error(`failed to parse Get-Process output: ${(e as Error).message}`));
      }
    });
  });
}

async function readPzProcessStatsLinux(pid: number): Promise<{ workingSetBytes: number; processorTimeMs: number }> {
  // /proc/<pid>/stat fields, space-separated. After comm (may contain spaces
  // wrapped in parens), the user/sys time are fields 14 and 15. RSS is field 24
  // (in pages). See `man 5 proc`.
  const { readFile } = await import('node:fs/promises');
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  const closeParen = stat.lastIndexOf(')');
  const after = stat.slice(closeParen + 2).split(/\s+/);
  // after[0] is state (S/R/D/...), then ppid, pgrp, session, tty_nr, tpgid, flags
  // utime is index 11, stime index 12, rss index 21 (zero-indexed after `state`)
  const utime = Number(after[11]);
  const stime = Number(after[12]);
  const rssPages = Number(after[21]);
  // sysconf CLK_TCK is conventionally 100 on Linux — close enough for a
  // monitoring readout; if a user runs on a kernel with a different value,
  // their CPU% reading will be off by a constant factor.
  const clkTck = 100;
  const processorTimeMs = ((utime + stime) / clkTck) * 1000;
  const pageSize = 4096;
  return { workingSetBytes: rssPages * pageSize, processorTimeMs };
}

/**
 * Reads aggregate disk I/O rates on Windows via the WMI performance counter
 * for the synthetic `_Total` instance. `Win32_PerfFormattedData_PerfDisk_PhysicalDisk`
 * returns values that are already delta-applied by the PDH (Performance Data
 * Helper) layer — we don't have to keep prev-state ourselves, unlike Linux.
 *
 * Shells to PowerShell because Node has no stdlib WMI access. The call is fast
 * (~80-150ms) since we don't ask Get-Counter for a sampling interval.
 */
function sampleDiskIoWindows(): Promise<MonitoringSnapshot['diskIo']> {
  const script =
    "Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter \"Name='_Total'\" | " +
    'Select-Object -Property @{N=\'r\';E={[int64]$_.DiskReadBytesPerSec}},' +
    '@{N=\'w\';E={[int64]$_.DiskWriteBytesPerSec}},' +
    '@{N=\'a\';E={[int64]$_.PercentDiskTime}} | ConvertTo-Json -Compress';
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      rejectPromise(new Error('Win32_PerfFormattedData_PerfDisk_PhysicalDisk timed out'));
    }, DISK_IO_SAMPLE_TIMEOUT_MS);
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (e) => {
      clearTimeout(timer);
      rejectPromise(e);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(new Error(`disk-io perfcounter exit ${code}: ${stderr.trim().slice(0, 200)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as { r: number; w: number; a: number };
        resolvePromise({
          readBytesPerSec: Number(parsed.r),
          writeBytesPerSec: Number(parsed.w),
          activePercent: Number(parsed.a),
          error: null,
        });
      } catch (e) {
        rejectPromise(new Error(`failed to parse perfcounter output: ${(e as Error).message}`));
      }
    });
  });
}

let instance: MonitoringService | null = null;
export function getMonitoringService(): MonitoringService {
  if (!instance) instance = new MonitoringService();
  return instance;
}
