@echo off
title APTS Smart Cache System - Fullstack Ecosystem
echo ======================================================================
echo 🚀 STARTING APTS SMART CACHE SYSTEM
echo ======================================================================

echo ⚡ [1/4] Launching APTS Cache Engine (Ports 7400 TCP and 7401 HTTP)...
start "APTS Cache Engine" cmd /k "cd /d %~dp0Cache_Engine && node cache-server.js"

timeout /t 2 /nobreak >nul

echo ⚡ [2/4] Launching Backend REST API and PredictiveCache AI Dashboard (:5001)...
start "APTS Backend & Dashboard" cmd /k "cd /d %~dp0website1\backend && npm run dev"

timeout /t 3 /nobreak >nul

echo ⚡ [3/4] Launching APTS Storefront Frontend (:3000)...
start "APTS Storefront Frontend" cmd /k "cd /d %~dp0website1\frontend && npm run dev"

timeout /t 3 /nobreak >nul

echo ⚡ [4/4] Launching Background Traffic Simulator...
start "APTS Traffic Simulator" cmd /k "cd /d %~dp0website1\traffic-simulator && npm run normal"

echo ======================================================================
echo ✅ ALL SERVICES LAUNCHED IN SEPARATE CONSOLES!
echo.
echo    🛍️  Storefront Website:    http://localhost:3000
echo    🧠  AI Cache Dashboard:   http://localhost:5001/dashboard
echo    📡  Backend REST API:     http://localhost:5001/api/v1
echo    📊  Cache Stats API:      http://localhost:7401/stats
echo ======================================================================
pause
