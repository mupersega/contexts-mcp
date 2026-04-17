# Contexts UI shortcut installer
# Default: creates a Desktop shortcut only (click-to-launch).
# With -AutoStart: also creates a Startup-folder shortcut (auto-runs at login).
# With -SkipSetup: does NOT run the interactive setup step.
# Re-running is idempotent - existing shortcuts are overwritten.

param(
    [switch]$AutoStart,
    [switch]$SkipSetup
)

$ErrorActionPreference = 'Stop'

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$vbsPath    = Join-Path $scriptDir 'contexts-ui.vbs'
$setupJs    = Join-Path $projectDir 'dist\setup.js'
$distIndex  = Join-Path $projectDir 'dist\index.js'

if (-not (Test-Path $vbsPath)) {
    Write-Error "Launcher not found at $vbsPath"
    exit 1
}

if (-not (Test-Path $distIndex)) {
    Write-Host "dist/ not found - running npm run build first..."
    Push-Location $projectDir
    try { npm run build | Out-Host } finally { Pop-Location }
}

if (-not $SkipSetup) {
    if (-not (Test-Path $setupJs)) {
        Write-Error "Setup entrypoint not found at $setupJs - did the build succeed?"
        exit 1
    }
    Write-Host ''
    Write-Host '=== Interactive setup ==='
    Write-Host 'Configuring data directory and UI port.'
    Write-Host 'Press Enter to accept the suggested defaults.'
    Write-Host ''
    # node dist/setup.js runs in foreground so the user can see the prompts.
    & node $setupJs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Setup failed (exit $LASTEXITCODE). Re-run manually: node dist\setup.js"
        exit $LASTEXITCODE
    }
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
    $sc.Description      = 'Contexts - launch UI and open browser'
    $sc.WindowStyle      = 7
    $sc.Save()
    Write-Host "Created: $LnkPath"
    Write-Host "  targets: $vbsPath"
}

New-ContextsShortcut -LnkPath $desktopLnk

if ($AutoStart) {
    New-ContextsShortcut -LnkPath $startupLnk
}

Write-Host ''
Write-Host 'Contexts is now installed.'
Write-Host "  Install path: $projectDir"
Write-Host "  Launcher:     $vbsPath"
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
Write-Host ''
Write-Host 'If you move this install to a new path later, re-run install.ps1 from the new location to rewrite the shortcuts.'
