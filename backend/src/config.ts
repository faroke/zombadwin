import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AutoBackupConfig {
  enabled: boolean;
  /** Minutes between automatic backups (only while the server is running) */
  intervalMinutes: number;
  /** Maximum number of auto-backups to retain per save (0 = unlimited) */
  keepLast: number;
}

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
  /** Name of the currently selected server profile */
  activeServer: string;
  /** Profile names the UI should expose even if no .ini exists yet */
  knownServers: string[];
  /** Auto-backup configuration applied to the active server */
  autoBackup: AutoBackupConfig;
}

interface PersistedConfig {
  authToken: string;
  pzInstallDir: string | null;
  pzUserDir: string | null;
  activeServer: string;
  knownServers: string[];
  autoBackup: AutoBackupConfig;
}

interface PersistedConfigRaw {
  authToken: string;
  pzInstallDir: string | null;
  pzUserDir: string | null;
  activeServer?: string;
  knownServers?: string[];
  autoBackup?: Partial<AutoBackupConfig>;
}

const DEFAULT_PORT = 28910;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_SERVER = 'servertest';
const DEFAULT_AUTO_BACKUP: AutoBackupConfig = {
  enabled: false,
  intervalMinutes: 60,
  keepLast: 12,
};

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
      activeServer: DEFAULT_SERVER,
      knownServers: [DEFAULT_SERVER],
      autoBackup: DEFAULT_AUTO_BACKUP,
    };
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify(fresh, null, 2), 'utf8');
    return fresh;
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as PersistedConfigRaw;
  const migrated: PersistedConfig = {
    authToken: raw.authToken,
    pzInstallDir: raw.pzInstallDir,
    pzUserDir: raw.pzUserDir,
    activeServer: raw.activeServer ?? DEFAULT_SERVER,
    knownServers:
      raw.knownServers && raw.knownServers.length > 0
        ? raw.knownServers
        : [raw.activeServer ?? DEFAULT_SERVER],
    autoBackup: { ...DEFAULT_AUTO_BACKUP, ...(raw.autoBackup ?? {}) },
  };
  // Persist the upgraded shape so subsequent loads don't re-migrate.
  if (
    raw.activeServer === undefined ||
    raw.knownServers === undefined ||
    raw.autoBackup === undefined
  ) {
    writeFileSync(file, JSON.stringify(migrated, null, 2), 'utf8');
  }
  return migrated;
}

export function persistConfig(cfg: AppConfig): void {
  const file = join(cfg.dataDir, 'config.json');
  const persisted: PersistedConfig = {
    authToken: cfg.authToken,
    pzInstallDir: cfg.pzInstallDir,
    pzUserDir: cfg.pzUserDir,
    activeServer: cfg.activeServer,
    knownServers: cfg.knownServers,
    autoBackup: cfg.autoBackup,
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
    activeServer: persisted.activeServer,
    knownServers: persisted.knownServers,
    autoBackup: persisted.autoBackup,
  };
}
