# Wrapper launcher from Cache_Engine
$RootDir = Split-Path -Parent $PSScriptRoot
if (Test-Path "$RootDir\start-all.ps1") {
    & "$RootDir\start-all.ps1"
} else {
    Write-Host "Please run start-all.ps1 from the root Smart-Cache-System-main directory." -ForegroundColor Yellow
}
