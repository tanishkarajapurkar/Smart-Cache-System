/**
 * ============================================================================
 * APTS E-COMMERCE: REALISTIC TRAFFIC SIMULATOR & WORKLOAD GENERATOR
 * ============================================================================
 * Purpose: Headless workload generator for CacheX/cache system.
 * Simulates realistic virtual customer behaviors and detects site idle states
 * to generate continuous background traffic for caching benchmarks.
 *
 * Usage:
 *   npm run start
 *   npm run normal
 *   npm run high
 *   npm run surge
 *   npm run flash
 * ============================================================================
 */

interface SimulatorConfig {
  baseUrl: string;
  mode: 'idle' | 'demo' | 'low' | 'normal' | 'high' | 'surge' | 'flash_sale';
  autoIdleDetection: boolean;
  virtualUsers: number;
}

interface SimStats {
  startTime: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  latencies: number[];
  recentReqs: number;
  currentRps: number;
  currentMode: string;
  secondsSinceHumanActivity: number;
  lastAction: string;
}

// Parse CLI arguments
const args = process.argv.slice(2).reduce((acc: Record<string, string>, arg) => {
  const [k, v] = arg.replace(/^--/, '').split('=');
  acc[k.toLowerCase()] = v !== undefined ? v : 'true';
  return acc;
}, {});

const isSlowMode = args.mode === 'idle' || args.mode === 'demo';
const defaultUsers = isSlowMode ? '1' : '8';

const CONFIG: SimulatorConfig = {
  baseUrl: args.url || process.env.API_URL || 'http://localhost:5001',
  mode: (args.mode as any) || 'idle',
  autoIdleDetection: args['auto-idle'] === 'true',
  virtualUsers: parseInt(args.users || defaultUsers, 10)
};

const STATS: SimStats = {
  startTime: Date.now(),
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  latencies: [],
  recentReqs: 0,
  currentRps: 0,
  currentMode: CONFIG.mode.toUpperCase(),
  secondsSinceHumanActivity: 0,
  lastAction: 'Initializing simulator...'
};

// Target delays in ms between requests per virtual worker
const MODE_INTERVALS: Record<string, number> = {
  idle: 60000,    // 1 minute (60,000 ms) = exactly 1 request every 1 minute when idle
  demo: 5000,     // 5 seconds (5,000 ms) = steady presentation pace
  low: 3000,      // ~20 req/min per worker
  normal: 300,    // ~200 req/min
  high: 60,       // ~1,000 req/min
  surge: 12,      // ~5,000 req/min
  flash_sale: 25  // High frequency targeted
};

const SEARCH_QUERIES = [
  'wireless headphones',
  'gaming keyboard',
  'curved monitor',
  'creator laptop',
  'titanium smartwatch',
  'espresso machine',
  'damascus knife',
  'leather backpack',
  'nvme ssd',
  'zero-drop sneakers',
  'kettlebell',
  'ergonomic chair',
  'beard trimmer'
];

const KNOWN_PRODUCT_IDS = [
  'prod_apts_anc_headphones',
  'prod_apts_earbuds_pro',
  'prod_apts_oled_smartwatch',
  'prod_apts_curved_monitor',
  'prod_apts_zenith_laptop',
  'prod_apts_nvme_2tb',
  'prod_apts_phantom_keyboard',
  'prod_apts_pro_wireless_mouse',
  'prod_apts_leather_backpack',
  'prod_apts_minimalist_sneakers',
  'prod_apts_espresso_maker',
  'prod_apts_damascus_knife_set',
  'prod_apts_sonic_trimmer',
  'prod_apts_system_design_handbook'
];

const CATEGORIES = [
  'electronics',
  'computers',
  'gaming',
  'fashion',
  'home',
  'kitchen',
  'sports',
  'beauty',
  'books'
];

async function executeRequest(
  method: string,
  path: string,
  scenario: string,
  sessionId: string,
  body?: any
): Promise<boolean> {
  const start = Date.now();
  STATS.totalRequests++;
  STATS.recentReqs++;

  try {
    const url = `${CONFIG.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'APTS-TrafficSimulator/2.0 (WorkloadGenerator)',
        'x-workload-simulator': 'true',
        'x-session-id': sessionId
      }
    };

    if (body) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const latency = Date.now() - start;
    STATS.latencies.push(latency);
    if (STATS.latencies.length > 300) STATS.latencies.shift();

    if (res.ok) {
      STATS.successfulRequests++;
      STATS.lastAction = `${method} ${path.slice(0, 35)} (${latency}ms) [${scenario}]`;
      return true;
    } else {
      STATS.failedRequests++;
      STATS.lastAction = `FAILED ${method} ${path} status=${res.status}`;
      return false;
    }
  } catch (err) {
    STATS.failedRequests++;
    STATS.lastAction = `ERR: ${(err as Error).message.slice(0, 30)}`;
    return false;
  }
}

// ----------------------------------------------------------------------------
// Virtual Customer Journeys
// ----------------------------------------------------------------------------

// Customer 1: Casual Browser (Homepage -> Category -> Product -> Reviews -> Related)
async function simulateCustomer1(sessionId: string) {
  // 1. Homepage
  await executeRequest('GET', '/api/v1/recommendations', 'browse_home', sessionId);
  await new Promise(r => setTimeout(r, 100));

  // 2. Category Listing
  const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  await executeRequest('GET', `/api/v1/products?category=${cat}&limit=12`, 'browse_category', sessionId);
  await new Promise(r => setTimeout(r, 120));

  // 3. Product Details
  const prodId = KNOWN_PRODUCT_IDS[Math.floor(Math.random() * KNOWN_PRODUCT_IDS.length)];
  await executeRequest('GET', `/api/v1/products/${prodId}`, 'view_product', sessionId);

  // 4. Reviews & Related
  await executeRequest('GET', `/api/v1/products/${prodId}/reviews`, 'view_reviews', sessionId);
  await executeRequest('GET', `/api/v1/products/${prodId}/related`, 'view_related', sessionId);
}

// Customer 2: Searcher & Filterer (Search -> Filter -> View -> Add to Cart)
async function simulateCustomer2(sessionId: string) {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  await executeRequest('GET', `/api/v1/search?q=${encodeURIComponent(query)}`, 'search', sessionId);
  await new Promise(r => setTimeout(r, 80));

  const prodId = KNOWN_PRODUCT_IDS[Math.floor(Math.random() * KNOWN_PRODUCT_IDS.length)];
  await executeRequest('GET', `/api/v1/products/${prodId}`, 'search_view', sessionId);

  // Add to cart
  await executeRequest('POST', '/api/v1/cart/items', 'add_cart', sessionId, {
    productId: prodId,
    quantity: 1
  });
  await executeRequest('GET', '/api/v1/cart', 'view_cart', sessionId);
}

// Customer 3: Flash Sale Hunter (Flash Sale -> Product -> Cart -> Checkout)
async function simulateCustomer3(sessionId: string) {
  await executeRequest('GET', '/api/v1/flash-sales', 'flash_sale_view', sessionId);
  await executeRequest('GET', '/api/v1/deals', 'deals_view', sessionId);

  const flashProdId = 'prod_apts_anc_headphones';
  await executeRequest('GET', `/api/v1/products/${flashProdId}`, 'flash_product', sessionId);

  // Instant Add to Cart
  await executeRequest('POST', '/api/v1/cart/items', 'flash_add_cart', sessionId, {
    productId: flashProdId,
    quantity: 1
  });

  // Simulated Checkout
  await executeRequest('POST', '/api/v1/checkout', 'simulated_checkout', sessionId, {
    shippingAddress: {
      fullName: 'Virtual Buyer',
      addressLine1: '108 Brigade Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560025',
      phone: '+91 99887 76655'
    },
    paymentMethod: 'Simulated Instant UPI'
  });
}

// Customer 4: Wishlist & Comparison Shopper (Search -> View -> Wishlist -> Related)
async function simulateCustomer4(sessionId: string) {
  const prodId = KNOWN_PRODUCT_IDS[Math.floor(Math.random() * KNOWN_PRODUCT_IDS.length)];
  await executeRequest('GET', `/api/v1/products/${prodId}`, 'wishlist_view', sessionId);

  await executeRequest('POST', `/api/v1/wishlist/${prodId}`, 'add_wishlist', sessionId);
  await executeRequest('GET', '/api/v1/wishlist', 'get_wishlist', sessionId);
  await executeRequest('GET', `/api/v1/products/${prodId}/related`, 'related_compare', sessionId);
}

// Customer 5: Scraper / Crawler Bot (Tests Bot Scan Deflection & Cache Admission Bypass)
async function simulateCrawlerBot(sessionId: string) {
  await executeRequest('GET', '/api/v1/crawler/scrape?target=index_catalog', 'bot_scrape', sessionId);
  await executeRequest('GET', `/api/v1/products?random_cold_scan=${Date.now()}`, 'bot_cold_scan', sessionId);
}

// Single request generator for idle background heartbeat (1 request / min)
async function simulateSingleIdleRequest(sessionId: string) {
  const choices = [
    () => executeRequest('GET', '/api/v1/recommendations', 'idle_heartbeat', sessionId),
    () => executeRequest('GET', '/api/v1/deals', 'idle_heartbeat', sessionId),
    () => executeRequest('GET', '/api/v1/flash-sales', 'idle_heartbeat', sessionId),
    () => {
      const prodId = KNOWN_PRODUCT_IDS[Math.floor(Math.random() * KNOWN_PRODUCT_IDS.length)];
      return executeRequest('GET', `/api/v1/products/${prodId}`, 'idle_heartbeat', sessionId);
    },
    () => {
      const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
      return executeRequest('GET', `/api/v1/search?q=${encodeURIComponent(query)}`, 'idle_heartbeat', sessionId);
    },
    () => {
      const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
      return executeRequest('GET', `/api/v1/products?category=${cat}&limit=12`, 'idle_heartbeat', sessionId);
    }
  ];
  const choice = choices[Math.floor(Math.random() * choices.length)];
  await choice();
}

// ----------------------------------------------------------------------------
// Idle Website Detection & Workload Scaler
// ----------------------------------------------------------------------------
async function checkIdleActivity() {
  if (CONFIG.mode === 'idle') return;

  try {
    // Check PredictiveCache AI telemetry for dashboard-triggered mode
    const cacheRes = await fetch(`${CONFIG.baseUrl}/api/v1/predictive-cache/telemetry`);
    if (cacheRes.ok) {
      const cacheData = await cacheRes.json();
      if (cacheData.mode && cacheData.mode !== CONFIG.mode) {
        CONFIG.mode = cacheData.mode;
        STATS.currentMode = cacheData.mode.toUpperCase();
        return;
      }
    }
  } catch {}

  if (!CONFIG.autoIdleDetection) return;

  try {
    const res = await fetch(`${CONFIG.baseUrl}/api/v1/traffic/activity`);
    if (res.ok) {
      const data = await res.json();
      STATS.secondsSinceHumanActivity = data.secondsSinceActivity || 0;

      // Automatically scale simulation mode based on idle detection
      if (data.recommendedMode && CONFIG.mode !== 'poisoning' && CONFIG.mode !== 'idle') {
        CONFIG.mode = data.recommendedMode.toLowerCase() as any;
        STATS.currentMode = data.recommendedMode;
      }
    }
  } catch {
    // Backend may still be initializing
  }
}

// ----------------------------------------------------------------------------
// Worker Loop
// ----------------------------------------------------------------------------
async function startVirtualUser(userId: number) {
  const sessionId = `sim_user_${userId}_${Math.random().toString(36).substring(2, 7)}`;

  while (true) {
    try {
      if (CONFIG.mode === 'idle') {
        await simulateSingleIdleRequest(sessionId);
      } else if (CONFIG.mode === 'poisoning') {
        await simulateCrawlerBot(sessionId);
      } else if (CONFIG.mode === 'flash_sale') {
        await simulateCustomer3(sessionId); // Flash sale shopper
      } else {
        const dice = Math.random() * 100;
        if (dice < 35) {
          await simulateCustomer3(sessionId); // Flash sale shopper
        } else if (dice < 60) {
          await simulateCustomer1(sessionId); // Casual browser
        } else if (dice < 85) {
          await simulateCustomer2(sessionId); // Searcher & filterer
        } else {
          await simulateCustomer4(sessionId); // Wishlist shopper
        }
      }
    } catch {
      // Ignore worker failures, continue simulation
    }

    const interval = MODE_INTERVALS[CONFIG.mode] || 60000;
    const delay = CONFIG.mode === 'idle' ? interval : interval * (0.8 + Math.random() * 0.4);
    await new Promise(r => setTimeout(r, delay));
  }
}

// ----------------------------------------------------------------------------
// Console Dashboard
// ----------------------------------------------------------------------------
function printDashboard() {
  const uptime = Math.floor((Date.now() - STATS.startTime) / 1000);
  const avgLatency = STATS.latencies.length
    ? Math.round(STATS.latencies.reduce((a, b) => a + b, 0) / STATS.latencies.length)
    : 0;

  const successRate = STATS.totalRequests
    ? ((STATS.successfulRequests / STATS.totalRequests) * 100).toFixed(1)
    : '100.0';

  console.clear();
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║        APTS E-COMMERCE — REAL-TIME WORKLOAD GENERATOR (CACHEX)       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(` Target Backend:  ${CONFIG.baseUrl}`);
  console.log(` Active Mode:     \x1b[1m\x1b[36m[ ${STATS.currentMode} ]\x1b[0m (Interval: ${MODE_INTERVALS[CONFIG.mode]}ms)`);
  console.log(` Virtual Users:   ${CONFIG.virtualUsers} concurrent personas`);
  console.log(` Auto-Idle Check: ${CONFIG.autoIdleDetection ? 'ENABLED (Adapts to real visitors)' : 'DISABLED'}`);
  console.log(` Visitor Idle:    ${STATS.secondsSinceHumanActivity}s since last human activity`);
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(` Total Requests:  \x1b[32m${STATS.totalRequests.toLocaleString()}\x1b[0m (Success: ${successRate}%)`);
  console.log(` Current RPS:     \x1b[33m${STATS.currentRps} req/sec\x1b[0m`);
  console.log(` Avg Latency:     \x1b[35m${avgLatency} ms\x1b[0m`);
  console.log(` Uptime:          ${uptime}s`);
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(` Last Action:     ${STATS.lastAction}`);
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' Press Ctrl+C to stop simulation.');
}

// ----------------------------------------------------------------------------
// Entry Point
// ----------------------------------------------------------------------------
async function main() {
  console.log('Starting APTS Workload Generator...');

  // Start RPS counter interval
  setInterval(() => {
    STATS.currentRps = STATS.recentReqs;
    STATS.recentReqs = 0;
  }, 1000);

  // Start Idle Detection Monitor interval
  setInterval(checkIdleActivity, 4000);

  // Start Console Dashboard refresh
  setInterval(printDashboard, 1500);

  // Spawn Virtual Users
  for (let i = 1; i <= CONFIG.virtualUsers; i++) {
    startVirtualUser(i);
    await new Promise(r => setTimeout(r, 100));
  }
}

main().catch(console.error);
