# Contexts UI shortcut installer
# Default: creates a Desktop shortcut only (click-to-launch).
# With -AutoStart: also creates a Startup-folder shortcut (auto-runs at login).
# Re-running is idempotent — existing shortcuts are overwritten.

param(
    [switch]$AutoStart
)

$ErrorActionPreference = 'Stop'

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$vbsPath    = Join-Path $scriptDir 'contexts-ui.vbs'

if (-not (Test-Path $vbsPath)) {
    Write-Error "Launcher not found at $vbsPath"
    exit 1
}

$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Contexts.lnk'
$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Contexts.lnk'

function New-ContextsShortcut {
    param([string]$LnkPath)
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($LnkPath)
    $sc.TargetPath       = Join-Path $env:WINDIR 'System32\wscript.exe'
    $sc.Arguments        = '"' + $vbsPath + '"'
    $sc.WorkingDirectory = $projectDir
    $sc.Description      = 'Contexts — launch UI and open browser'
    $sc.WindowStyle      = 7
    $sc.Save()
    Write-Host "Created: $LnkPath"
}

New-ContextsShortcut -LnkPath $desktopLnk

if ($AutoStart) {
    New-ContextsShortcut -LnkPath $startupLnk
}

Write-Host ''
Write-Host 'Contexts is now installed.'
Write-Host '  Desktop icon: double-click Contexts on your desktop'
if ($AutoStart) {
    Write-Host '  Auto-start:   runs at next Windows login'
    Write-Host ''
    Write-Host "To disable auto-start later, run: scripts\uninstall.ps1"
} else {
    Write-Host ''
    Write-Host 'Auto-start at login is NOT enabled. To enable it, re-run with:'
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -AutoStart'
}
