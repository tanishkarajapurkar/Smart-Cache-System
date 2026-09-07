import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db } from './database/db.js';
import { productRoutes } from './routes/products.js';
import { categoryRoutes } from './routes/categories.js';
import { searchRoutes } from './routes/search.js';
import { flashSaleRoutes } from './routes/flash-sales.js';
import { cartRoutes } from './routes/cart.js';
import { wishlistRoutes } from './routes/wishlist.js';
import { orderRoutes } from './routes/orders.js';
import { recommendationRoutes } from './routes/recommendations.js';
import { trafficRoutes, markUserActivity } from './routes/traffic.js';
import { predictiveCacheRoutes } from './routes/predictive-cache.js';
import { predictiveCacheMiddleware } from './cache/caching-middleware.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS for frontend & dashboard
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id', 'x-workload-simulator', 'x-prefetch-worker']
}));

app.use(express.json());

// Traffic instrumentation and real-user activity middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const userAgent = req.headers['user-agent'] || '';
  const isSimulator =
    userAgent.includes('TrafficSimulator') ||
    userAgent.includes('Simulator') ||
    req.headers['x-workload-simulator'] === 'true';

  const sessionId = (req.headers['x-session-id'] as string) || undefined;

  // If real user is browsing from a browser, update the activity monitor
  if (!isSimulator && !req.path.includes('/traffic/activity') && !req.path.includes('/predictive-cache')) {
    markUserActivity(sessionId);
  }

  // Record response event once finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Disregard internal polling from bloating the dataset
    if (
      !req.path.includes('/traffic/activity') &&
      !req.path.includes('/health') &&
      !req.path.includes('/predictive-cache') &&
      !req.path.includes('/dashboard')
    ) {
      db.recordTrafficEvent({
        endpoint: req.originalUrl || req.url,
        method: req.method,
        status_code: res.statusCode,
        response_time: duration,
        source: isSimulator ? 'simulator' : 'commercial_storefront',
        scenario: isSimulator ? 'virtual_workload' : 'human_browse',
        session_id: sessionId
      }).catch(() => {});
    }
  });

  next();
});

// Serve PredictiveCache AI Real-Time Dashboard
const candidateDashboardPaths = [
  path.resolve(process.cwd(), '../../PredictiveCache-AI-Package/PredictiveCache-AI-Dashboard.html'),
  path.resolve(process.cwd(), '../PredictiveCache-AI-Package/PredictiveCache-AI-Dashboard.html'),
  path.resolve(__dirname, '../../PredictiveCache-AI-Package/PredictiveCache-AI-Dashboard.html'),
  path.resolve(__dirname, '../../../PredictiveCache-AI-Package/PredictiveCache-AI-Dashboard.html'),
  path.resolve(__dirname, '../../../../PredictiveCache-AI-Package/PredictiveCache-AI-Dashboard.html'),
  path.resolve(__dirname, '../public/PredictiveCache-AI-Dashboard.html'),
  path.resolve(process.cwd(), '../../PredictiveCache-AI-Package /PredictiveCache-AI-Dashboard.html'),
  path.resolve(process.cwd(), '../PredictiveCache-AI-Package /PredictiveCache-AI-Dashboard.html')
];

app.get(['/dashboard', '/predictive-ai-cache'], (_req: Request, res: Response) => {
  for (const p of candidateDashboardPaths) {
    if (fs.existsSync(p)) {
      return res.sendFile(p);
    }
  }
  res.status(404).send('PredictiveCache AI Dashboard HTML file not found.');
});

// Health checks
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'APTS E-Commerce Backend', time: new Date().toISOString() });
});

app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: 'v1', time: new Date().toISOString() });
});

// Apply PredictiveCache AI transparent caching layer
app.use(predictiveCacheMiddleware);

// Mount /api/v1 modules
const v1 = express.Router();
v1.use('/products', productRoutes);
v1.use('/categories', categoryRoutes);
v1.use('/search', searchRoutes);
v1.use('/flash-sales', flashSaleRoutes);
v1.use('/deals', flashSaleRoutes);
v1.use('/cart', cartRoutes);
v1.use('/wishlist', wishlistRoutes);
v1.use('/orders', orderRoutes);
v1.use('/checkout', orderRoutes);
v1.use('/recommendations', recommendationRoutes);
v1.use('/traffic', trafficRoutes);
v1.use('/predictive-cache', predictiveCacheRoutes);
v1.use('/crawler', predictiveCacheRoutes);

app.use('/api/v1', v1);

// Initialize DB and launch server
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 APTS STOREFRONT BACKEND RUNNING ON http://localhost:${PORT}`);
    console.log(`🧠 PREDICTIVECACHE AI DASHBOARD: http://localhost:${PORT}/dashboard`);
    console.log(`⚡ Rust APTS Cache Engine Bridge: 127.0.0.1:7400 (TCP) & :7401 (Axum)`);
    console.log(`=======================================================`);
  });
}).catch(err => {
  console.error('[DB Init Error]', err);
  app.listen(PORT, () => {
    console.log(`🚀 APTS Backend running on http://localhost:${PORT} with memory fallback`);
  });
});
