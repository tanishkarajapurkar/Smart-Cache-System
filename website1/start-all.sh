#!/usr/bin/env bash
# ============================================================================
# APTS & PREDICTIVECACHE AI: ALL-IN-ONE ORCHESTRATOR
# ============================================================================
# Launches:
# 1. Rust APTS Cache Engine (Ports 7400 TCP & 7401 HTTP)
# 2. APTS Fastify/Express Backend with PredictiveCache AI Layer (Port 5001)
# 3. APTS Storefront React / Vite Frontend (Port 3000)
# 4. Background Traffic Workload Generator
# ============================================================================

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
CACHE_BIN="$PROJECT_ROOT/../Cache_Engine/target/debug/aptsd"

echo "======================================================================"
echo "🚀 STARTING APTS & PREDICTIVECACHE AI ECOSYSTEM"
echo "======================================================================"

# 1. Launch Rust APTS Cache Engine
if [ -f "$CACHE_BIN" ]; then
  echo "⚡ Launching Rust APTS Cache Engine (:7400 TCP / :7401 HTTP)..."
  "$CACHE_BIN" &
  CACHE_PID=$!
  echo "   -> Cache Engine running (PID: $CACHE_PID)"
else
  echo "⚠️ Cache engine binary not found at $CACHE_BIN. Run 'cargo build' in Cache_Engine."
fi

# Wait briefly for cache engine ports to open
sleep 1

# 2. Launch Backend
echo "⚡ Launching APTS Backend & PredictiveCache AI Gateway (:5001)..."
npm run dev:backend &
BACKEND_PID=$!
echo "   -> Backend running (PID: $BACKEND_PID)"

# 3. Launch Frontend Storefront
echo "⚡ Launching APTS Storefront (:3000)..."
npm run dev:frontend &
FRONTEND_PID=$!
echo "   -> Frontend running (PID: $FRONTEND_PID)"

# 4. Launch Traffic Simulator
echo "⚡ Launching Traffic Simulator..."
npm run simulator &
SIM_PID=$!
echo "   -> Simulator running (PID: $SIM_PID)"

echo "======================================================================"
echo "✅ ALL SERVICES ACTIVE!"
echo "   🛍️  APTS Storefront:     http://localhost:3000"
echo "   🧠  AI Cache Dashboard:   http://localhost:5001/dashboard"
echo "   ⚡  Axum Management API:  http://localhost:7401/stats"
echo "   📡  Backend REST API:     http://localhost:5001/api/v1"
echo "======================================================================"
echo "Press Ctrl+C to terminate all services."

cleanup() {
  echo ""
  echo "Shutting down all services..."
  kill $CACHE_PID $BACKEND_PID $FRONTEND_PID $SIM_PID 2>/dev/null || true
  exit 0
}

trap cleanup INT TERM
wait
