import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseSandbox, sandboxPath, writeSandbox } from './sandboxLua.js';

export interface SandboxPreset {
  /** File stem, e.g. "Apocalypse" — the value to pass to applySandboxPreset. */
  name: string;
  /** Absolute path to the preset Lua file inside the PZ install. */
  sourcePath: string;
}

function presetDir(installDir: string): string {
  return join(installDir, 'media', 'lua', 'shared', 'Sandbox');
}

/**
 * Lists the sandbox presets shipped with the installed PZ dedicated server.
 * Skips SandboxVars.lua itself (that's the schema/defaults file, not a
 * difficulty preset).
 *
 * Returning the raw file stems (Apocalypse, Outbreak, Rising, …) keeps the UI
 * truthful to whatever the current build ships — when Indie Stone adds a new
 * preset in a future release, it shows up automatically.
 */
export function listSandboxPresets(installDir: string): SandboxPreset[] {
  const dir = presetDir(installDir);
  if (!existsSync(dir)) return [];
  const out: SandboxPreset[] = [];
  for (const entry of readdirSync(dir)) {
    if (extname(entry).toLowerCase() !== '.lua') continue;
    const stem = basename(entry, extname(entry));
    if (stem === 'SandboxVars') continue;
    out.push({ name: stem, sourcePath: join(dir, entry) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reads a preset's `return { ... }` Lua and writes it as the user's
 * `<userDir>/Server/<serverName>_SandboxVars.lua`. Going through parse +
 * serialize ensures the on-disk shape (`SandboxVars = { … }`) is what PZ
 * expects at boot, even though the bundled presets ship as `return { … }`.
 *
 * Without this the user had to start the server once just to materialise the
 * file, then stop it, edit, and restart — the kind of chicken-and-egg the
 * platform is supposed to hide.
 */
export function applySandboxPreset(opts: {
  installDir: string;
  userDir: string;
  serverName: string;
  presetName: string;
  overwrite?: boolean;
}): { path: string; presetSource: string } {
  const presets = listSandboxPresets(opts.installDir);
  const preset = presets.find((p) => p.name.toLowerCase() === opts.presetName.toLowerCase());
  if (!preset) {
    const known = presets.map((p) => p.name).join(', ') || '(none — install dir has no presets)';
    throw new Error(`unknown preset '${opts.presetName}'. Known: ${known}`);
  }
  const target = sandboxPath(opts.userDir, opts.serverName);
  if (existsSync(target) && !opts.overwrite) {
    throw new Error(`refusing to overwrite existing ${target} — pass overwrite=true`);
  }
  const raw = readFileSync(preset.sourcePath, 'utf8');
  const record = parseSandbox(raw);
  mkdirSync(join(opts.userDir, 'Server'), { recursive: true });
  // writeSandbox wraps the record back into `SandboxVars = { … }`, which is
  // the shape PZ loads from <userDir>/Server/<serverName>_SandboxVars.lua.
  // The preset files ship as `return { … }` — same data, different wrapper.
  writeSandbox(target, record);
  return { path: target, presetSource: preset.sourcePath };
}
