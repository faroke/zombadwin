# Building the Windows installer

`installer\build.ps1` produces a single `zombadwin-setup-vX.Y.Z.exe` under `dist\installer\`. The installer registers a Windows service, drops a tray helper, and ships everything zombadwin needs (Node runtime + NSSM + backend dist + frontend dist).

## Prerequisites (build machine, Windows)

- Windows 10 / 11 x64
- Node.js 20+ in `PATH` (for the local `npm run build`)
- [Inno Setup 6](https://jrsoftware.org/isinfo.php) installed. `iscc.exe` needs to be either on `PATH` or at the default `C:\Program Files (x86)\Inno Setup 6\iscc.exe` location.
- PowerShell 5.1+ (Windows-shipped)

The first run downloads a Node Windows x64 runtime and the NSSM binary into `installer\cache\`. Subsequent builds reuse the cache.

## Build

From the repo root in an elevated **or** non-elevated PowerShell:

```powershell
.\installer\build.ps1
```

Useful switches:

- `-SkipBuild` — skip `npm install` / `npm run build` (useful when iterating only on installer assets).
- `-NodeVersion 22.5.0` — bundle a different Node version. Default is a recent LTS.
- `-NssmVersion 2.24-101-g897c7ad` — pin NSSM.

Output:

```
dist\installer\zombadwin-setup-v0.1.0.exe     # ~70 MB
```

## What ends up on the user's machine

Default install layout:

```
C:\Program Files\zombadwin\
  ├─ runtime\           Bundled Node.js
  ├─ nssm\nssm.exe      Service wrapper
  ├─ backend\           dist\ + production node_modules
  ├─ frontend\dist\     Built React SPA, served by the backend in prod mode
  ├─ tray\              tray.mjs + systray helper binary
  └─ icon.ico
```

Persistent state lives outside `Program Files` so reinstalls don't wipe it:

```
C:\ProgramData\zombadwin\
  ├─ data\config.json   Bearer token, install paths, profile metadata
  ├─ data\steamcmd\     Cached SteamCMD download
  ├─ backups\           Manual + auto save backups
  └─ logs\              Service stdout/stderr (rotated at 10 MB)
```

The service is registered as `zombadwin` and runs as `LocalSystem`. Start mode is **Manual** by default; check "Start zombadwin automatically when Windows boots" during install to switch it to **Automatic** (also adds the tray to the current user's startup).

## Customising the icon

Drop a `.ico` at `installer\assets\icon.ico` before running `build.ps1`. If it's missing the build script generates a 16×16 green placeholder via `installer\assets\generate-placeholder-icon.mjs` — fine for testing, replace before shipping.

## Running the installer

The output `.exe` is a standard Inno Setup installer:

- Double-click → UAC prompts (admin needed to register the service)
- Wizard with one Tasks page (Auto-start checkbox) and a Finish page (optional "launch tray now" / "open admin UI" checkboxes)
- Uninstall via "Add or Remove Programs" or the Start Menu shortcut

## Notes for the service running as LocalSystem

`%USERPROFILE%` for `LocalSystem` is `C:\Windows\System32\config\systemprofile`. That's a perfectly valid path but not where the user expects their Zomboid files to live. After install:

1. Open the admin UI (`http://localhost:28910`).
2. Edit `C:\ProgramData\zombadwin\data\config.json` and set `pzUserDir` to your actual user's path (e.g. `C:/Users/<you>/Zomboid`).
3. Restart the service from `services.msc` (or via the tray once we add a Restart action).

A future installer iteration could prompt for this path during install and prepopulate `config.json` — left as a TODO.

## Releasing through GitHub Actions

`.github/workflows/release-installer.yml` runs `installer\build.ps1` on a `windows-latest` runner. Two triggers:

- **Push a tag** `v*` → builds the installer **and** attaches the `.exe` to a freshly-generated GitHub release for that tag (notes are auto-generated from commits since the previous tag).
- **`workflow_dispatch`** in the Actions tab → builds the installer and uploads it as a workflow artifact, no release created. Useful for testing the build pipeline.

The bundled Node + NSSM downloads land in `installer/cache/` on the runner and are cached across runs (keyed by a hash of `build.ps1`) so subsequent builds skip the 30+ MB of pulls.

To cut a release:

```bash
# Update version in package.json (and let it flow into both workspaces if you do
# that manually) -- the installer .exe filename comes from package.json's version.
git tag v0.1.0
git push origin v0.1.0
```

The workflow needs `contents: write` (already set in the YAML) for the release step. No personal token needed — the default `GITHUB_TOKEN` is enough.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `iscc.exe` not found during build | Inno Setup 6 not installed, or installed to a non-default location not on PATH. |
| Service won't start after install | Check `C:\ProgramData\zombadwin\logs\stderr.log` for the Fastify boot error. Most common: port 28910 already taken. |
| Tray icon is missing | Make sure `installer\assets\icon.ico` was present at build time, or replace `tray\icon.ico` post-install and relaunch the tray. |
| Browser shows "site can't be reached" | The service is not running — open `services.msc` and start `zombadwin (Project Zomboid admin)`. |
