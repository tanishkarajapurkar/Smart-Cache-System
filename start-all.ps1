# APTS Smart Cache System - PowerShell Launcher
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "🚀 STARTING APTS SMART CACHE SYSTEM" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "⚡ [1/4] Launching APTS Cache Engine (:7400 TCP / :7401 HTTP)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\Cache_Engine'; node cache-server.js"

Start-Sleep -Seconds 2

Write-Host "⚡ [2/4] Launching APTS Backend API & Dashboard (:5001)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\website1\backend'; npm run dev"

Start-Sleep -Seconds 3

Write-Host "⚡ [3/4] Launching APTS Storefront Frontend (:3000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\website1\frontend'; npm run dev"

Start-Sleep -Seconds 3

Write-Host "⚡ [4/4] Launching Traffic Simulator..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\website1\traffic-simulator'; npm run normal"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "✅ ALL SERVICES ACTIVE!" -ForegroundColor Green
Write-Host "   🛍️  Storefront Website:    http://localhost:3000" -ForegroundColor White
Write-Host "   🧠  AI Cache Dashboard:   http://localhost:5001/dashboard" -ForegroundColor White
Write-Host "   📡  Backend REST API:     http://localhost:5001/api/v1" -ForegroundColor White
Write-Host "   📊  Cache Engine API:     http://localhost:7401/stats" -ForegroundColor White
Write-Host "======================================================================" -ForegroundColor Cyan
