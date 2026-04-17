# Contexts UI shortcut uninstaller
# Removes the Desktop and Startup shortcuts created by install.ps1.
# Does NOT stop a running server - use the Shutdown button in the UI
# (or close the hidden wscript/node process manually) for that.

$ErrorActionPreference = 'Stop'

$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Contexts.lnk'
$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Contexts.lnk'

function Remove-ContextsShortcut {
    param([string]$LnkPath, [string]$Label)
    if (Test-Path $LnkPath) {
        Remove-Item $LnkPath
        Write-Host "Removed $Label shortcut: $LnkPath"
    } else {
        Write-Host "No $Label shortcut found at: $LnkPath"
    }
}

Remove-ContextsShortcut -LnkPath $desktopLnk -Label 'Desktop'
Remove-ContextsShortcut -LnkPath $startupLnk -Label 'Startup'

Write-Host ''
Write-Host 'Uninstall complete. A running server (if any) is still alive -'
Write-Host 'open http://localhost:3141 and click Shutdown in the footer to stop it.'
