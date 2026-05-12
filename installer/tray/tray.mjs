/**
 * zombadwin tray helper.
 *
 * Runs in user context after login (when the "Démarrer au boot" task is
 * selected at install time, this is added to HKCU\...\Run; otherwise it is
 * only launched manually via the Start Menu shortcut). Shows a system tray
 * icon with:
 *   - Open admin UI      → spawns the default browser at http://localhost:<port>/
 *   - Backend: Running / Stopped (read-only, refreshed every 5s)
 *   - Start backend (this session) → spawns node.exe + backend/dist/server.js
 *     in user context with the same env vars as the NSSM-registered service.
 *     Used when the Windows service didn't install or the user wants a
 *     transient one-shot. Backend dies when the tray exits.
 *   - Stop backend (this session)  → taskkill of the child we own. Does NOT
 *     touch a service-managed backend.
 *   - Quit tray                    → exits this process (does NOT touch the
 *     Windows service).
 *
 * The persistent Windows service registered by NSSM is still managed by
 * services.msc; tray-side controls deliberately avoid `sc start` / `net start`
 * so we don't require UAC on every click.
 */

import { exec, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import SysTray from 'systray';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.ZOMBADWIN_PORT ?? 28910);
const URL_ROOT = `http://localhost:${PORT}`;
const POLL_MS = 5000;

// Layout installed by Inno Setup:
//   {app}\runtime\node.exe
//   {app}\backend\dist\server.js
//   {app}\tray\tray.mjs   ← __dirname
// During `npm run dev` from a checkout there's no {app}\runtime, so we also
// allow the system `node` to be picked up via PATH as a fallback.
const NODE_EXE_BUNDLED = join(__dirname, '..', 'runtime', 'node.exe');
const SERVER_JS = join(__dirname, '..', 'backend', 'dist', 'server.js');
const DATA_DIR = join(process.env.ProgramData ?? 'C:\\ProgramData', 'zombadwin', 'data');

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
const MENU_START = 2;
const MENU_STOP = 3;
// MENU_*_SEP_1 = 4
const MENU_UPDATE = 5;
// MENU_*_SEP_2 = 6
const MENU_QUIT = 7;

const systray = new SysTray.default({
  menu: {
    icon: iconBase64,
    isTemplateIcon: false,
    title: 'zombadwin',
    tooltip: 'zombadwin — Project Zomboid admin',
    items: [
      { title: 'Open admin UI', tooltip: `Open ${URL_ROOT} in your default browser`, checked: false, enabled: true },
      { title: 'Backend: checking…', tooltip: 'Updated every 5s', checked: false, enabled: false },
      { title: 'Start backend (this session)', tooltip: 'Spawn the backend in user context — dies when this tray exits', checked: false, enabled: false },
      { title: 'Stop backend (this session)', tooltip: 'Kill the backend we started; service-managed backend is unaffected', checked: false, enabled: false },
      SysTray.default.separator,
      { title: 'Checking for updates…', tooltip: 'Polls GitHub releases hourly', checked: false, enabled: false },
      SysTray.default.separator,
      { title: 'Quit tray', tooltip: 'Stops this tray icon (service keeps running)', checked: false, enabled: true },
    ],
  },
  debug: false,
  copyDir: true,
});

/** @type {import('node:child_process').ChildProcess | null} */
let ownedBackend = null;
let lastReachable = null;

systray.onClick((action) => {
  if (action.seq_id === MENU_OPEN) {
    // `start ""` lets Windows pick the user's default browser. Quoting the
    // empty title is required by cmd to avoid treating the URL as the title.
    exec(`start "" "${URL_ROOT}"`);
  } else if (action.seq_id === MENU_START) {
    startBackend();
  } else if (action.seq_id === MENU_STOP) {
    stopBackend();
  } else if (action.seq_id === MENU_UPDATE && lastUpdateUrl) {
    exec(`start "" "${lastUpdateUrl}"`);
  } else if (action.seq_id === MENU_QUIT) {
    if (ownedBackend) stopBackend();
    systray.kill();
  }
});

/**
 * Spawn node.exe + backend/dist/server.js in user context. Replicates the
 * env vars NSSM sets when running the service, so the same ProgramData
 * config.json (and its bearer token) is reused — the admin UI doesn't have to
 * re-authenticate just because the backend was launched a different way.
 */
function startBackend() {
  if (ownedBackend) return;
  const nodeExe = existsSync(NODE_EXE_BUNDLED) ? NODE_EXE_BUNDLED : 'node.exe';
  if (!existsSync(SERVER_JS)) {
    updateStatus(`Backend: ✗ server.js missing at ${SERVER_JS}`, false);
    return;
  }
  try {
    ownedBackend = spawn(nodeExe, [SERVER_JS], {
      cwd: dirname(SERVER_JS),
      env: {
        ...process.env,
        ZOMBADWIN_DATA_DIR: DATA_DIR,
        ZOMBADWIN_HOST: '127.0.0.1',
      },
      // windowsHide hides the subprocess console window — without it node.exe
      // pops a visible console every time the user clicks Start, on top of
      // whatever console the tray itself owns.
      windowsHide: true,
      // stdio:'ignore' detaches stdio so the parent (tray) can exit without
      // EPIPE'ing a still-writing child. We deliberately don't `detached:true`
      // — that would leave a leaked node.exe behind when the tray quits, and
      // the user has no way to find it.
      stdio: 'ignore',
    });
  } catch (err) {
    ownedBackend = null;
    updateStatus(`Backend: ✗ spawn failed (${(err instanceof Error ? err.message : String(err)).slice(0, 60)})`, false);
    return;
  }
  ownedBackend.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code ?? '?'}`;
    ownedBackend = null;
    // Force-refresh the status item so the user sees the change immediately
    // rather than waiting up to POLL_MS for the next health check.
    void pollBackend(`exited (${reason})`);
  });
  // Don't wait for pollBackend — set Stop enabled immediately so the user can
  // cancel a slow boot.
  setMenuItem(MENU_STOP, { title: 'Stop backend (this session)', enabled: true });
  setMenuItem(MENU_START, { title: 'Start backend (booting…)', enabled: false });
}

function stopBackend() {
  if (!ownedBackend) return;
  const pid = ownedBackend.pid;
  if (typeof pid === 'number') {
    // taskkill /T kills child processes too — server.js doesn't spawn any
    // today, but defensive against a future change.
    exec(`taskkill /F /T /PID ${pid}`);
  }
}

let pollErrorContext = '';
let lastUpdateUrl = null;
let lastUpdateLatest = null;

/**
 * Asks the backend whether a newer release is published on GitHub. Pulls
 * through the backend (rather than calling api.github.com directly) so the
 * 1-hour result cache is shared with the admin UI and we don't double up on
 * the 60-req/hour anonymous rate limit when both the tray and the UI poll.
 *
 * Silent on failure — if the backend is down or GitHub is unreachable, the
 * menu item just stays "Checking for updates…" or whatever it last showed.
 * Update polling is not a critical path; we don't surface transient errors.
 */
async function pollUpdates() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${URL_ROOT}/api/updates/check`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = await res.json();
    if (data.newer && data.latest) {
      // Only repaint when the latest version changed — keeps the systray
      // helper from rewriting the menu on every poll for nothing.
      if (data.latest !== lastUpdateLatest) {
        lastUpdateLatest = data.latest;
        lastUpdateUrl = data.releaseUrl ?? null;
        setMenuItem(MENU_UPDATE, {
          title: `✦ Update available: v${data.latest}`,
          tooltip: data.releaseUrl
            ? `Click to open ${data.releaseUrl}`
            : 'Newer release published on GitHub',
          enabled: !!data.releaseUrl,
        });
      }
    } else if (data.current && lastUpdateLatest !== `current:${data.current}`) {
      lastUpdateLatest = `current:${data.current}`;
      lastUpdateUrl = null;
      setMenuItem(MENU_UPDATE, {
        title: `Up to date — v${data.current}`,
        tooltip: 'Checked against the latest GitHub release',
        enabled: false,
      });
    }
  } catch {
    /* network blip — leave the menu as it was */
  }
}

async function pollBackend(contextHint = '') {
  if (contextHint) pollErrorContext = contextHint;
  let reachable = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${URL_ROOT}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  if (reachable !== lastReachable || contextHint) {
    lastReachable = reachable;
    if (reachable) {
      updateStatus('Backend: ✓ running', true);
      setMenuItem(MENU_START, { title: 'Start backend (this session)', enabled: false });
      // Stop only stays clickable when WE own the child. A service-managed
      // backend is reachable but not ours to kill from the tray.
      setMenuItem(MENU_STOP, {
        title: 'Stop backend (this session)',
        enabled: !!ownedBackend,
      });
    } else {
      const suffix = pollErrorContext ? ` — ${pollErrorContext}` : ' (services.msc or Start)';
      updateStatus(`Backend: ✗ stopped${suffix}`, false);
      setMenuItem(MENU_START, { title: 'Start backend (this session)', enabled: true });
      setMenuItem(MENU_STOP, { title: 'Stop backend (this session)', enabled: false });
    }
    pollErrorContext = '';
  }
}

function updateStatus(title, up) {
  setMenuItem(MENU_STATUS, {
    title,
    tooltip: up
      ? `Reachable at ${URL_ROOT}`
      : 'Open services.msc and start "zombadwin" — or use the Start menu item below.',
    enabled: false,
  });
}

function setMenuItem(seq_id, item) {
  systray.sendAction({
    type: 'update-item',
    item: { ...item, checked: false },
    seq_id,
  });
}

void pollBackend();
setInterval(pollBackend, POLL_MS);
// Updates: poll on startup (delayed so the backend has time to come up if
// the tray launched alongside it), then every 15 min. Backend caches the
// GitHub result for 1h, so the actual outbound API call happens at most
// once per hour even if we poll more often.
setTimeout(() => void pollUpdates(), 8000);
setInterval(pollUpdates, 15 * 60 * 1000);

// Graceful shutdown if Windows sends a stop signal (e.g. user logout).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (ownedBackend) stopBackend();
    systray.kill();
  });
}
