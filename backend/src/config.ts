import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AppConfig {
  /** HTTP/WS listen port */
  port: number;
  /** Interface to bind on. 127.0.0.1 = local only, 0.0.0.0 = LAN-accessible */
  host: string;
  /** Bearer token required on every /api/* request */
  authToken: string;
  /** Where on disk we keep state: token, install location, etc. */
  dataDir: string;
  /** Path to the Project Zomboid dedicated server install (may not exist yet) */
  pzInstallDir: string | null;
  /** Path to the user's Zomboid data directory (Server/, Saves/, Logs/, mods/) */
  pzUserDir: string | null;
}

interface PersistedConfig {
  authToken: string;
  pzInstallDir: string | null;
  pzUserDir: string | null;
}

const DEFAULT_PORT = 28910;
const DEFAULT_HOST = '127.0.0.1';

function defaultDataDir(): string {
  const envOverride = process.env.ZOMBADWIN_DATA_DIR;
  if (envOverride) return resolve(envOverride);
  return resolve(__dirname, '..', 'data');
}

function loadPersisted(dataDir: string): PersistedConfig {
  const file = join(dataDir, 'config.json');
  if (!existsSync(file)) {
    const fresh: PersistedConfig = {
      authToken: randomBytes(24).toString('hex'),
      pzInstallDir: null,
      pzUserDir: null,
    };
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify(fresh, null, 2), 'utf8');
    return fresh;
  }
  return JSON.parse(readFileSync(file, 'utf8')) as PersistedConfig;
}

export function persistConfig(cfg: AppConfig): void {
  const file = join(cfg.dataDir, 'config.json');
  const persisted: PersistedConfig = {
    authToken: cfg.authToken,
    pzInstallDir: cfg.pzInstallDir,
    pzUserDir: cfg.pzUserDir,
  };
  writeFileSync(file, JSON.stringify(persisted, null, 2), 'utf8');
}

export function loadConfig(): AppConfig {
  const dataDir = defaultDataDir();
  const persisted = loadPersisted(dataDir);
  return {
    port: Number(process.env.ZOMBADWIN_PORT ?? DEFAULT_PORT),
    host: process.env.ZOMBADWIN_HOST ?? DEFAULT_HOST,
    authToken: persisted.authToken,
    dataDir,
    pzInstallDir: persisted.pzInstallDir,
    pzUserDir: persisted.pzUserDir,
  };
}
