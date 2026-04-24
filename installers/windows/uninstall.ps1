<#
.SYNOPSIS
    Reverse installers/windows/install.ps1
#>

$ErrorActionPreference = "SilentlyContinue"

Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA "Capsule")
Remove-Item -Recurse -Force "HKCU:\Software\Classes\.capsule"
Remove-Item -Recurse -Force "HKCU:\Software\Classes\Capsule.Document"

$signature = @'
[DllImport("Shell32.dll")]
public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
'@
(Add-Type -MemberDefinition $signature -Name "Shell32Notify" -PassThru)::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "Uninstalled."
