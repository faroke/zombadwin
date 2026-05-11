; zombadwin Windows installer.
; Compiled by installer/build.ps1 (which passes /DAppVersion= /DStagingDir= /DOutputDir=).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef StagingDir
  #error StagingDir not defined. Run build.ps1 to produce installer artifacts first.
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{8F2A5B4C-7E1D-4A9F-B6C3-D5E8F2A4B1C9}
AppName=zombadwin
AppVersion={#AppVersion}
AppPublisher=zombadwin contributors
AppPublisherURL=https://github.com/
AppSupportURL=https://github.com/
AppUpdatesURL=https://github.com/
DefaultDirName={autopf64}\zombadwin
DefaultGroupName=zombadwin
DisableProgramGroupPage=yes
LicenseFile=
PrivilegesRequired=admin
OutputDir={#OutputDir}
OutputBaseFilename=zombadwin-setup-v{#AppVersion}
Compression=lzma2/ultra
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
WizardStyle=modern
SetupIconFile={#StagingDir}\icon.ico
UninstallDisplayIcon={app}\icon.ico
UninstallDisplayName=zombadwin

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "auto_start"; Description: "Start zombadwin automatically when Windows boots (service set to Automatic, tray launched at user login)"; GroupDescription: "Startup"; Flags: unchecked

[Dirs]
; Writable data location for the service (runs as LocalSystem by default).
; Permissions on %ProgramData% are already inheritable; we just make sure the
; tree exists so the first start doesn't have to mkdir into a brand-new path.
Name: "{commonappdata}\zombadwin"; Permissions: users-modify
Name: "{commonappdata}\zombadwin\data"; Permissions: users-modify
Name: "{commonappdata}\zombadwin\backups"; Permissions: users-modify
Name: "{commonappdata}\zombadwin\logs"; Permissions: users-modify

[Files]
Source: "{#StagingDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: recursesubdirs ignoreversion
Source: "{#StagingDir}\nssm\*"; DestDir: "{app}\nssm"; Flags: recursesubdirs ignoreversion
Source: "{#StagingDir}\backend\*"; DestDir: "{app}\backend"; Flags: recursesubdirs ignoreversion
Source: "{#StagingDir}\frontend\*"; DestDir: "{app}\frontend"; Flags: recursesubdirs ignoreversion
Source: "{#StagingDir}\tray\*"; DestDir: "{app}\tray"; Flags: recursesubdirs ignoreversion
Source: "{#StagingDir}\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\zombadwin (tray)"; Filename: "{app}\runtime\node.exe"; Parameters: """{app}\tray\tray.mjs"""; WorkingDir: "{app}\tray"; IconFilename: "{app}\icon.ico"; Comment: "Launch the zombadwin tray icon"
Name: "{group}\Open zombadwin admin UI"; Filename: "http://localhost:28910"; IconFilename: "{app}\icon.ico"
Name: "{group}\Uninstall zombadwin"; Filename: "{uninstallexe}"

[Registry]
; Tray auto-start at user login, only when the "Auto-start" task is selected.
; The current user's HKCU is the one running the installer (Inno elevates the
; whole process, so this writes to the elevated user's profile — which is the
; same person in single-user installs).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "zombadwin-tray"; ValueData: """{app}\runtime\node.exe"" ""{app}\tray\tray.mjs"""; Flags: uninsdeletevalue; Tasks: auto_start

[Run]
; -- Register the backend as a Windows service via NSSM --------------------
Filename: "{app}\nssm\nssm.exe"; Parameters: "install zombadwin ""{app}\runtime\node.exe"" ""{app}\backend\dist\server.js"""; Flags: runhidden waituntilterminated; StatusMsg: "Installing the zombadwin Windows service…"
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin AppDirectory ""{app}\backend"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin DisplayName ""zombadwin (Project Zomboid admin)"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin Description ""Self-hosted admin UI for a Project Zomboid dedicated server."""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin AppStdout ""{commonappdata}\zombadwin\logs\stdout.log"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin AppStderr ""{commonappdata}\zombadwin\logs\stderr.log"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin AppRotateFiles 1"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin AppRotateBytes 10485760"; Flags: runhidden waituntilterminated
; Persisted state (config.json, downloaded SteamCMD, backups) lives outside
; Program Files so reinstalls don't wipe the user's bearer token.
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin AppEnvironmentExtra ""ZOMBADWIN_DATA_DIR={commonappdata}\zombadwin\data"" ""ZOMBADWIN_HOST=127.0.0.1"""; Flags: runhidden waituntilterminated

; Service start mode follows the Auto-start task.
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin Start SERVICE_AUTO_START"; Flags: runhidden waituntilterminated; Tasks: auto_start
Filename: "{app}\nssm\nssm.exe"; Parameters: "set zombadwin Start SERVICE_DEMAND_START"; Flags: runhidden waituntilterminated; Tasks: not auto_start

; Start the service now so the user can hit the UI right after the installer closes.
Filename: "{app}\nssm\nssm.exe"; Parameters: "start zombadwin"; Flags: runhidden waituntilterminated; StatusMsg: "Starting the zombadwin service…"

; Optional post-install actions shown as checkboxes on the "Finish" page.
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\tray\tray.mjs"""; WorkingDir: "{app}\tray"; Description: "Launch zombadwin tray now"; Flags: postinstall nowait skipifsilent unchecked
Filename: "http://localhost:28910"; Description: "Open the admin UI in my browser"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
; Order matters: stop + remove the service, then kill the user-side tray.
Filename: "{app}\nssm\nssm.exe"; Parameters: "stop zombadwin"; Flags: runhidden waituntilterminated; RunOnceId: "StopZombadwinService"
Filename: "{app}\nssm\nssm.exe"; Parameters: "remove zombadwin confirm"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveZombadwinService"
; Kill any tray.mjs process belonging to our install. Filtering on the command
; line ensures we don't touch unrelated Node processes the user is running.
Filename: "wmic.exe"; Parameters: "process where ""CommandLine like '%zombadwin%tray.mjs%'"" call terminate"; Flags: runhidden; RunOnceId: "KillZombadwinTray"

[Code]
procedure InitializeWizard;
begin
  // No custom pages for v1 — keep the installer minimal. If we want to ask
  // for the PZ user data directory here later, this is where the input page
  // is wired up via CreateInputDirPage.
end;
