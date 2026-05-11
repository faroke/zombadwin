import { loadConfig, persistConfig, type AppConfig, type AutoBackupConfig } from '../config.js';
import { getPzProcess, type ServerState } from './pzProcess.js';
import { getActiveServerName } from './profiles.js';
import { createBackup, deleteBackup, listBackups } from './saves.js';

const MIN_INTERVAL_MS = 60_000;

export interface AutoBackupStatus {
  armed: boolean;
  lastRanAt: number | null;
  lastError: string | null;
  nextScheduledAt: number | null;
  config: AutoBackupConfig;
}

class AutoBackupService {
  private timer: NodeJS.Timeout | null = null;
  private lastRanAt: number | null = null;
  private lastError: string | null = null;
  private nextScheduledAt: number | null = null;

  init(): void {
    getPzProcess().on('status', (s) => this.reconcile(s.state));
    this.reconcile();
  }

  getStatus(): AutoBackupStatus {
    return {
      armed: this.timer !== null,
      lastRanAt: this.lastRanAt,
      lastError: this.lastError,
      nextScheduledAt: this.nextScheduledAt,
      config: loadConfig().autoBackup,
    };
  }

  /** Re-evaluate whether the timer should be running. Idempotent. */
  reconcile(forceState?: ServerState): void {
    const cfg = loadConfig().autoBackup;
    const state = forceState ?? getPzProcess().getStatus().state;
    const shouldRun = cfg.enabled && state === 'running';
    if (!shouldRun) {
      this.stopTimer();
      return;
    }
    if (this.timer === null) {
      this.schedule(cfg.intervalMinutes);
    }
  }

  /**
   * Called after the config was updated. Cancels the current timer (if any)
   * and re-evaluates from scratch so a shorter interval takes effect right
   * away instead of waiting for the next tick.
   */
  apply(): void {
    this.stopTimer();
    this.reconcile();
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextScheduledAt = null;
  }

  private schedule(intervalMinutes: number): void {
    const ms = Math.max(MIN_INTERVAL_MS, intervalMinutes * 60_000);
    this.nextScheduledAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      void this.tick();
    }, ms);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    this.nextScheduledAt = null;
    const profile = getActiveServerName();
    try {
      await createBackup(profile, 'auto');
      this.lastRanAt = Date.now();
      this.lastError = null;
      this.rotate(profile);
    } catch (err) {
      this.lastError = (err as Error).message;
    } finally {
      // Re-evaluate — the server may have stopped during the tick, or the
      // user may have flipped enabled off.
      this.reconcile();
    }
  }

  private rotate(profile: string): void {
    const cfg = loadConfig().autoBackup;
    if (cfg.keepLast <= 0) return;
    const autos = listBackups(profile).filter((b) => b.isAuto);
    // listBackups returns newest first; everything after keepLast is stale.
    for (let i = cfg.keepLast; i < autos.length; i++) {
      const auto = autos[i];
      if (!auto) continue;
      try {
        deleteBackup(profile, auto.filename);
      } catch {
        /* ignore */
      }
    }
  }
}

let instance: AutoBackupService | null = null;

export function initAutoBackup(): AutoBackupService {
  if (instance) return instance;
  instance = new AutoBackupService();
  instance.init();
  return instance;
}

export function getAutoBackup(): AutoBackupService {
  if (!instance) throw new Error('AutoBackupService not initialized');
  return instance;
}

/** Update + persist the autoBackup config and re-arm the timer. */
export function updateAutoBackupConfig(next: AutoBackupConfig): AutoBackupStatus {
  const cfg: AppConfig = loadConfig();
  cfg.autoBackup = next;
  persistConfig(cfg);
  getAutoBackup().apply();
  return getAutoBackup().getStatus();
}
