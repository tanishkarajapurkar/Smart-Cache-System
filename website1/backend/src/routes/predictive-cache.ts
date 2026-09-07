/**
 * ============================================================================
 * PREDICTIVECACHE AI: REAL-TIME TELEMETRY & MANAGEMENT API
 * ============================================================================
 * Endpoints powering the PredictiveCache AI Dashboard:
 * - GET  /api/v1/predictive-cache/telemetry  -> Live hit ratios, memory, latencies
 * - GET  /api/v1/predictive-cache/stream     -> Real-time request audit log
 * - POST /api/v1/predictive-cache/workload   -> Switch Normal / Surge / Poisoning
 * - POST /api/v1/predictive-cache/purge      -> Flush Rust APTS Cache & metrics
 * - POST /api/v1/predictive-cache/evaluate   -> Recalculate utility scores
 * - POST /api/v1/predictive-cache/demo/:id   -> Execute Cold Miss / Warm Hit / Surge
 * - GET  /api/v1/crawler/scrape              -> Bot scan simulation endpoint
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { predictiveEngine, WorkloadMode } from '../cache/predictive-engine.js';
import { db } from '../database/db.js';

export const predictiveCacheRoutes = Router();

// GET /api/v1/predictive-cache/telemetry
predictiveCacheRoutes.get('/telemetry', async (_req: Request, res: Response) => {
  try {
    const trafficStats = db.getTrafficStats();
    const payload = await predictiveEngine.getTelemetryPayload(trafficStats);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/v1/predictive-cache/stream
predictiveCacheRoutes.get('/stream', (_req: Request, res: Response) => {
  res.json({
    stream: predictiveEngine.auditStream,
    total: predictiveEngine.auditStream.length
  });
});

// POST /api/v1/predictive-cache/workload
predictiveCacheRoutes.post('/workload', (req: Request, res: Response) => {
  const { mode } = req.body;
  if (!['normal', 'flash_sale', 'poisoning'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode. Choose normal, flash_sale, or poisoning.' });
  }

  predictiveEngine.setWorkloadMode(mode as WorkloadMode);
  res.json({
    success: true,
    activeMode: mode,
    banditWeights: predictiveEngine.banditWeights
  });
});

// POST /api/v1/predictive-cache/purge
predictiveCacheRoutes.post('/purge', (_req: Request, res: Response) => {
  predictiveEngine.purgeCache();
  res.json({ success: true, message: 'APTS Cache Engine flushed and metrics reset.' });
});

// POST /api/v1/predictive-cache/evaluate
predictiveCacheRoutes.post('/evaluate', (_req: Request, res: Response) => {
  predictiveEngine.recalculateMatrixScores();
  res.json({
    success: true,
    matrix: Array.from(predictiveEngine.endpointMatrix.values())
  });
});

predictiveCacheRoutes.post('/demo/:id', async (req: Request, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId || '0', 10);
  const baseUrl = `http://127.0.0.1:${process.env.PORT || 5000}`;

  try {
    if (id === 1) {
      // Demo 1: Cold Cache Miss -> Purge key, then fetch
      await fetch(`${baseUrl}/api/v1/products?category=gaming&_bust=${Date.now()}`);
      return res.json({ success: true, demo: 'Cold Cache Miss triggered' });
    } else if (id === 2) {
      // Demo 2: Warm Cache Hit -> Fetch repeatedly to demonstrate 0.4ms - 4ms hit
      await fetch(`${baseUrl}/api/v1/products/prod_apts_anc_headphones`);
      await fetch(`${baseUrl}/api/v1/products/prod_apts_anc_headphones`);
      return res.json({ success: true, demo: 'Warm Cache Hit triggered' });
    } else if (id === 3) {
      // Demo 3: AI Surge -> Burst 6 concurrent requests
      const promises = [
        fetch(`${baseUrl}/api/v1/flash-sales`),
        fetch(`${baseUrl}/api/v1/deals`),
        fetch(`${baseUrl}/api/v1/recommendations`),
        fetch(`${baseUrl}/api/v1/products/prod_apts_curved_monitor`),
        fetch(`${baseUrl}/api/v1/products/prod_apts_oled_smartwatch`),
        fetch(`${baseUrl}/api/v1/products`)
      ];
      await Promise.all(promises);
      return res.json({ success: true, demo: 'AI Surge burst executed' });
    }
    res.status(400).json({ error: 'Unknown demo ID' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/v1/crawler/scrape & /api/v1/predictive-cache/scrape
predictiveCacheRoutes.get(['/scrape', '/crawler/scrape'], (req: Request, res: Response) => {
  predictiveEngine.stats.scansDeflected++;
  res.setHeader('X-Cache', 'BYPASS-REJECTED');
  res.setHeader('X-Shield', 'MemorySieve-Deflected');
  res.json({
    status: 'deflected',
    message: 'Cold crawler pattern detected. Rejected from APTS RAM cache to prevent pollution.',
    costAvoided: '$0.00022'
  });
});
