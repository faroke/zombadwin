import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type AppConfig, persistConfig } from '../config.js';
import { startScriptName } from './paths.js';

function tarBinary(): string {
  if (platform() === 'win32') {
    const root = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
    const candidate = join(root, 'System32', 'tar.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'tar';
}

export type InstallState =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'installing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface InstallLogLine {
  id: number;
  ts: number;
  source: 'out' | 'err' | 'sys';
  text: string;
}

export interface InstallSnapshot {
  state: InstallState;
  targetDir: string | null;
  /** Steam beta branch used by the last/current install (e.g. "b42unstable"). null = default branch (B41 stable). */
  branch: string | null;
  /** Steam download/install percent (0-100), parsed from steamcmd output when available */
  percent: number | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

const STEAM_APP_ID = '380870';
const RING_BUFFER_SIZE = 2000;

const STEAMCMD_WINDOWS_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const STEAMCMD_LINUX_URL =
  'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';

interface InstallServiceEvents {
  log: (line: InstallLogLine) => void;
  state: (snapshot: InstallSnapshot) => void;
}

export declare interface InstallService {
  on<K extends keyof InstallServiceEvents>(event: K, listener: InstallServiceEvents[K]): this;
  off<K extends keyof InstallServiceEvents>(event: K, listener: InstallServiceEvents[K]): this;
  emit<K extends keyof InstallServiceEvents>(
    event: K,
    ...args: Parameters<InstallServiceEvents[K]>
  ): boolean;
}

export class InstallService extends EventEmitter {
  private state: InstallState = 'idle';
  private targetDir: string | null = null;
  private branch: string | null = null;
  private percent: number | null = null;
  private error: string | null = null;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private readonly logs: InstallLogLine[] = [];
  private nextLogId = 1;
  private currentProc: ChildProcessWithoutNullStreams | null = null;
  private abortDownload: AbortController | null = null;

  constructor(private readonly config: AppConfig) {
    super();
  }

  getSnapshot(): InstallSnapshot {
    return {
      state: this.state,
      targetDir: this.targetDir,
      branch: this.branch,
      percent: this.percent,
      error: this.error,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }

  getRecentLogs(limit = RING_BUFFER_SIZE): InstallLogLine[] {
    if (limit >= this.logs.length) return this.logs.slice();
    return this.logs.slice(this.logs.length - limit);
  }

  isBusy(): boolean {
    return (
      this.state === 'downloading' ||
      this.state === 'extracting' ||
      this.state === 'installing'
    );
  }

  async start(targetDir: string, branch: string | null = null): Promise<InstallSnapshot> {
    if (this.isBusy()) throw new Error(`install already in progress (${this.state})`);
    const absTarget = resolve(targetDir);
    this.targetDir = absTarget;
    this.branch = branch && branch.trim().length > 0 ? branch.trim() : null;
    this.error = null;
    this.percent = null;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.logs.length = 0;
    this.nextLogId = 1;
    this.pushSys(`install target: ${absTarget}`);
    this.pushSys(`steam branch: ${this.branch ?? '(default / stable)'}`);

    // Run async, do not await — the route returns immediately.
    this.runPipeline(absTarget).catch((err: Error) => {
      this.pushSys(`pipeline error: ${err.message}`);
      this.fail(err.message);
    });

    return this.getSnapshot();
  }

  async cancel(): Promise<InstallSnapshot> {
    if (!this.isBusy()) return this.getSnapshot();
    this.pushSys('cancellation requested');
    if (this.abortDownload) this.abortDownload.abort();
    if (this.currentProc) this.currentProc.kill('SIGTERM');
    this.setState('cancelled');
    this.finishedAt = Date.now();
    return this.getSnapshot();
  }

  private async runPipeline(targetDir: string): Promise<void> {
    const steamcmdDir = join(this.config.dataDir, 'steamcmd');
    mkdirSync(steamcmdDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    const steamcmdExe = this.steamcmdExecutable(steamcmdDir);

    if (!existsSync(steamcmdExe)) {
      this.setState('downloading');
      await this.downloadSteamcmd(steamcmdDir);

      this.setState('extracting');
      await this.extractSteamcmd(steamcmdDir);

      if (!existsSync(steamcmdExe)) {
        throw new Error(
          `SteamCMD executable not found after extraction at ${steamcmdExe}`,
        );
      }
    } else {
      this.pushSys(`SteamCMD already present at ${steamcmdExe}`);
    }

    this.setState('installing');
    await this.runSteamcmd(steamcmdExe, targetDir);

    const startScript = join(targetDir, startScriptName());
    if (!existsSync(startScript)) {
      throw new Error(`PZ start script not found after install at ${startScript}`);
    }

    // Persist the install dir and chosen branch so the PZ process service
    // can find it and a later "Update" reuses the same branch by default.
    this.config.pzInstallDir = targetDir;
    this.config.pzBranch = this.branch;
    persistConfig(this.config);

    this.finishedAt = Date.now();
    this.percent = 100;
    this.setState('done');
    this.pushSys(`install complete (start script: ${startScript})`);
  }

  private steamcmdExecutable(dir: string): string {
    return platform() === 'win32' ? join(dir, 'steamcmd.exe') : join(dir, 'steamcmd.sh');
  }

  private async downloadSteamcmd(steamcmdDir: string): Promise<void> {
    const isWin = platform() === 'win32';
    const url = isWin ? STEAMCMD_WINDOWS_URL : STEAMCMD_LINUX_URL;
    const archive = join(steamcmdDir, isWin ? 'steamcmd.zip' : 'steamcmd.tar.gz');

    this.pushSys(`downloading SteamCMD: ${url}`);
    this.abortDownload = new AbortController();
    const res = await fetch(url, { signal: this.abortDownload.signal });
    if (!res.ok || !res.body) {
      throw new Error(`failed to download SteamCMD: HTTP ${res.status}`);
    }
    const file = createWriteStream(archive);
    await pipeline(Readable.fromWeb(res.body as never), file);
    this.abortDownload = null;
    this.pushSys(`downloaded to ${archive}`);
  }

  private async extractSteamcmd(steamcmdDir: string): Promise<void> {
    const isWin = platform() === 'win32';
    const archive = join(steamcmdDir, isWin ? 'steamcmd.zip' : 'steamcmd.tar.gz');
    this.pushSys(`extracting ${archive}`);
    // tar.exe is built into Windows 10 (1803+) and handles both .zip and .tar.gz.
    // On Windows, force System32\tar.exe (bsdtar) — a Node process launched from
    // Git-Bash / MSYS picks up GNU tar first which rejects "C:\..." paths.
    await this.runChild(tarBinary(), ['-xf', archive, '-C', steamcmdDir]);
    this.pushSys('extraction complete');
  }

  private async runSteamcmd(steamcmdExe: string, installDir: string): Promise<void> {
    // app_update accepts `-beta <branch>` (and optionally `-betapassword <pw>`)
    // BEFORE the `validate` token, telling Steam to install the named beta
    // instead of the default branch. Project Zomboid's B42 lives on the
    // public "b42unstable" beta; the password-protected betas aren't
    // supported here yet.
    const branchArgs = this.branch ? ['-beta', this.branch] : [];
    const args = [
      '+force_install_dir',
      installDir,
      '+login',
      'anonymous',
      '+app_update',
      STEAM_APP_ID,
      ...branchArgs,
      'validate',
      '+quit',
    ];
    const attempt = async (n: number): Promise<void> => {
      this.pushSys(`running SteamCMD (attempt ${n}): ${steamcmdExe} ${args.join(' ')}`);
      await this.runChild(steamcmdExe, args, (line) => this.parseProgress(line));
    };
    try {
      await attempt(1);
    } catch (err) {
      // If the user clicked Cancel, surface the original error directly.
      if (this.state === 'cancelled') throw err;
      // On a brand-new SteamCMD checkout, the first run always self-updates and
      // populates the Steam package cache before it can resolve an app id. Valve
      // ships the client this way; the first run typically prints
      // "ERROR! Failed to install app 'X' (Missing configuration)" and exits
      // non-zero even though everything is actually fine — the next run works.
      // Retry once after a short pause so file handles fully release.
      this.pushSys(
        `attempt 1 failed (${(err as Error).message}). SteamCMD just self-updated ` +
          `and populated its package cache; retrying once.`,
      );
      await new Promise((r) => setTimeout(r, 2000));
      await attempt(2);
    }
  }

  private parseProgress(line: string): void {
    // Steam emits lines like:
    //   "Update state (0x61) downloading, progress: 12.34 (123/456)"
    //   "Update state (0x101) committing, progress: 100.00 (456/456)"
    const m = line.match(/progress:\s*([\d.]+)/i);
    if (m) {
      const pct = Math.max(0, Math.min(100, Number(m[1])));
      if (!Number.isNaN(pct)) {
        this.percent = pct;
        this.emit('state', this.getSnapshot());
      }
    }
  }

  private runChild(
    cmd: string,
    args: string[],
    onStdoutLine?: (text: string) => void,
  ): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      const proc = spawn(cmd, args, { windowsHide: true });
      this.currentProc = proc;

      let stdoutBuf = '';
      let stderrBuf = '';

      const flushLines = (
        buf: string,
        source: 'out' | 'err',
        cb?: (text: string) => void,
      ): string => {
        const parts = buf.split(/\r?\n/);
        const incomplete = parts.pop() ?? '';
        for (const text of parts) {
          this.pushLog(source, text);
          if (cb) cb(text);
        }
        return incomplete;
      };

      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        stdoutBuf = flushLines(stdoutBuf + chunk, 'out', onStdoutLine);
      });
      proc.stderr.on('data', (chunk: string) => {
        stderrBuf = flushLines(stderrBuf + chunk, 'err');
      });

      proc.on('error', (err) => {
        this.currentProc = null;
        rejectPromise(err);
      });
      proc.on('exit', (code, signal) => {
        if (stdoutBuf) this.pushLog('out', stdoutBuf);
        if (stderrBuf) this.pushLog('err', stderrBuf);
        this.currentProc = null;
        if (signal && this.state === 'cancelled') {
          resolvePromise();
          return;
        }
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`${cmd} exited with code ${code}`));
      });
    });
  }

  private fail(message: string): void {
    this.error = message;
    this.finishedAt = Date.now();
    this.setState('error');
  }

  private pushSys(text: string): void {
    this.pushLog('sys', text);
  }

  private pushLog(source: InstallLogLine['source'], text: string): void {
    const line: InstallLogLine = { id: this.nextLogId++, ts: Date.now(), source, text };
    this.logs.push(line);
    if (this.logs.length > RING_BUFFER_SIZE) this.logs.shift();
    this.emit('log', line);
  }

  private setState(next: InstallState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('state', this.getSnapshot());
  }
}

let instance: InstallService | null = null;

export function initInstallService(config: AppConfig): InstallService {
  if (instance) return instance;
  instance = new InstallService(config);
  return instance;
}

export function getInstallService(): InstallService {
  if (!instance) throw new Error('InstallService not initialized');
  return instance;
}
