import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { type AppConfig, loadConfig } from '../config.js';
import { readIniFile, serverIniPath } from './iniFile.js';
import { defaultUserDir, resolveInstallDir, startScriptName } from './paths.js';

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';

export interface LogLine {
  /** Monotonic line id, useful for de-duplication on reconnect */
  id: number;
  /** Epoch ms */
  ts: number;
  /** 'out' for stdout, 'err' for stderr, 'sys' for orchestrator messages */
  source: 'out' | 'err' | 'sys';
  text: string;
}

export interface StatusSnapshot {
  state: ServerState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  installDir: string | null;
  serverName: string;
}

interface SpawnConfig {
  command: string;
  args: string[];
  cwd: string;
}

const RING_BUFFER_SIZE = 2000;
const STOP_GRACE_MS = 60_000;

export interface PzProcessEvents {
  log: (line: LogLine) => void;
  status: (snapshot: StatusSnapshot) => void;
}

export declare interface PzProcessService {
  on<K extends keyof PzProcessEvents>(event: K, listener: PzProcessEvents[K]): this;
  off<K extends keyof PzProcessEvents>(event: K, listener: PzProcessEvents[K]): this;
  emit<K extends keyof PzProcessEvents>(event: K, ...args: Parameters<PzProcessEvents[K]>): boolean;
}

export class PzProcessService extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private state: ServerState = 'stopped';
  private startedAt: number | null = null;
  private exitCode: number | null = null;
  private readonly logs: LogLine[] = [];
  private nextLogId = 1;
  /** Server name used by the *currently running* process; tracks config.activeServer at start time. */
  private serverName = 'servertest';
  private stopGraceTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: AppConfig) {
    super();
  }

  getStatus(): StatusSnapshot {
    return {
      state: this.state,
      pid: this.proc?.pid ?? null,
      startedAt: this.startedAt,
      exitCode: this.exitCode,
      installDir: this.config.pzInstallDir,
      serverName: this.serverName,
    };
  }

  getRecentLogs(limit = RING_BUFFER_SIZE): LogLine[] {
    if (limit >= this.logs.length) return this.logs.slice();
    return this.logs.slice(this.logs.length - limit);
  }

  /** Returns the server name used by the currently running process (or last run). */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * Reads DefaultPort / UDPPort from the active profile's INI when it exists,
   * falling back to PZ's compiled-in defaults (16261 + 16262). We don't try
   * to be clever about other ports the user may have configured manually in a
   * profile that's not the active one.
   */
  private detectServerPorts(): number[] {
    try {
      const userDir = loadConfig().pzUserDir ?? defaultUserDir();
      const iniPath = serverIniPath(userDir, this.serverName);
      if (!existsSync(iniPath)) return [16261, 16262];
      const ini = readIniFile(iniPath);
      const game = Number(ini.values.DefaultPort);
      const udp = Number(ini.values.UDPPort);
      return [
        Number.isFinite(game) && game > 0 ? game : 16261,
        Number.isFinite(udp) && udp > 0 ? udp : 16262,
      ];
    } catch {
      return [16261, 16262];
    }
  }

  /** True iff a process is currently up and using this server name. */
  isRunningAs(name: string): boolean {
    return this.proc !== null && this.serverName === name;
  }

  private resolveSpawnConfig(): SpawnConfig {
    // Optional override for development (lets us test without a real PZ install).
    const override = process.env.ZOMBADWIN_SERVER_CMD_OVERRIDE;
    if (override) {
      const parts = override.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
      const [command, ...rest] = parts.map((p) => p.replace(/^"|"$/g, ''));
      if (!command) throw new Error('ZOMBADWIN_SERVER_CMD_OVERRIDE is empty');
      return {
        command,
        args: rest,
        cwd: process.env.ZOMBADWIN_SERVER_CWD_OVERRIDE ?? process.cwd(),
      };
    }

    const paths = resolveInstallDir(this.config.pzInstallDir);
    if (!paths.startScript || !paths.installDir) {
      throw new Error(
        `Project Zomboid server not installed. Expected ${startScriptName()} in pzInstallDir.`,
      );
    }

    // Forward -servername so PZ uses our INI/Lua filenames consistently.
    const args = ['-servername', this.serverName];

    if (platform() === 'win32') {
      // Spawn through cmd /c so .bat resolution works without shell:true.
      return {
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/c', paths.startScript, ...args],
        cwd: paths.installDir,
      };
    }
    return { command: paths.startScript, args, cwd: paths.installDir };
  }

  async start(): Promise<StatusSnapshot> {
    if (this.state !== 'stopped') {
      throw new Error(`Cannot start while state is ${this.state}`);
    }

    // Pick up the active profile name from the persisted config, so switching
    // profiles via the API takes effect on the next start.
    this.serverName = loadConfig().activeServer || this.serverName;

    // Pre-flight: fail fast when the UDP ports are already bound. PZ loads
    // ~7 minutes of assets and Lua before it tries RakNet startup, so a
    // RAKNET_STARTED=5 (SOCKET_PORT_ALREADY_IN_USE) error at the very end is
    // an awful wait. This catches the common "previous instance is still
    // alive (crashed/hung)" case immediately.
    const ports = this.detectServerPorts();
    for (const port of ports) {
      const busyPid = await udpPortBusy(port);
      if (busyPid !== null) {
        const hint =
          busyPid > 0
            ? ` Process ID ${busyPid} is holding it (Task Manager → Details, or PowerShell: Stop-Process -Id ${busyPid} -Force).`
            : ' Run `netstat -ano -p UDP | findstr :' + port + '` to find which PID is holding it.';
        const msg =
          `UDP port ${port} is already in use — another Project Zomboid server is probably ` +
          `still running.${hint}`;
        this.pushSys(msg);
        throw new Error(msg);
      }
    }

    const spawnCfg = this.resolveSpawnConfig();
    this.setState('starting');
    this.exitCode = null;

    const proc = spawn(spawnCfg.command, spawnCfg.args, {
      cwd: spawnCfg.cwd,
      windowsHide: true,
    });

    this.proc = proc;
    this.startedAt = Date.now();
    this.pushSys(`spawning ${spawnCfg.command} ${spawnCfg.args.join(' ')}`);

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.ingest(chunk, 'out'));
    proc.stderr.on('data', (chunk: string) => this.ingest(chunk, 'err'));

    proc.on('error', (err) => {
      this.pushSys(`process error: ${err.message}`);
      this.setState('stopped');
    });

    proc.on('exit', (code, signal) => {
      this.exitCode = code;
      this.pushSys(`process exited (code=${code}, signal=${signal ?? 'none'})`);
      this.clearStopGrace();
      this.proc = null;
      this.startedAt = null;
      this.setState('stopped');
    });

    // We optimistically flip to 'running' once we observe meaningful output.
    // For a real PZ server, "Server is listening on port" appears once ready.
    // To keep this simple for v1 and not couple to PZ-specific strings, we
    // promote to 'running' as soon as stdout produces a line.
    proc.stdout.once('data', () => {
      if (this.state === 'starting') this.setState('running');
    });

    return this.getStatus();
  }

  async sendCommand(line: string): Promise<void> {
    if (!this.proc || this.state === 'stopped' || this.state === 'stopping') {
      throw new Error('Server is not running');
    }
    const trimmed = line.replace(/\r?\n$/, '');
    this.pushSys(`> ${trimmed}`);
    this.proc.stdin.write(`${trimmed}\n`);
  }

  /**
   * Sends the `players` command and collects the connected-player list from
   * the server's stdout. PZ replies with:
   *   "Players connected (N):"
   *   "-username (id=0)"
   *   ...
   *
   * We start collecting at the header line, then accumulate any `-name` lines
   * until output goes quiet for `quietMs` ms.
   */
  async queryPlayers(
    timeoutMs = 2500,
    quietMs = 350,
  ): Promise<Array<{ id: number; name: string }>> {
    if (this.state !== 'running') throw new Error('server not running');
    return new Promise((resolvePromise, rejectPromise) => {
      const collected: string[] = [];
      let capturing = false;
      let quietTimer: NodeJS.Timeout | null = null;

      const finish = (): void => {
        cleanup();
        resolvePromise(parsePlayerLines(collected));
      };
      const onLog = (line: LogLine): void => {
        if (line.source !== 'out') return;
        if (!capturing) {
          if (/Players connected/i.test(line.text)) {
            capturing = true;
            collected.push(line.text);
            quietTimer = setTimeout(finish, quietMs);
          }
          return;
        }
        // Once capturing, take any line that looks like a player entry or is blank.
        if (/^-/.test(line.text) || line.text.trim() === '') {
          collected.push(line.text);
          if (quietTimer) clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, quietMs);
          return;
        }
        // Anything else means PZ moved on — terminate collection.
        finish();
      };
      const cleanup = (): void => {
        this.off('log', onLog);
        if (quietTimer) clearTimeout(quietTimer);
        clearTimeout(globalTimeout);
      };
      const globalTimeout = setTimeout(() => {
        cleanup();
        if (collected.length > 0) {
          resolvePromise(parsePlayerLines(collected));
        } else {
          rejectPromise(new Error('player list query timed out'));
        }
      }, timeoutMs);

      this.on('log', onLog);
      void this.sendCommand('players').catch((err) => {
        cleanup();
        rejectPromise(err);
      });
    });
  }

  async stop(): Promise<StatusSnapshot> {
    if (this.state === 'stopped') return this.getStatus();
    if (this.state === 'stopping') return this.getStatus();
    if (!this.proc) return this.getStatus();

    this.setState('stopping');
    this.pushSys('graceful shutdown requested (sending "quit")');
    // Write the quit command then close stdin. PZ has already buffered "quit"
    // and will process its clean shutdown; the EOF that follows lets the
    // PAUSE at the end of StartServer64.bat return immediately instead of
    // blocking cmd.exe forever waiting for a keypress that never comes.
    try {
      this.proc.stdin.write('quit\n');
      this.proc.stdin.end();
    } catch (err) {
      this.pushSys(`stdin write failed: ${(err as Error).message}`);
    }

    this.clearStopGrace();
    this.stopGraceTimer = setTimeout(() => {
      if (this.proc && this.state === 'stopping') {
        this.pushSys(`grace period (${STOP_GRACE_MS}ms) elapsed — force-killing tree`);
        this.forceKillTree();
      }
    }, STOP_GRACE_MS);

    return this.getStatus();
  }

  private forceKillTree(): void {
    const proc = this.proc;
    if (!proc?.pid) return;
    if (platform() === 'win32') {
      // proc.kill on Windows uses TerminateProcess on the spawned process
      // (here cmd.exe) and does NOT walk the process tree. The java.exe
      // child would be orphaned and keep the ports bound. taskkill /T does
      // the right thing.
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', (err) => {
        this.pushSys(`taskkill failed: ${err.message}`);
      });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (this.proc) this.proc.kill('SIGKILL');
      }, 5000);
    }
  }

  async restart(): Promise<void> {
    if (this.state !== 'stopped') {
      await this.stop();
      await this.waitForState('stopped', STOP_GRACE_MS + 10_000);
    }
    await this.start();
  }

  private waitForState(target: ServerState, timeoutMs: number): Promise<void> {
    if (this.state === target) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('status', onStatus);
        reject(new Error(`Timed out waiting for state ${target}`));
      }, timeoutMs);
      const onStatus = (s: StatusSnapshot): void => {
        if (s.state === target) {
          clearTimeout(timer);
          this.off('status', onStatus);
          resolve();
        }
      };
      this.on('status', onStatus);
    });
  }

  private ingest(chunk: string, source: 'out' | 'err'): void {
    // Split on newlines so each line is its own log entry.
    const lines = chunk.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const text of lines) this.pushLine(source, text);
  }

  private pushLine(source: LogLine['source'], text: string): void {
    const line: LogLine = { id: this.nextLogId++, ts: Date.now(), source, text };
    this.logs.push(line);
    if (this.logs.length > RING_BUFFER_SIZE) this.logs.shift();
    this.emit('log', line);
  }

  private pushSys(text: string): void {
    this.pushLine('sys', text);
  }

  private setState(next: ServerState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('status', this.getStatus());
  }

  private clearStopGrace(): void {
    if (this.stopGraceTimer) {
      clearTimeout(this.stopGraceTimer);
      this.stopGraceTimer = null;
    }
  }
}

// Singleton for the running process. Initialized in server.ts.
let instance: PzProcessService | null = null;

export function initPzProcess(config: AppConfig): PzProcessService {
  if (instance) return instance;
  instance = new PzProcessService(config);
  return instance;
}

export function getPzProcess(): PzProcessService {
  if (!instance) throw new Error('PzProcessService not initialized');
  return instance;
}

/**
 * Tests whether a UDP port is free by trying to bind it on 0.0.0.0.
 * Returns null when the port is free, or a PID (when we can resolve it on
 * Windows) or 0 (port is busy, owner unknown) when it's not.
 */
async function udpPortBusy(port: number): Promise<number | null> {
  const free = await new Promise<boolean>((resolvePromise) => {
    const sock = createSocket('udp4');
    sock.once('error', () => resolvePromise(false));
    sock.once('listening', () => {
      sock.close();
      resolvePromise(true);
    });
    try {
      sock.bind(port);
    } catch {
      resolvePromise(false);
    }
  });
  if (free) return null;
  if (platform() === 'win32') {
    const pid = await resolveUdpOwnerPidWin(port);
    return pid ?? 0;
  }
  return 0;
}

function resolveUdpOwnerPidWin(port: number): Promise<number | null> {
  return new Promise((resolvePromise) => {
    // `netstat -ano -p UDP` lists "  UDP    0.0.0.0:16261     *:*    <pid>".
    // findstr filters to the relevant lines; we parse the last numeric column.
    const proc = spawn('cmd.exe', ['/c', `netstat -ano -p UDP | findstr :${port}`], {
      windowsHide: true,
    });
    let stdout = '';
    proc.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    proc.on('error', () => resolvePromise(null));
    proc.on('exit', () => {
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.trim().match(/\s(\d+)\s*$/);
        if (m) {
          const pid = Number(m[1]);
          if (Number.isFinite(pid) && pid > 0) {
            resolvePromise(pid);
            return;
          }
        }
      }
      resolvePromise(null);
    });
  });
}

function parsePlayerLines(lines: string[]): Array<{ id: number; name: string }> {
  const out: Array<{ id: number; name: string }> = [];
  for (const raw of lines) {
    const m = raw.match(/^-(.*?)\s*(?:\(id=(\d+)\))?\s*$/);
    if (!m) continue;
    const name = m[1]?.trim();
    if (!name) continue;
    out.push({ id: m[2] ? Number(m[2]) : -1, name });
  }
  return out;
}
