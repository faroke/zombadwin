# zombadwin

Self-hosted, open-source GUI for setting up and administering a [Project Zomboid](https://projectzomboid.com/) dedicated server.

> Status: pre-1.0. All v1 features below are implemented end-to-end. Bug reports and PRs welcome.

## Features

- **Automated install** via SteamCMD (Windows + Linux): downloads SteamCMD, extracts it, runs `app_update 380870 validate`, persists the install path.
- **Server lifecycle**: start / stop / restart with graceful shutdown (`quit` then SIGTERM then SIGKILL), live stdout / stderr streaming over WebSocket, in-app console for sending admin commands directly to the server's stdin.
- **Visual `servertest.ini` editor** with a curated schema (Identity, Network, Players, PvP & Safety, Gameplay, World, Loot, Backups, Chat, RCON, Steam, Discord). Comments, blank lines and unknown keys are round-tripped untouched.
- **Visual `SandboxVars.lua` editor** with the canonical PZ enums (Sprinters / Fast shamblers / Shamblers, Insanely rare → Abundant, …) and nested `ZombieLore` / `ZombieConfig` tables.
- **Player administration**: live roster (`players` command parsed from stdout), kick, ban (optionally by IP), unban, set access level (admin / moderator / overseer / gm / observer / none), whitelist add / remove, server-wide broadcast, force-save.
- **Workshop mod manager**: paste a Workshop URL or numeric id, the backend hits the Steam API for title/size and best-effort detects `Mod ID:` / `Map Folder:` entries from the description. Reorder load order, manage the map list, save back to the INI in one click.

## Architecture

Project Zomboid does not expose a network-level RCON. Admin commands have to be written to the server process's `stdin`, so the backend must run on the same machine as the dedicated server — it owns the spawned process. "Remote" administration in zombadwin means: the backend runs on the PZ host and exposes its HTTP / WebSocket API over the network; the React frontend can be opened from any browser, including a different machine.

```
Machine running PZ (local, VPS or container)        Anywhere
┌──────────────────────────────────────────┐        ┌───────────────┐
│  zombadwin backend (Fastify + WS)        │        │  Browser      │
│  ├─ owns the ProjectZomboid64 process    │◄──HTTP─┤  React SPA    │
│  ├─ SteamCMD downloader / installer      │   WS   │  (served by   │
│  ├─ INI / SandboxVars parsers            │        │   backend or  │
│  └─ Steam Workshop metadata fetch        │        │   Vite dev)   │
└──────────────────────────────────────────┘        └───────────────┘
```

```
backend/    Node.js 20+, Fastify 5, TypeScript, zod
frontend/   React 18, Vite, Tailwind, shadcn/ui primitives, TanStack Query
```

## Requirements

- Node.js 20 or later (24 tested)
- Windows 10+ or Linux x86_64 (where Project Zomboid dedicated server runs). On Windows, `tar.exe` (shipped since 1803) is used to extract SteamCMD.
- About 3 GB of free disk space for the PZ dedicated server itself.

## Quick start (development)

```bash
git clone <your fork> zombadwin
cd zombadwin
npm install
npm run dev
```

This launches the Fastify backend on `http://localhost:28910` and the Vite dev server on `http://localhost:5173`. Open the Vite URL — the bearer token to sign in is printed in the backend's startup log (it's also persisted to `backend/data/config.json` if you lose track of it).

To test the lifecycle without a real PZ install, point the backend at the bundled fake server:

```powershell
# Windows PowerShell
$env:ZOMBADWIN_SERVER_CMD_OVERRIDE = 'node "C:\path\to\zombadwin\backend\test-fixtures\fake-pz.mjs"'
npm run dev
```

```bash
# bash
ZOMBADWIN_SERVER_CMD_OVERRIDE='node ./backend/test-fixtures/fake-pz.mjs' npm run dev
```

## Production build

```bash
npm run build       # builds backend (tsc) and frontend (vite)
npm start           # runs the backend; if frontend/dist exists, it's served on the same port
```

The built backend lives in `backend/dist/`. With `npm start` (or `node backend/dist/server.js`) the API and the React SPA share port 28910 — there is no need to run Vite in production, and nothing else needs to be open to the network.

## Configuration

The backend reads `backend/data/config.json` on every start. The file is created automatically with a random bearer token on first run. Important fields:

| Field           | Source       | Purpose                                                                  |
| --------------- | ------------ | ------------------------------------------------------------------------ |
| `authToken`     | auto-generated | Bearer token required on every `/api/*` request and on the `?token=` of WebSocket connections. |
| `pzInstallDir`  | install wizard | Where the PZ dedicated server is installed. Set by the SteamCMD wizard. |
| `pzUserDir`     | manual       | Override for the user data directory (defaults to `~/Zomboid`).         |

Environment variables (read at start):

| Variable                          | Default     | Purpose                                                  |
| --------------------------------- | ----------- | -------------------------------------------------------- |
| `ZOMBADWIN_PORT`                  | `28910`     | HTTP / WS listen port.                                   |
| `ZOMBADWIN_HOST`                  | `127.0.0.1` | Bind address. Set to `0.0.0.0` to expose on the LAN.     |
| `ZOMBADWIN_DATA_DIR`              | `backend/data` | Where `config.json` and the cached SteamCMD live.     |
| `ZOMBADWIN_FRONTEND_DIR`          | `frontend/dist` if present | Override for the static frontend bundle. |
| `ZOMBADWIN_SERVER_CMD_OVERRIDE`   | (unset)     | Replace the spawned PZ command (useful for testing).     |
| `ZOMBADWIN_SERVER_CWD_OVERRIDE`   | (unset)     | Working directory when the override is used.             |

## Deploying on a Linux VPS

1. SSH onto the VPS as the user that should own the PZ server files.
2. Install Node 20+ and git.
3. `git clone … && cd zombadwin && npm install && npm run build`
4. Bind on the loopback by default (`ZOMBADWIN_HOST=127.0.0.1`) and put a reverse proxy in front for TLS. Example nginx:

   ```nginx
   server {
       listen 443 ssl http2;
       server_name zomboid.example.com;
       ssl_certificate     /etc/letsencrypt/live/zomboid.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/zomboid.example.com/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:28910;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_read_timeout 86400;
       }
   }
   ```

5. systemd unit `/etc/systemd/system/zombadwin.service`:

   ```ini
   [Unit]
   Description=zombadwin
   After=network.target

   [Service]
   Type=simple
   User=zomboid
   WorkingDirectory=/home/zomboid/zombadwin
   Environment=ZOMBADWIN_HOST=127.0.0.1
   ExecStart=/usr/bin/node backend/dist/server.js
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now zombadwin
   ```

6. Open the GUI, paste the bearer token (`sudo cat /home/zomboid/zombadwin/backend/data/config.json`), then run the SteamCMD install wizard.

## Security notes

- The bearer token is the only thing protecting `/api/*` and `/ws/*`. **Treat it like a password.** Anyone holding it can spawn or kill the PZ process, run any admin command, and edit the server config.
- Inputs that end up on the server's stdin (player names, ban reasons, broadcast messages) are validated to forbid newlines so the token holder can't inject extra commands. Quotes are backslash-escaped.
- `ZOMBADWIN_HOST=127.0.0.1` (the default) makes the backend listen on loopback only. Always pair a public exposure with a TLS reverse proxy.
- The frontend stores the token in `localStorage`. That's fine for a self-hosted personal tool; if you plan to expose it on a shared machine, consider clearing it on logout (we already do) and avoiding browsers used by other people.

## Contributing

PRs welcome. The codebase is intentionally small and easy to navigate:

```
backend/src/
  routes/         REST handlers
  services/       business logic (pzProcess, steamcmd, iniFile, sandboxLua, workshop)
  ws/             WebSocket handlers
  server.ts       Fastify bootstrap

frontend/src/
  components/     reusable UI (Layout, IniEditor, SandboxEditor, ServerControls, StatusBadge)
  pages/          routes
  lib/            api client, ws client, auth, helpers
```

Useful scripts:

```bash
npm run dev         # both workspaces, hot reload
npm run typecheck   # both workspaces
npm run build       # both workspaces, production
npm start           # production backend (serves built frontend at the same port)
```

## License

MIT — see [LICENSE](./LICENSE).
