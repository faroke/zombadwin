import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';

const PZ_STEAM_APPID = '108600';

export interface WorkshopDownloadItem {
  workshopId: string;
  ok: boolean;
  /** Verbatim line from steamcmd: "Success. Downloaded item …" or "ERROR! …" */
  status: string;
}

export interface WorkshopDownloadResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  items: WorkshopDownloadItem[];
}

function steamcmdExecutable(): string {
  const cfg = loadConfig();
  const dir = join(cfg.dataDir, 'steamcmd');
  return platform() === 'win32' ? join(dir, 'steamcmd.exe') : join(dir, 'steamcmd.sh');
}

/**
 * Runs SteamCMD to download workshop items into the PZ install dir.
 *
 * Why this exists: PZ dedicated server's embedded Steamworks SDK can fail
 * to download workshop items at boot with errors like "Staging library
 * folder not found" / `onItemNotDownloaded result=9`, sometimes followed
 * by a CFileWriterThread crash. Standalone SteamCMD doesn't share that
 * failure mode — `+force_install_dir` initialises the library correctly,
 * and PZ at next start finds the content already in
 * <install>/steamapps/workshop/content/108600/<wid>/ and skips the runtime
 * download path that was crashing it.
 */
export async function downloadWorkshopItems(
  workshopIds: string[],
): Promise<WorkshopDownloadResult> {
  const cfg = loadConfig();
  if (!cfg.pzInstallDir) {
    throw new Error('PZ install directory is not configured — finish the SteamCMD install first.');
  }
  const steamcmd = steamcmdExecutable();
  if (!existsSync(steamcmd)) {
    throw new Error(
      'SteamCMD is not present at ' + steamcmd + ' — re-run the Install wizard.',
    );
  }
  if (workshopIds.length === 0) {
    return { exitCode: 0, stdout: '', stderr: '', items: [] };
  }

  // Argument order matters: +force_install_dir must come BEFORE +login,
  // otherwise SteamCMD ignores it. Same caveat as the initial app install.
  const args = ['+force_install_dir', cfg.pzInstallDir, '+login', 'anonymous'];
  for (const id of workshopIds) {
    args.push('+workshop_download_item', PZ_STEAM_APPID, id);
  }
  args.push('+quit');

  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(steamcmd, args, { windowsHide: true });
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', rejectPromise);
    proc.on('exit', (code) => {
      const items = parseDownloadResults(workshopIds, stdout);
      resolvePromise({ exitCode: code ?? -1, stdout, stderr, items });
    });
  });
}

/**
 * Walks SteamCMD output looking for the success/error markers it prints per
 * download. For each requested workshopId we end up with one entry; if the
 * line is missing entirely we report ok:false with a generic "not downloaded"
 * status so the UI doesn't silently lose track of an item.
 */
function parseDownloadResults(ids: string[], stdout: string): WorkshopDownloadItem[] {
  const lines = stdout.split(/\r?\n/);
  // Map workshopId -> matched line.
  const byId = new Map<string, string>();
  for (const raw of lines) {
    const successMatch = raw.match(/Success\.\s+Downloaded item\s+(\d+)/i);
    if (successMatch) {
      const id = successMatch[1];
      if (id) byId.set(id, raw);
      continue;
    }
    const errorMatch = raw.match(/ERROR!\s+Download item\s+(\d+)/i);
    if (errorMatch) {
      const id = errorMatch[1];
      if (id) byId.set(id, raw);
    }
  }
  return ids.map((id) => {
    const status = byId.get(id);
    if (!status) {
      return { workshopId: id, ok: false, status: 'not downloaded (no marker in steamcmd output)' };
    }
    return { workshopId: id, ok: !/ERROR/i.test(status), status: status.trim() };
  });
}
