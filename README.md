# zombadwin

Self-hosted, open-source GUI for setting up and administering a [Project Zomboid](https://projectzomboid.com/) dedicated server.

> Status: early development (pre-alpha). Scaffolding in progress.

## Features (v1 goals)

- Automated dedicated server installation via SteamCMD
- Start / stop / restart server with live log streaming
- Visual editor for `servertest.ini` and `SandboxVars.lua`
- Player administration (kick, ban, set admin, whitelist) via in-game commands
- Workshop mod management with auto-resolution of `WorkshopItems` / `Mods` / `Map` entries

## Architecture

The backend must run on the same host as the Project Zomboid dedicated server — Project Zomboid has no native RCON, so admin commands are sent through the server process's `stdin`. The frontend is a React SPA that talks to the backend over HTTP and WebSocket, and can be opened from any browser on the network (or just locally).

```
backend/   Node.js + Fastify + TypeScript — owns the PZ process
frontend/  React + Vite + Tailwind + shadcn/ui — admin UI
```

## Requirements

- Node.js 20+
- Windows or Linux (Project Zomboid dedicated server supports both)
- SteamCMD will be downloaded automatically on first install

## Quick start (dev)

```bash
npm install
npm run dev
```

Backend listens on `http://localhost:28910`, frontend dev server on `http://localhost:5173`.

## License

MIT — see [LICENSE](./LICENSE).
