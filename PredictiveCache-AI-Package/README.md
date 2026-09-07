# PredictiveCache AI - Complete Project Package
**Intelligent Cost-Aware Predictive Caching Architecture & Fullstack E-Commerce Platform**

---

## 📦 What Is Inside This Package

### 1. 📊 PredictiveCache-AI-Dashboard.html
The full, standalone, zero-dependency interactive dashboard featuring:
- **Top Metrics**: Cache Hit Ratio (93.4%) and Response Time Comparison (11.8ms vs 185ms DB).
- **System Architecture**: 7-Stage pipeline showcasing the **In-Memory APTS Cache** tier.
- **AI Lookahead & Prefetch Queue**: Markov chain predictive warming at 0ms latency.
- **LeCaR Bandit Auto-Tuner**: Dynamic reinforcement learning weight auto-tuning (Cost Avoidance, Velocity, Recency).
- **Memory Sieve & Zstandard**: 2.42x compression ratio telemetry and bot scan deflection shield.
- **Enterprise ROI Calculator**: Interactive monthly traffic slider (1M - 100M reqs) calculating net annual cloud bill savings.
- **XAI Inspector**: SHAP-style mathematical utility decomposition & feature attribution modal.
- **Benchmark JSON Exporter**: Click "Export Report" in the header to download live benchmark data.

### 2. 📄 PredictiveCache-AI-Project-Report.doc
The complete executive specification and engineering report in Microsoft Word format (.doc).
Includes:
- Problem statement (Limits of classical LRU/LFU).
- Mathematical utility modeling formula U(k).
- Comparative benchmark tables (AI vs Baseline).
- 7-Stage end-to-end architecture breakdown.
- Complete core algorithmic code snippets.
- Live demonstration guide for presentations.

### 3. 📝 PredictiveCache-AI-Project-Report.md
The full Markdown edition of the project documentation, ready for GitHub, Notion, or Obsidian.

### 4. 🛒 APTS-Storefront/
The complete production-ready e-commerce application codebase:
- **backend/**: Fastify REST API, Supabase / PostgreSQL database integration, and product endpoints.
- **frontend/**: Modern React + Tailwind CSS storefront UI with shopping cart, reviews, and search.
- **Traffic Simulator scripts**:
  - run-traffic-simulator.bat: Continuous virtual traffic simulation that runs when the system is idle.
  - run-surge-simulator.bat: High-concurrency flash-sale traffic surge generator.
  - start-all.bat: Single-command launcher for the fullstack platform.

---

## 🚀 Quickstart Guide

### To View the AI Dashboard:
Double-click PredictiveCache-AI-Dashboard.html to open it in any browser (Google Chrome, Edge, Safari, Firefox). No build tools or node servers required!

### To Read the Specification:
Double-click PredictiveCache-AI-Project-Report.doc to view the full report in Microsoft Word or Google Docs.

### To Run the Fullstack E-Commerce Storefront:
1. Open a terminal in the APTS-Storefront directory.
2. Run .\start-all.bat to launch the Fastify API backend and Vite storefront frontend.
3. Open a second terminal and run .\run-traffic-simulator.bat to start the continuous virtual traffic simulator.
