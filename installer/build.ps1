<#
.SYNOPSIS
  Builds the zombadwin Windows installer (.exe).

.DESCRIPTION
  Stages everything Inno Setup needs under installer\staging:
    - Node.js Windows x64 runtime (downloaded once, cached under installer\cache)
    - NSSM (Non-Sucking Service Manager) for the Windows service wrapper
    - backend dist + production node_modules
    - frontend dist
    - tray helper + its node_modules
    - icon
  Then runs the Inno Setup compiler (iscc.exe) to produce
  dist\installer\zombadwin-setup-vX.Y.Z.exe.

.PARAMETER SkipBuild
  Skip `npm install` and `npm run build` at the repo root. Useful when you
  just want to re-run the packaging step.

.PARAMETER NodeVersion
  Override the Node.js LTS version to bundle. Default: 20.19.0.

.PARAMETER NssmVersion
  Override the NSSM version. Default: 2.24-101-g897c7ad.

.NOTES
  Prerequisites on the build machine:
    - PowerShell 5.1+ (Windows-shipped)
    - Node.js 20+ in PATH (for the local repo build)
    - Inno Setup 6 installed, with iscc.exe in PATH or under the default
      C:\Program Files (x86)\Inno Setup 6\ location
#>

[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [string]$NodeVersion = '20.19.0',
  [string]$NssmVersion = '2.24-101-g897c7ad'
)

$ErrorActionPreference = 'Stop'

function Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Resolve-Iscc {
  $cmd = Get-Command iscc.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\iscc.exe",
    "${env:ProgramFiles}\Inno Setup 6\iscc.exe"
  )) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw "Inno Setup 6 not found. Install from https://jrsoftware.org/isinfo.php and either add iscc.exe to PATH or accept the default location."
}

function Ensure-Cached([string]$url, [string]$destZip, [string]$extractTo) {
  if (Test-Path $extractTo) {
    Write-Host "    (cached) $extractTo"
    return
  }
  if (-not (Test-Path $destZip)) {
    Write-Host "    downloading $url"
    # nssm.cc and nodejs.org both flake with intermittent 5xx — we hit a
    # 503 from nssm.cc that wrecked a release build. Three retries with
    # exponential backoff (10s, 20s, 40s = 70s worst case) absorb the
    # typical brief CDN hiccup without burning the 25-min job budget.
    $attempt = 0
    $maxAttempts = 4
    while ($true) {
      $attempt++
      try {
        Invoke-WebRequest -Uri $url -OutFile $destZip -UseBasicParsing -TimeoutSec 60
        break
      } catch {
        if ($attempt -ge $maxAttempts) {
          throw "failed to download $url after $maxAttempts attempts: $($_.Exception.Message)"
        }
        $wait = [int]([Math]::Pow(2, $attempt) * 5)
        Write-Host "    attempt $attempt failed ($($_.Exception.Message)); retrying in $wait s"
        # Drop the partial file so the next attempt doesn't try to resume
        # what may be a half-written / 0-byte stub.
        if (Test-Path $destZip) { Remove-Item -Force $destZip }
        Start-Sleep -Seconds $wait
      }
    }
  }
  New-Item -ItemType Directory -Force -Path $extractTo | Out-Null
  Expand-Archive -Path $destZip -DestinationPath $extractTo -Force
}

function Copy-Dir([string]$src, [string]$dst, [string[]]$exclude = @()) {
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  $robocopyArgs = @($src, $dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP')
  foreach ($x in $exclude) { $robocopyArgs += @('/XD', $x, '/XF', $x) }
  # robocopy returns 0-7 on success
  & robocopy @robocopyArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying $src -> $dst (exit $LASTEXITCODE)" }
  $global:LASTEXITCODE = 0
}

# -- Locate the repo root (parent of this script) ----------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = Split-Path -Parent $ScriptDir
$Staging = Join-Path $ScriptDir 'staging'
$Cache = Join-Path $ScriptDir 'cache'
$OutDir = Join-Path $RepoRoot 'dist\installer'

# Read version from root package.json
$pkg = Get-Content (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json
$Version = $pkg.version
Write-Host "zombadwin installer build — v$Version" -ForegroundColor Green
Write-Host "    repo root : $RepoRoot"
Write-Host "    staging   : $Staging"
Write-Host "    cache     : $Cache"
Write-Host "    output    : $OutDir"

# -- Pre-flight --------------------------------------------------------------
$iscc = Resolve-Iscc
Write-Host "    iscc.exe  : $iscc"

# -- 1. Build the app --------------------------------------------------------
if (-not $SkipBuild) {
  Step 'Building backend and frontend'
  Push-Location $RepoRoot
  try {
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
  } finally {
    Pop-Location
  }
} else {
  Step 'Skipping repo build (--SkipBuild)'
}

# -- 2. Prepare cache + staging dirs -----------------------------------------
Step 'Preparing staging directory'
if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
New-Item -ItemType Directory -Force -Path $Staging | Out-Null
New-Item -ItemType Directory -Force -Path $Cache | Out-Null

# -- 3. Bundle Node runtime --------------------------------------------------
Step "Bundling Node.js v$NodeVersion runtime"
$nodeZip = Join-Path $Cache "node-v$NodeVersion-win-x64.zip"
$nodeExtract = Join-Path $Cache "node-v$NodeVersion-win-x64"
Ensure-Cached `
  "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" `
  $nodeZip `
  $nodeExtract
$nodeInner = Join-Path $nodeExtract "node-v$NodeVersion-win-x64"
$nodeStaging = Join-Path $Staging 'runtime'
Copy-Dir $nodeInner $nodeStaging

# -- 4. Bundle NSSM ----------------------------------------------------------
Step "Bundling NSSM $NssmVersion"
$nssmZip = Join-Path $Cache "nssm-$NssmVersion.zip"
$nssmExtract = Join-Path $Cache "nssm-$NssmVersion"
Ensure-Cached `
  "https://nssm.cc/ci/nssm-$NssmVersion.zip" `
  $nssmZip `
  $nssmExtract
# NSSM zip layout: nssm-<version>\win64\nssm.exe + win32\nssm.exe
$nssmInner = Join-Path $nssmExtract "nssm-$NssmVersion\win64"
if (-not (Test-Path $nssmInner)) {
  # Sometimes the zip is flattened by one level — handle both.
  $nssmInner = Join-Path $nssmExtract 'win64'
}
$nssmStaging = Join-Path $Staging 'nssm'
New-Item -ItemType Directory -Force -Path $nssmStaging | Out-Null
Copy-Item (Join-Path $nssmInner 'nssm.exe') $nssmStaging

# -- 5. Backend --------------------------------------------------------------
Step 'Staging backend (dist + production node_modules)'
$backendSrc = Join-Path $RepoRoot 'backend'
$backendStaging = Join-Path $Staging 'backend'
New-Item -ItemType Directory -Force -Path $backendStaging | Out-Null
Copy-Dir (Join-Path $backendSrc 'dist') (Join-Path $backendStaging 'dist')
Copy-Item (Join-Path $backendSrc 'package.json') $backendStaging
# Install production dependencies into the staged backend
Push-Location $backendStaging
try {
  & "$nodeStaging\npm.cmd" install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    # Fall back to whichever npm is in PATH if the bundled one mis-resolves
    & npm install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "backend prod install failed" }
  }
} finally {
  Pop-Location
}

# -- 6. Frontend -------------------------------------------------------------
Step 'Staging frontend dist'
Copy-Dir (Join-Path $RepoRoot 'frontend\dist') (Join-Path $Staging 'frontend\dist')

# -- 7. Tray helper ----------------------------------------------------------
Step 'Staging tray helper'
$trayStaging = Join-Path $Staging 'tray'
New-Item -ItemType Directory -Force -Path $trayStaging | Out-Null
Copy-Item (Join-Path $ScriptDir 'tray\tray.mjs') $trayStaging
Copy-Item (Join-Path $ScriptDir 'tray\package.json') $trayStaging
Push-Location $trayStaging
try {
  & npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "tray install failed" }
} finally {
  Pop-Location
}

# -- 8. Icon -----------------------------------------------------------------
Step 'Staging icon'
$iconSrc = Join-Path $ScriptDir 'assets\icon.ico'
if (-not (Test-Path $iconSrc)) {
  Write-Host "    no icon at $iconSrc — generating a 16x16 placeholder"
  & "$nodeStaging\node.exe" (Join-Path $ScriptDir 'assets\generate-placeholder-icon.mjs') $iconSrc
  if ($LASTEXITCODE -ne 0) { throw "icon generator failed" }
}
Copy-Item $iconSrc (Join-Path $Staging 'icon.ico')
Copy-Item $iconSrc (Join-Path $trayStaging 'icon.ico')

# -- 9. Run Inno Setup -------------------------------------------------------
Step "Running Inno Setup compiler"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$iss = Join-Path $ScriptDir 'zombadwin.iss'
& $iscc "/DAppVersion=$Version" "/DStagingDir=$Staging" "/DOutputDir=$OutDir" $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed" }

Write-Host ""
Write-Host "==> Done." -ForegroundColor Green
Get-ChildItem $OutDir -Filter '*.exe' | ForEach-Object {
  Write-Host "    $($_.FullName)  ($([math]::Round($_.Length / 1MB, 1)) MB)"
}
