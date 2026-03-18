; ============================================================
; installer.iss - Gray's WMS Inno Setup Script
; Builds a professional setup.exe installer
;
; Requires: Inno Setup 6 (https://jrsoftware.org/isinfo.php)
; Run: ISCC.exe installer.iss
; Or use: build-installer.bat
;
; What it does:
;   Installs GraysWMS.exe + all web files to:
;   C:\fusion\fusionclientweb\graysWMSwebviewnew\
;   Creates desktop shortcut + Start Menu entry
; ============================================================

#define AppName "Gray's WMS"
#define AppVersion "1.2.0"
#define AppPublisher "Gray's Inc"
#define AppExeName "GraysWMS.exe"
#define InstallBase "C:\fusion\fusionclientweb\graysWMSwebviewnew"
#define DistFolder "dist"

[Setup]
AppId={{8F3A1C2D-4B5E-4F6A-9D8C-1E2F3A4B5C6D}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppContact=support@graysinc.com
DefaultDirName={#InstallBase}
DisableDirPage=yes
DefaultGroupName={#AppName}
OutputDir=installer-output
OutputBaseFilename=GraysWMS_Setup_v{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
SetupIconFile=
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#DistFolder}\{#AppExeName}
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Setup

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checked
Name: "startmenuicon"; Description: "Create a &Start Menu shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checked

[Dirs]
; Ensure C:\fusion exists with proper permissions
Name: "C:\fusion"; Permissions: everyone-full
Name: "C:\fusion\fusionclientweb"; Permissions: everyone-full
Name: "{app}"; Permissions: everyone-full
Name: "{app}\{#DistFolder}"; Permissions: everyone-full

[Files]
; ── Main executable (single-file, self-contained) ──
Source: "{#DistFolder}\{#AppExeName}"; DestDir: "{app}\{#DistFolder}"; Flags: ignoreversion

; ── Root web files ──
Source: "index.html";               DestDir: "{app}"; Flags: ignoreversion
Source: "login.html";               DestDir: "{app}"; Flags: ignoreversion
Source: "app.js";                   DestDir: "{app}"; Flags: ignoreversion
Source: "config.js";                DestDir: "{app}"; Flags: ignoreversion
Source: "styles.css";               DestDir: "{app}"; Flags: ignoreversion
Source: "printer-management-new.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "monitor-printing.js";      DestDir: "{app}"; Flags: ignoreversion
Source: "api-log.js";               DestDir: "{app}"; Flags: ignoreversion

; ── Module folders ──
Source: "wms\*";   DestDir: "{app}\wms";  Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Home\*";  DestDir: "{app}\Home"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "ap\*";    DestDir: "{app}\ap";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "ar\*";    DestDir: "{app}\ar";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "ca\*";    DestDir: "{app}\ca";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "fa\*";    DestDir: "{app}\fa";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "gl\*";    DestDir: "{app}\gl";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "om\*";    DestDir: "{app}\om";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "pos\*";   DestDir: "{app}\pos";  Flags: ignoreversion recursesubdirs createallsubdirs
Source: "sync\*";  DestDir: "{app}\sync"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Desktop shortcut
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#DistFolder}\{#AppExeName}"; \
  WorkingDir: "{app}\{#DistFolder}"; \
  Comment: "Gray's Warehouse Management System"; \
  Tasks: desktopicon

; Start Menu shortcut
Name: "{group}\{#AppName}"; Filename: "{app}\{#DistFolder}\{#AppExeName}"; \
  WorkingDir: "{app}\{#DistFolder}"; \
  Comment: "Gray's Warehouse Management System"; \
  Tasks: startmenuicon

; Start Menu uninstall
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
; Option to launch app after install
Filename: "{app}\{#DistFolder}\{#AppExeName}"; \
  Description: "Launch {#AppName} now"; \
  Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up any files created by the app at runtime (optional)
; Note: C:\fusion\fusionclientweb\graysWMSwebviewnew is the install dir,
; but leave C:\fusion\ data (pdfs, configs) untouched on uninstall.
Type: filesandordirs; Name: "{app}\{#DistFolder}"

[Code]
// Check for WebView2 runtime before install
function IsWebView2Installed(): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(
    HKLM,
    'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'pv',
    Version
  );
  if not Result then
    Result := RegQueryStringValue(
      HKCU,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv',
      Version
    );
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsWebView2Installed() then
  begin
    if MsgBox(
      'WebView2 Runtime is not installed.' + #13#10 + #13#10 +
      'Gray''s WMS requires the Microsoft Edge WebView2 Runtime.' + #13#10 +
      'It is usually pre-installed on Windows 10/11.' + #13#10 + #13#10 +
      'You can download it from:' + #13#10 +
      'https://developer.microsoft.com/microsoft-edge/webview2/' + #13#10 + #13#10 +
      'Continue installation anyway?',
      mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;
