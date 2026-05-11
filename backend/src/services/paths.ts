import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export interface PzPaths {
  /** Directory where the PZ dedicated server is installed (contains StartServer64.bat or start-server.sh) */
  installDir: string | null;
  /** User data directory (~/Zomboid). Contains Server/, Saves/, Logs/, mods/ */
  userDir: string;
  /** Path to the start script for this platform */
  startScript: string | null;
}

export function defaultUserDir(): string {
  // PZ writes to %USERPROFILE%\Zomboid on Windows, ~/Zomboid on Linux/macOS.
  return join(homedir(), 'Zomboid');
}

export function startScriptName(): string {
  return platform() === 'win32' ? 'StartServer64.bat' : 'start-server.sh';
}

export function resolveInstallDir(installDir: string | null): PzPaths {
  const userDir = defaultUserDir();
  if (!installDir) return { installDir: null, userDir, startScript: null };

  const startScript = join(installDir, startScriptName());
  return {
    installDir,
    userDir,
    startScript: existsSync(startScript) ? startScript : null,
  };
}
