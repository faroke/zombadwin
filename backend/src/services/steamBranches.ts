import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';

const PZ_DEDICATED_APPID = '380870';
const CACHE_TTL_MS = 5 * 60 * 1000;
const STEAMCMD_TIMEOUT_MS = 90_000;

export interface SteamBranch {
  name: string;
  buildid: string | null;
  description: string | null;
  timeUpdated: number | null;
  timeBuildUpdated: number | null;
}

export interface SteamBranchesResult {
  branches: SteamBranch[];
  fetchedAt: number;
  cached: boolean;
}

interface CacheEntry {
  result: SteamBranchesResult;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

function steamcmdExecutable(): string {
  const cfg = loadConfig();
  const dir = join(cfg.dataDir, 'steamcmd');
  return platform() === 'win32' ? join(dir, 'steamcmd.exe') : join(dir, 'steamcmd.sh');
}

/**
 * Lists every Steam beta branch published for the PZ dedicated server app.
 *
 * Why this exists: Indie Stone renames PZ's beta branches over time (the old
 * `b42unstable` is gone now that B42 went stable; today the in-development
 * branch is simply `unstable`). A hardcoded preset in the UI rots silently and
 * users hit "ERROR! Failed to set beta". By asking Steam directly via
 * `app_info_print`, the UI always reflects what is actually accepted by
 * `app_update -beta <name>`.
 *
 * Results are cached for 5 minutes — running SteamCMD takes ~5-10s and the
 * branch list changes maybe once per release.
 */
export async function listSteamBranches(opts: { force?: boolean } = {}): Promise<SteamBranchesResult> {
  if (!opts.force && cache && cache.expiresAt > Date.now()) {
    return { ...cache.result, cached: true };
  }
  const branches = await runSteamcmdBranches();
  const result: SteamBranchesResult = {
    branches,
    fetchedAt: Date.now(),
    cached: false,
  };
  cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

async function runSteamcmdBranches(): Promise<SteamBranch[]> {
  const exe = steamcmdExecutable();
  if (!existsSync(exe)) {
    throw new Error(`SteamCMD is not present at ${exe} — finish the install wizard first.`);
  }
  const args = [
    '+login',
    'anonymous',
    '+app_info_update',
    '1',
    '+app_info_print',
    PZ_DEDICATED_APPID,
    '+quit',
  ];
  const stdout = await runChildCaptured(exe, args, STEAMCMD_TIMEOUT_MS);
  return parseBranches(stdout);
}

function runChildCaptured(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    const killer = setTimeout(() => {
      proc.kill('SIGKILL');
      rejectPromise(new Error(`SteamCMD timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (c: string) => { out += c; });
    proc.stderr.on('data', (c: string) => { err += c; });
    proc.on('error', (e) => {
      clearTimeout(killer);
      rejectPromise(e);
    });
    proc.on('exit', (code) => {
      clearTimeout(killer);
      if (code === 0) {
        resolvePromise(out);
      } else {
        rejectPromise(new Error(`SteamCMD exited with code ${code}: ${err.slice(0, 500)}`));
      }
    });
  });
}

/**
 * Pulls the "branches" VDF block out of `app_info_print` output and turns each
 * child into a SteamBranch. The output is Valve VDF — quoted-key/value pairs
 * nested in braces; we slice the "branches" block by counting braces, then run
 * a simple per-branch regex pass.
 */
export function parseBranches(stdout: string): SteamBranch[] {
  const block = extractBranchesBlock(stdout);
  if (!block) return [];

  const out: SteamBranch[] = [];
  // Each branch is: "<name>" { <fields> }
  // We can't use a single greedy regex because branch bodies may contain quoted
  // strings with braces; instead walk forward, matching `"name"` then slicing
  // the balanced { ... }.
  const nameRe = /"([^"\\]+)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(block)) !== null) {
    const name = m[1];
    if (!name) continue;
    const bodyStart = m.index + m[0].length;
    const bodyEnd = findClosingBrace(block, bodyStart);
    if (bodyEnd < 0) break;
    const body = block.slice(bodyStart, bodyEnd);
    out.push({
      name,
      buildid: readField(body, 'buildid'),
      description: readField(body, 'description'),
      timeUpdated: readNumberField(body, 'timeupdated'),
      timeBuildUpdated: readNumberField(body, 'timebuildupdated'),
    });
    nameRe.lastIndex = bodyEnd + 1;
  }
  // Sort: public first, then unstable, then everything else alphabetically.
  out.sort((a, b) => branchSortKey(a) - branchSortKey(b) || a.name.localeCompare(b.name));
  return out;
}

function branchSortKey(b: SteamBranch): number {
  if (b.name === 'public') return 0;
  if (b.name === 'unstable') return 1;
  if (b.name.startsWith('outdated')) return 3;
  return 2;
}

function extractBranchesBlock(stdout: string): string | null {
  // Look for `"branches"` at the start of a (possibly indented) line, then take
  // the balanced { ... } that follows. We avoid `"depots"` and other VDF
  // siblings.
  const headerRe = /(^|\n)\s*"branches"\s*\{/;
  const match = headerRe.exec(stdout);
  if (!match) return null;
  const open = stdout.indexOf('{', match.index);
  if (open < 0) return null;
  const end = findClosingBrace(stdout, open + 1);
  if (end < 0) return null;
  return stdout.slice(open + 1, end);
}

function findClosingBrace(src: string, startIndex: number): number {
  let depth = 1;
  let i = startIndex;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      // Skip quoted strings — they may contain { or }.
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function readField(body: string, key: string): string | null {
  const re = new RegExp(`"${escapeRegex(key)}"\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i');
  const m = re.exec(body);
  if (!m || m[1] === undefined) return null;
  return m[1].replace(/\\"/g, '"').replace(/^\s+|\s+$/g, '');
}

function readNumberField(body: string, key: string): number | null {
  const v = readField(body, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function _resetCacheForTests(): void {
  cache = null;
}
