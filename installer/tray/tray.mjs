/**
 * zombadwin tray helper.
 *
 * Runs in user context after login (when the "Démarrer au boot" task is
 * selected at install time, this is added to HKCU\...\Run; otherwise it is
 * only launched manually via the Start Menu shortcut). Shows a system tray
 * icon with:
 *   - Open admin UI  → spawns the default browser at http://localhost:<port>/
 *   - Backend status: Running / Stopped (read-only, refreshed every 5s)
 *   - Quit tray      → exits this process (does NOT touch the Windows service)
 *
 * The Windows service controlling the backend is managed by NSSM and
 * services.msc; the tray intentionally does not try to start/stop it so we
 * don't require UAC every time the user clicks the icon.
 */

import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import SysTray from 'systray';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.ZOMBADWIN_PORT ?? 28910);
const URL_ROOT = `http://localhost:${PORT}`;
const POLL_MS = 5000;

// The icon needs to be on disk for systray (which forwards a file path to its
// Go helper). The build script ensures icon.ico exists next to this file.
const iconPath = join(__dirname, 'icon.ico');
let iconBase64 = '';
try {
  iconBase64 = readFileSync(iconPath).toString('base64');
} catch {
  // Fallback: an empty string still produces a working systray on Windows
  // (default icon is used) but the user sees the generic Node icon.
}

const MENU_OPEN = 0;
const MENU_STATUS = 1;
const MENU_QUIT = 3;

const systray = new SysTray.default({
  menu: {
    icon: iconBase64,
    isTemplateIcon: false,
    title: 'zombadwin',
    tooltip: 'zombadwin — Project Zomboid admin',
    items: [
      { title: 'Open admin UI', tooltip: `Open ${URL_ROOT} in your default browser`, checked: false, enabled: true },
      { title: 'Backend: checking…', tooltip: 'Updated every 5s', checked: false, enabled: false },
      SysTray.default.separator,
      { title: 'Quit tray', tooltip: 'Stops this tray icon (service keeps running)', checked: false, enabled: true },
    ],
  },
  debug: false,
  copyDir: true,
});

systray.onClick((action) => {
  if (action.seq_id === MENU_OPEN) {
    // `start ""` lets Windows pick the user's default browser. Quoting the
    // empty title is required by cmd to avoid treating the URL as the title.
    exec(`start "" "${URL_ROOT}"`);
  } else if (action.seq_id === MENU_QUIT) {
    systray.kill();
  }
});

let lastStatus = null;

async function pollBackend() {
  let up = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${URL_ROOT}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    up = res.ok;
  } catch {
    up = false;
  }
  if (up !== lastStatus) {
    lastStatus = up;
    systray.sendAction({
      type: 'update-item',
      item: {
        title: up ? 'Backend: ✓ running' : 'Backend: ✗ stopped (services.msc)',
        tooltip: up
          ? `Reachable at ${URL_ROOT}`
          : 'Open services.msc and start "zombadwin" — or check Event Viewer for crash logs.',
        checked: false,
        enabled: false,
      },
      seq_id: MENU_STATUS,
    });
  }
}

void pollBackend();
setInterval(pollBackend, POLL_MS);

// Graceful shutdown if Windows sends a stop signal (e.g. user logout).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => systray.kill());
}
