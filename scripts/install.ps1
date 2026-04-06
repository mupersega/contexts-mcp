# Contexts UI shortcut installer
# Creates two shortcuts pointing to contexts-ui.vbs:
#   1. Desktop:    click-to-launch
#   2. Startup:    auto-runs at Windows login
# Both are idempotent — re-running overwrites existing shortcuts.

$ErrorActionPreference = 'Stop'

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$vbsPath    = Join-Path $scriptDir 'contexts-ui.vbs'

if (-not (Test-Path $vbsPath)) {
    Write-Error "Launcher not found at $vbsPath"
    exit 1
}

$desktopLnk  = Join-Path ([Environment]::GetFolderPath('Desktop'))  'Contexts.lnk'
$startupLnk  = Join-Path ([Environment]::GetFolderPath('Startup'))  'Contexts.lnk'

function New-ContextsShortcut {
    param([string]$LnkPath)
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($LnkPath)
    $sc.TargetPath       = Join-Path $env:WINDIR 'System32\wscript.exe'
    $sc.Arguments        = '"' + $vbsPath + '"'
    $sc.WorkingDirectory = $projectDir
    $sc.Description      = 'Contexts — launch UI and open browser'
    $sc.WindowStyle      = 7   # minimized (hides wscript host briefly)
    $sc.Save()
    Write-Host "Created: $LnkPath"
}

New-ContextsShortcut -LnkPath $desktopLnk
New-ContextsShortcut -LnkPath $startupLnk

Write-Host ''
Write-Host 'Contexts is now installed.'
Write-Host '  Desktop icon: double-click Contexts on your desktop'
Write-Host '  Auto-start:   runs at next Windows login'
Write-Host ''
Write-Host "If you don't want auto-start, delete: $startupLnk"
