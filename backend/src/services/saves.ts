import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { loadConfig } from '../config.js';
import { defaultUserDir } from './paths.js';

export interface SaveInfo {
  profileName: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
  modifiedAt: number | null;
  fileCount: number;
}

export interface BackupFile {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: number;
  /** True when produced by the auto-backup scheduler (prefix "auto_") */
  isAuto: boolean;
}

export type BackupKind = 'manual' | 'auto';

function userDir(): string {
  const cfg = loadConfig();
  return cfg.pzUserDir ?? defaultUserDir();
}

export function saveDirFor(profile: string): string {
  return join(userDir(), 'Saves', 'Multiplayer', profile);
}

export function backupDirFor(profile: string): string {
  return join(loadConfig().dataDir, 'backups', profile);
}

export function getSaveInfo(profile: string): SaveInfo {
  const dir = saveDirFor(profile);
  if (!existsSync(dir)) {
    return {
      profileName: profile,
      path: dir,
      exists: false,
      sizeBytes: 0,
      modifiedAt: null,
      fileCount: 0,
    };
  }
  let sizeBytes = 0;
  let fileCount = 0;
  let modifiedAt = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const s = statSync(full);
        sizeBytes += s.size;
        fileCount += 1;
        if (s.mtimeMs > modifiedAt) modifiedAt = s.mtimeMs;
      } catch {
        /* ignore unreadable file */
      }
    }
  }
  return {
    profileName: profile,
    path: dir,
    exists: true,
    sizeBytes,
    modifiedAt: modifiedAt > 0 ? modifiedAt : null,
    fileCount,
  };
}

export function listBackups(profile: string): BackupFile[] {
  const dir = backupDirFor(profile);
  if (!existsSync(dir)) return [];
  const out: BackupFile[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.tar.gz')) continue;
    const full = join(dir, entry);
    try {
      const s = statSync(full);
      out.push({
        filename: entry,
        path: full,
        sizeBytes: s.size,
        createdAt: s.mtimeMs,
        isAuto: entry.startsWith('auto_'),
      });
    } catch {
      /* ignore */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Create a tar.gz backup of the save directory for a profile. */
export async function createBackup(profile: string, kind: BackupKind): Promise<BackupFile> {
  const src = saveDirFor(profile);
  if (!existsSync(src)) {
    throw new Error(`No save directory at ${src}. Start the server at least once.`);
  }
  const dest = backupDirFor(profile);
  mkdirSync(dest, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = kind === 'auto' ? 'auto_' : '';
  const filename = `${prefix}${profile}_${ts}.tar.gz`;
  const archive = join(dest, filename);

  // tar -czf <archive> -C <parent-of-save> <savefolder>
  await runTar(['-czf', archive, '-C', dirname(src), basename(src)]);

  const s = statSync(archive);
  return {
    filename,
    path: archive,
    sizeBytes: s.size,
    createdAt: s.mtimeMs,
    isAuto: kind === 'auto',
  };
}

export async function restoreBackup(
  profile: string,
  filename: string,
  isRunning: () => boolean,
): Promise<void> {
  if (isRunning()) throw new Error('Stop the server before restoring a backup');
  if (!isValidFilename(filename)) throw new Error('Invalid filename');
  const archive = join(backupDirFor(profile), filename);
  if (!existsSync(archive)) throw new Error(`Backup not found: ${filename}`);

  const dst = saveDirFor(profile);
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  mkdirSync(dirname(dst), { recursive: true });
  await runTar(['-xzf', archive, '-C', dirname(dst)]);
}

export function deleteSave(profile: string, isRunning: () => boolean): void {
  if (isRunning()) throw new Error('Stop the server before deleting its save');
  const dir = saveDirFor(profile);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

export function deleteBackup(profile: string, filename: string): void {
  if (!isValidFilename(filename)) throw new Error('Invalid filename');
  const full = join(backupDirFor(profile), filename);
  if (existsSync(full)) rmSync(full, { force: true });
}

function isValidFilename(name: string): boolean {
  return !name.includes('/') && !name.includes('\\') && !name.includes('..') && name.endsWith('.tar.gz');
}

function tarExecutable(): string {
  // On Windows, force the System32 bsdtar (ships since Win10 1803). Otherwise
  // a Node process started from a Git-Bash / MSYS shell will pick up GNU tar
  // first, and GNU tar treats absolute Windows paths like "C:\..." as remote
  // host:path specs and refuses to operate on them.
  if (platform() === 'win32') {
    const root = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
    const candidate = join(root, 'System32', 'tar.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'tar';
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(tarExecutable(), args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', rejectPromise);
    proc.on('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`tar exited code=${code} signal=${signal}: ${stderr.trim()}`));
    });
  });
}
