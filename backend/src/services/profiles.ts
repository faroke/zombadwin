import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, persistConfig, type AppConfig } from '../config.js';
import { defaultUserDir } from './paths.js';

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export interface ProfileSummary {
  name: string;
  hasIni: boolean;
  hasSandbox: boolean;
  hasSave: boolean;
  iniBytes: number | null;
  iniModifiedAt: number | null;
}

export class ProfileError extends Error {
  constructor(public readonly code: ProfileErrorCode, message: string) {
    super(message);
  }
}
export type ProfileErrorCode =
  | 'invalid_name'
  | 'name_in_use'
  | 'not_found'
  | 'running'
  | 'still_active';

function getUserDir(cfg: AppConfig): string {
  return cfg.pzUserDir ?? defaultUserDir();
}

function serverDir(cfg: AppConfig): string {
  return join(getUserDir(cfg), 'Server');
}

function savesDir(cfg: AppConfig): string {
  return join(getUserDir(cfg), 'Saves', 'Multiplayer');
}

function profileFilesIn(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === `${name}.ini`) out.push(join(dir, entry));
    else if (entry.startsWith(`${name}_`) && (entry.endsWith('.ini') || entry.endsWith('.lua'))) {
      out.push(join(dir, entry));
    }
  }
  return out;
}

function profileSaveDir(cfg: AppConfig, name: string): string {
  return join(savesDir(cfg), name);
}

export function getActiveServerName(): string {
  return loadConfig().activeServer;
}

export function listProfiles(): ProfileSummary[] {
  const cfg = loadConfig();
  const known = new Set<string>(cfg.knownServers);
  known.add(cfg.activeServer);

  // Discover any dedicated server profile we missed by scanning Server/*.ini.
  // (We do NOT scan Saves/Multiplayer because that folder also contains client-
  // side saves keyed by SteamID_host_hash from when the user played somewhere.)
  const sDir = serverDir(cfg);
  if (existsSync(sDir)) {
    for (const entry of readdirSync(sDir)) {
      if (entry.endsWith('.ini') && !entry.includes('_')) {
        known.add(entry.replace(/\.ini$/, ''));
      }
    }
  }

  return [...known].sort((a, b) => a.localeCompare(b)).map((name) => summarizeProfile(cfg, name));
}

export function summarizeProfile(cfg: AppConfig, name: string): ProfileSummary {
  const ini = join(serverDir(cfg), `${name}.ini`);
  const sandbox = join(serverDir(cfg), `${name}_SandboxVars.lua`);
  const save = profileSaveDir(cfg, name);
  let iniBytes: number | null = null;
  let iniModifiedAt: number | null = null;
  if (existsSync(ini)) {
    const s = statSync(ini);
    iniBytes = s.size;
    iniModifiedAt = s.mtimeMs;
  }
  return {
    name,
    hasIni: existsSync(ini),
    hasSandbox: existsSync(sandbox),
    hasSave: existsSync(save),
    iniBytes,
    iniModifiedAt,
  };
}

export function validateName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new ProfileError(
      'invalid_name',
      'Profile name must be 1-32 chars, letters/digits/_/-',
    );
  }
}

export function createProfile(name: string): ProfileSummary {
  validateName(name);
  const cfg = loadConfig();
  if (cfg.knownServers.includes(name)) {
    throw new ProfileError('name_in_use', `Profile "${name}" already exists`);
  }
  cfg.knownServers = [...cfg.knownServers, name];
  persistConfig(cfg);
  return summarizeProfile(cfg, name);
}

export function deleteProfile(
  name: string,
  isRunning: (name: string) => boolean,
): void {
  const cfg = loadConfig();
  if (!cfg.knownServers.includes(name) && !existsSync(join(serverDir(cfg), `${name}.ini`))) {
    throw new ProfileError('not_found', `Profile "${name}" not found`);
  }
  if (isRunning(name)) {
    throw new ProfileError('running', 'Stop the server before deleting its profile');
  }
  if (cfg.activeServer === name) {
    throw new ProfileError(
      'still_active',
      'Switch the active profile to something else before deleting this one',
    );
  }
  // Delete config files (INI, _SandboxVars.lua, _spawnregions.lua, …) but not
  // saves — those live in their own dir and can be removed from the Saves page.
  for (const file of profileFilesIn(serverDir(cfg), name)) {
    try {
      rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
  cfg.knownServers = cfg.knownServers.filter((n) => n !== name);
  persistConfig(cfg);
}

export function renameProfile(
  oldName: string,
  newName: string,
  isRunning: (name: string) => boolean,
): void {
  validateName(newName);
  const cfg = loadConfig();
  if (!cfg.knownServers.includes(oldName) && !existsSync(join(serverDir(cfg), `${oldName}.ini`))) {
    throw new ProfileError('not_found', `Profile "${oldName}" not found`);
  }
  if (cfg.knownServers.includes(newName)) {
    throw new ProfileError('name_in_use', `Profile "${newName}" already exists`);
  }
  if (isRunning(oldName)) {
    throw new ProfileError('running', 'Stop the server before renaming its profile');
  }

  // Move every <oldName>{.,_}*.{ini,lua} file in Server/
  const sDir = serverDir(cfg);
  if (existsSync(sDir)) {
    for (const entry of readdirSync(sDir)) {
      if (entry === `${oldName}.ini` || entry.startsWith(`${oldName}_`)) {
        const from = join(sDir, entry);
        const to = join(sDir, entry.replace(oldName, newName));
        try {
          renameSync(from, to);
        } catch {
          /* ignore */
        }
      }
    }
  }
  // Move the save directory if present.
  const fromSave = profileSaveDir(cfg, oldName);
  const toSave = profileSaveDir(cfg, newName);
  if (existsSync(fromSave) && !existsSync(toSave)) {
    try {
      renameSync(fromSave, toSave);
    } catch {
      /* ignore */
    }
  }

  cfg.knownServers = cfg.knownServers.map((n) => (n === oldName ? newName : n));
  if (cfg.activeServer === oldName) cfg.activeServer = newName;
  persistConfig(cfg);
}

export function setActiveProfile(name: string, isRunning: () => boolean): void {
  const cfg = loadConfig();
  if (cfg.activeServer === name) return;
  if (isRunning()) {
    throw new ProfileError('running', 'Stop the server before switching the active profile');
  }
  // Auto-promote unknown names to knownServers so the UI doesn't lose them.
  if (!cfg.knownServers.includes(name)) {
    validateName(name);
    cfg.knownServers = [...cfg.knownServers, name];
  }
  cfg.activeServer = name;
  persistConfig(cfg);
}

