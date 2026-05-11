import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';

// Project Zomboid's Steam appid. Workshop content for PZ lives at
// <install>/steamapps/workshop/content/108600/<workshopId>/.
const PZ_STEAM_APPID = '108600';

export interface WorkshopScanEntry {
  workshopId: string;
  /** True iff Steam has actually downloaded this workshop item to disk yet. */
  found: boolean;
  /** Folder names directly under <wid>/mods/. Each is a candidate Mod ID. */
  modFolders: string[];
  /** Map folders found under <wid>/mods/<modId>/media/maps/. */
  mapFolders: string[];
}

export interface WorkshopScanResult {
  installDir: string | null;
  workshopRoot: string | null;
  entries: WorkshopScanEntry[];
}

/**
 * Walks the on-disk Workshop content for the configured PZ install and
 * collects the mod folder names PZ would actually load. Useful for mods
 * whose Workshop description doesn't follow the "Mod ID: ..." convention
 * — once the server has run once and Steam has downloaded the content,
 * the real Mod ID is just the directory name.
 */
export function scanWorkshopItems(workshopIds: string[]): WorkshopScanResult {
  const cfg = loadConfig();
  const installDir = cfg.pzInstallDir;
  if (!installDir) {
    return { installDir: null, workshopRoot: null, entries: emptyEntries(workshopIds) };
  }
  const workshopRoot = join(installDir, 'steamapps', 'workshop', 'content', PZ_STEAM_APPID);
  if (!existsSync(workshopRoot)) {
    return { installDir, workshopRoot, entries: emptyEntries(workshopIds) };
  }
  const entries = workshopIds.map((id) => scanOne(workshopRoot, id));
  return { installDir, workshopRoot, entries };
}

function emptyEntries(ids: string[]): WorkshopScanEntry[] {
  return ids.map((id) => ({ workshopId: id, found: false, modFolders: [], mapFolders: [] }));
}

function scanOne(root: string, workshopId: string): WorkshopScanEntry {
  const modsDir = join(root, workshopId, 'mods');
  if (!existsSync(modsDir)) {
    return { workshopId, found: false, modFolders: [], mapFolders: [] };
  }
  const modFolders: string[] = [];
  const mapFolders: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(modsDir, { withFileTypes: true });
  } catch {
    return { workshopId, found: true, modFolders: [], mapFolders: [] };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    modFolders.push(entry.name);
    const mapsDir = join(modsDir, entry.name, 'media', 'maps');
    if (!existsSync(mapsDir)) continue;
    try {
      for (const m of readdirSync(mapsDir, { withFileTypes: true })) {
        if (m.isDirectory()) mapFolders.push(m.name);
      }
    } catch {
      /* unreadable subdir — ignore */
    }
  }
  return { workshopId, found: true, modFolders, mapFolders };
}
