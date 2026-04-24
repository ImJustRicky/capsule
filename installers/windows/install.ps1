<#
.SYNOPSIS
    Install Capsule on Windows and register it as the handler for .capsule files.

.DESCRIPTION
    Installs a packaged runtime, or builds one when run from a source checkout.
    It copies the runtime under %LOCALAPPDATA%\Capsule, drops a launcher .cmd
    into the same folder, and writes the registry entries that make Explorer
    route .capsule double-clicks to it.

    No admin rights required — everything is per-user (HKCU).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\installers\windows\install.ps1

.NOTES
    Tested on Windows 10/11 with Node 20+ and PowerShell 5+.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRootCandidate = Resolve-Path (Join-Path $ScriptDir "..\..") -ErrorAction SilentlyContinue
$RepoRoot = if ($RepoRootCandidate) { $RepoRootCandidate.Path } else { $null }
$BundledRuntime = Join-Path $ScriptDir "runtime"
$BundledAssets = Join-Path $ScriptDir "assets"
$SourceAssets = if ($RepoRoot) { Join-Path $RepoRoot "installers\assets" } else { $null }
$AssetDir = if (Test-Path $BundledAssets) { $BundledAssets } elseif ($SourceAssets -and (Test-Path $SourceAssets)) { $SourceAssets } else { $null }
$InstallDir = Join-Path $env:LOCALAPPDATA "Capsule"
$RuntimeDir = Join-Path $InstallDir "runtime"
$Launcher = Join-Path $InstallDir "capsule-launcher.cmd"
$IconPath = Join-Path $InstallDir "capsule.ico"

function Test-Node20 {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return $false }
    & node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" *> $null
    return $LASTEXITCODE -eq 0
}

if (-not (Test-Node20)) {
    throw "Capsule needs Node.js v20 or newer. Install it from https://nodejs.org and re-run this installer."
}

$UseBundledRuntime = Test-Path (Join-Path $BundledRuntime "packages\capsule-cli")
$UseSourceRuntime = -not $UseBundledRuntime -and $RepoRoot -and (Test-Path (Join-Path $RepoRoot "packages\capsule-cli"))

if ($UseSourceRuntime) {
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "Source install needs pnpm. Use a release zip to install without pnpm."
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "Source install needs npm. Install Node.js from https://nodejs.org and try again."
    }

    Write-Host "==> Building runtime"
    Push-Location $RepoRoot
    try {
        pnpm install --frozen-lockfile | Out-Null
        pnpm -r build
    } finally {
        Pop-Location
    }
} elseif (-not $UseBundledRuntime) {
    throw "No packaged runtime or source checkout found. Run this from a Capsule release zip, or from the repository checkout."
}

# --- Stage files ---
Write-Host "==> Installing to $InstallDir"
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

if ($UseBundledRuntime) {
    Write-Host "==> Copying packaged runtime"
    Copy-Item -Recurse -Force (Join-Path $BundledRuntime "*") $RuntimeDir
} else {

    foreach ($pkg in @("capsule-core", "capsule-runtime", "capsule-cli")) {
        $src = Join-Path $RepoRoot "packages\$pkg"
        $dst = Join-Path $RuntimeDir "packages\$pkg"
        New-Item -ItemType Directory -Force -Path $dst | Out-Null
        Copy-Item -Recurse -Force (Join-Path $src "dist") (Join-Path $dst "dist")
        if (Test-Path (Join-Path $src "bin")) {
            Copy-Item -Recurse -Force (Join-Path $src "bin") (Join-Path $dst "bin")
        }
        Copy-Item -Force (Join-Path $src "package.json") (Join-Path $dst "package.json")
    }

    @'
{
  "name": "capsule-bundle",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": ["packages/*"]
}
'@ | Set-Content -Encoding UTF8 (Join-Path $RuntimeDir "package.json")

    node (Join-Path $RepoRoot "installers\scripts\rewrite-workspace-deps.mjs") $RuntimeDir

    Push-Location $RuntimeDir
    try {
        npm install --omit=dev --no-audit --no-fund --silent | Out-Null
    } finally {
        Pop-Location
    }
}

if ($AssetDir) {
    $IconSource = Join-Path $AssetDir "capsule.ico"
    if (Test-Path $IconSource) {
        Copy-Item -Force $IconSource $IconPath
    }
}

# --- Launcher .cmd ---
$entry = Join-Path $RuntimeDir "packages\capsule-cli\bin\capsule.mjs"
@"
@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
    powershell -Command "[System.Windows.Forms.MessageBox]::Show('Capsule needs Node.js (v20 or newer). Install from https://nodejs.org', 'Capsule', 'OK', 'Warning')"
    exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
    powershell -Command "[System.Windows.Forms.MessageBox]::Show('Capsule needs Node.js v20 or newer.', 'Capsule', 'OK', 'Warning')"
    exit /b 1
)
if "%~1"=="" (
    powershell -Command "[System.Windows.Forms.MessageBox]::Show('Capsule is installed. Double-click a .capsule file to open it.', 'Capsule', 'OK', 'Information')"
    exit /b 0
)
node "$entry" run %*
"@ | Set-Content -Encoding ASCII $Launcher

# --- File association (HKCU) ---
Write-Host "==> Registering file association"

$progId = "Capsule.Document"
$extKey = "HKCU:\Software\Classes\.capsule"
$progIdKey = "HKCU:\Software\Classes\$progId"
$openCmdKey = "$progIdKey\shell\open\command"
$iconKey = "$progIdKey\DefaultIcon"

New-Item -Force -Path $extKey | Out-Null
Set-Item -Path $extKey -Value $progId
Set-ItemProperty -Path $extKey -Name "Content Type" -Value "application/vnd.capsule+zip"

New-Item -Force -Path $progIdKey | Out-Null
Set-Item -Path $progIdKey -Value "Capsule Document"
Set-ItemProperty -Path $progIdKey -Name "FriendlyTypeName" -Value "Capsule Document"
if (Test-Path $IconPath) {
    New-Item -Force -Path $iconKey | Out-Null
    Set-Item -Path $iconKey -Value "`"$IconPath`",0"
}

New-Item -Force -Path $openCmdKey | Out-Null
Set-Item -Path $openCmdKey -Value "`"$Launcher`" `"%1`""

# Tell the shell to refresh associations now.
$signature = @'
[DllImport("Shell32.dll")]
public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
'@
$shell = Add-Type -MemberDefinition $signature -Name "Shell32Notify" -PassThru
$shell::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host ""
Write-Host "Installed."
Write-Host "Try double-clicking any .capsule file."
