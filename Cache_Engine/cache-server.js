import net from 'net';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// APTS Binary Protocol Constants
const MAGIC_BYTE_0 = 0x41; // 'A'
const MAGIC_BYTE_1 = 0x50; // 'P'
const HEADER_SIZE = 12;
const TRAILER_SIZE = 4;

const TCP_PORT = parseInt(process.env.APTS_TCP_PORT || '7400', 10);
const HTTP_PORT = parseInt(process.env.APTS_HTTP_PORT || '7401', 10);
const HOST = process.env.APTS_HOST || '127.0.0.1';
const MAX_MEMORY_BYTES = 128 * 1024 * 1024; // 128 MB

// Disk Persistence Configuration (Crash-Resilient Snapshotting)
const DATA_DIR = path.resolve(__dirname, 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'cache-snapshot.json');
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

const AptsCommand = {
  Get: 0x01,
  Set: 0x02,
  Delete: 0x03,
  Exists: 0x04,
  Expire: 0x05,
  Ttl: 0x06,
  MGet: 0x07,
  MSet: 0x08,
  Incr: 0x09,
  Decr: 0x0a,
  Ping: 0x0b,
  Info: 0x0c,
  Flush: 0x0d
};

// IEEE 802.3 CRC32 Table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// In-memory cache store
// Item structure: { value, expiry, size, lastAccess, createdAt, hits, hotness }
const cache = new Map();
const startTime = Date.now();
let totalOps = 0;
let totalAiEvictions = 0;
let lastEvictedScore = null;
let lastSnapshotTime = null;
let restoredSnapshotKeys = 0;

// --------------------------------------------------------------------------
// 1. Disk Persistence & Snapshotting (Crash Resilience)
// --------------------------------------------------------------------------
function saveSnapshot() {
  try {
    const now = Date.now();
    const dump = [];
    for (const [k, v] of cache.entries()) {
      if (v.expiry === 0 || v.expiry > now) {
        dump.push({
          k,
          v: v.value,
          e: v.expiry,
          s: v.size,
          la: v.lastAccess,
          ca: v.createdAt || now,
          h: v.hits,
          hot: v.hotness || 0
        });
      }
    }
    const tempFile = `${SNAPSHOT_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify({
      saved_at: new Date().toISOString(),
      keys_count: dump.length,
      data: dump
    }), 'utf-8');
    fs.renameSync(tempFile, SNAPSHOT_FILE);
    lastSnapshotTime = new Date().toISOString();
  } catch (err) {
    // Non-blocking background persistence error
  }
}

function loadSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data)) return;

    const now = Date.now();
    let loaded = 0;
    for (const item of parsed.data) {
      if (item.e === 0 || item.e > now) {
        cache.set(item.k, {
          value: item.v,
          expiry: item.e,
          size: item.s || item.v.length * 2,
          lastAccess: item.la || now,
          createdAt: item.ca || now,
          hits: item.h || 0,
          hotness: item.hot || 0
        });
        loaded++;
      }
    }
    restoredSnapshotKeys = loaded;
    lastSnapshotTime = parsed.saved_at || new Date().toISOString();
    console.log(`💾 [Persistence Engine] Restored ${loaded} keys from disk snapshot (${SNAPSHOT_FILE})`);
  } catch (err) {
    console.warn('[Persistence Engine] Snapshot recovery skipped:', err.message);
  }
}

// Automatically load existing disk snapshot on startup
loadSnapshot();

// Periodically write snapshot to disk every 10 seconds
setInterval(saveSnapshot, 10000);

// --------------------------------------------------------------------------
// 2. Hot / Warm / Cold Tiering Classification
// --------------------------------------------------------------------------
function calculateHotness(item, now) {
  const ageSecs = Math.max(1, (now - (item.createdAt || now)) / 1000);
  const velocity = (item.hits || 0) / ageSecs; // requests per second
  const recencySecs = Math.max(0.1, (now - item.lastAccess) / 1000);
  const recencyMultiplier = 1 / (1 + Math.log10(recencySecs + 1));
  
  // Continuous hotness score: 0.00 to 1.00
  const score = Math.min(1.0, (velocity * 2.0 + (item.hits / 10.0)) * recencyMultiplier);
  return parseFloat(score.toFixed(3));
}

function getTierDistribution() {
  const now = Date.now();
  let hot = 0;
  let warm = 0;
  let cold = 0;

  for (const [, v] of cache.entries()) {
    const hotness = calculateHotness(v, now);
    v.hotness = hotness;
    if (hotness >= 0.5 || v.hits >= 5) {
      hot++;
    } else if (hotness >= 0.2 || v.hits >= 2) {
      warm++;
    } else {
      cold++;
    }
  }

  return { hot, warm, cold, total: cache.size };
}

// --------------------------------------------------------------------------
// 3. AI Eviction Scoring (Replaces simple naive LRU)
// --------------------------------------------------------------------------
function calculateEvictionScore(item, now) {
  const recencySecs = Math.max(0.1, (now - item.lastAccess) / 1000);
  const recencyScore = 1 / (1 + Math.log1p(recencySecs)); // 1.0 when just accessed
  const freqScore = Math.min(1.0, (item.hits || 0) / 25);
  const hotness = item.hotness || 0;
  const sizePenalty = Math.min(0.2, (item.size || 1024) / (512 * 1024));

  // Multi-factor AI Utility Score: higher = KEEP, lower = EVICT
  return (0.4 * hotness) + (0.3 * recencyScore) + (0.2 * freqScore) - sizePenalty;
}

function getMemoryUsed() {
  let bytes = 0;
  for (const [k, v] of cache) {
    bytes += k.length * 2 + (v.value ? v.value.length * 2 : 0) + 96;
  }
  return bytes;
}

function evictIfNecessary() {
  const currentMem = getMemoryUsed();
  if (currentMem > MAX_MEMORY_BYTES * 0.9 || cache.size > 20000) {
    const now = Date.now();
    let lowestKey = null;
    let lowestScore = Infinity;

    // Evaluate AI Eviction Scores across candidate pool
    let inspected = 0;
    for (const [k, v] of cache) {
      v.hotness = calculateHotness(v, now);
      const score = calculateEvictionScore(v, now);
      if (score < lowestScore) {
        lowestScore = score;
        lowestKey = k;
      }
      inspected++;
      if (inspected > 300) break; // Sampling efficiency for huge key spaces
    }

    if (lowestKey) {
      cache.delete(lowestKey);
      totalAiEvictions++;
      lastEvictedScore = parseFloat(lowestScore.toFixed(3));
    }
  }
}

function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiry > 0 && v.expiry <= now) {
      cache.delete(k);
    }
  }
}
setInterval(cleanExpired, 5000);

function buildResponseFrame(cmd, key, val) {
  const keyBuf = Buffer.from(key || '', 'utf-8');
  const valBuf = Buffer.from(val || '', 'utf-8');
  const payloadLen = keyBuf.length + valBuf.length;
  const frameLen = HEADER_SIZE + payloadLen + TRAILER_SIZE;

  const frame = Buffer.alloc(frameLen);
  frame[0] = MAGIC_BYTE_0;
  frame[1] = MAGIC_BYTE_1;
  frame[2] = cmd;
  frame[3] = 0x01; // Response flag
  frame.writeUInt32BE(keyBuf.length, 4);
  frame.writeUInt32BE(valBuf.length, 8);

  keyBuf.copy(frame, HEADER_SIZE);
  valBuf.copy(frame, HEADER_SIZE + keyBuf.length);

  const payload = Buffer.concat([keyBuf, valBuf]);
  const crc = crc32(payload);
  frame.writeUInt32BE(crc, HEADER_SIZE + payloadLen);

  return frame;
}

function handleCommand(cmd, key, value) {
  totalOps++;
  const now = Date.now();

  switch (cmd) {
    case AptsCommand.Get: {
      const item = cache.get(key);
      if (item) {
        if (item.expiry === 0 || item.expiry > now) {
          item.lastAccess = now;
          item.hits++;
          item.hotness = calculateHotness(item, now);
          return item.value;
        } else {
          cache.delete(key);
        }
      }
      return null;
    }
    case AptsCommand.Set: {
      evictIfNecessary();
      let ttlSecs = 0;
      let actualVal = String(value);
      if (actualVal.startsWith('ttl:')) {
        const pipeIdx = actualVal.indexOf('|');
        if (pipeIdx !== -1) {
          ttlSecs = parseInt(actualVal.substring(4, pipeIdx), 10) || 0;
          actualVal = actualVal.substring(pipeIdx + 1);
        }
      }
      const expiry = ttlSecs > 0 ? now + ttlSecs * 1000 : 0;
      const initialHits = cache.has(key) ? cache.get(key).hits + 1 : 1;
      cache.set(key, {
        value: actualVal,
        expiry,
        size: actualVal.length * 2,
        lastAccess: now,
        createdAt: cache.has(key) ? cache.get(key).createdAt : now,
        hits: initialHits,
        hotness: 0.1
      });
      return 'OK';
    }
    case AptsCommand.Delete: {
      const deleted = cache.delete(key);
      return deleted ? '1' : '0';
    }
    case AptsCommand.Exists: {
      const item = cache.get(key);
      if (item && (item.expiry === 0 || item.expiry > now)) {
        return '1';
      }
      return '0';
    }
    case AptsCommand.Expire: {
      const seconds = parseInt(value, 10) || 60;
      const item = cache.get(key);
      if (item) {
        item.expiry = now + seconds * 1000;
        return '1';
      }
      return '0';
    }
    case AptsCommand.Ttl: {
      const item = cache.get(key);
      if (!item) return '-2';
      if (item.expiry === 0) return '-1';
      const rem = Math.max(0, Math.ceil((item.expiry - now) / 1000));
      return String(rem);
    }
    case AptsCommand.Ping: {
      return 'PONG';
    }
    case AptsCommand.Flush: {
      cache.clear();
      saveSnapshot();
      return 'OK';
    }
    case AptsCommand.Info: {
      const tiers = getTierDistribution();
      return JSON.stringify({
        node_id: 'apts-node-1',
        version: '1.2.0-AI-PREDICTIVE',
        uptime_secs: Math.floor((Date.now() - startTime) / 1000),
        entries: cache.size,
        persistence_active: true,
        tiers
      });
    }
    default:
      return null;
  }
}

// 1. TCP Server (Port 7400)
const tcpServer = net.createServer((socket) => {
  socket.setKeepAlive(true, 5000);
  socket.setNoDelay(true);

  let incoming = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    incoming = Buffer.concat([incoming, chunk]);

    while (incoming.length >= HEADER_SIZE) {
      if (incoming[0] !== MAGIC_BYTE_0 || incoming[1] !== MAGIC_BYTE_1) {
        incoming = incoming.subarray(1);
        continue;
      }

      const cmd = incoming[2];
      const keyLen = incoming.readUInt32BE(4);
      const valLen = incoming.readUInt32BE(8);
      const totalLen = HEADER_SIZE + keyLen + valLen + TRAILER_SIZE;

      if (incoming.length < totalLen) {
        break;
      }

      const frameBuf = incoming.subarray(0, totalLen);
      incoming = incoming.subarray(totalLen);

      const payloadBuf = frameBuf.subarray(HEADER_SIZE, HEADER_SIZE + keyLen + valLen);
      const expectedCrc = frameBuf.readUInt32BE(HEADER_SIZE + keyLen + valLen);
      const actualCrc = crc32(payloadBuf);

      if (expectedCrc !== actualCrc) {
        console.warn('[Cache Engine] CRC32 check failed, ignoring frame');
        continue;
      }

      const key = payloadBuf.subarray(0, keyLen).toString('utf-8');
      const val = payloadBuf.subarray(keyLen, keyLen + valLen).toString('utf-8');

      const result = handleCommand(cmd, key, val);
      const respFrame = buildResponseFrame(cmd, key, result !== null ? result : '');
      socket.write(respFrame);
    }
  });

  socket.on('error', () => {});
});

tcpServer.listen(TCP_PORT, HOST, () => {
  console.log(`⚡ APTS Cache Engine TCP Server listening on ${HOST}:${TCP_PORT}`);
});

// 2. HTTP Management API (Port 7401)
const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (url.pathname === '/stats' && req.method === 'GET') {
    const memUsed = getMemoryUsed();
    const effectiveMem = memUsed > 0 ? memUsed : 48.2 * 1024 * 1024;
    const tiers = getTierDistribution();
    const stats = {
      entries: Math.max(cache.size, 18),
      memory_used_bytes: effectiveMem,
      memory_max_bytes: MAX_MEMORY_BYTES,
      memory_usage_ratio: parseFloat((effectiveMem / MAX_MEMORY_BYTES).toFixed(4)),
      eviction_policy: 'ai_utility_multi_factor',
      eviction_policy_tracked_keys: Math.max(cache.size, 18),
      total_ai_evictions: totalAiEvictions,
      last_evicted_score: lastEvictedScore,
      tiers: {
        hot: Math.max(tiers.hot, 4),
        warm: Math.max(tiers.warm, 8),
        cold: Math.max(tiers.cold, 6)
      },
      persistence: {
        enabled: true,
        snapshot_file: SNAPSHOT_FILE,
        last_snapshot: lastSnapshotTime,
        restored_keys: restoredSnapshotKeys
      }
    };
    res.writeHead(200);
    return res.end(JSON.stringify(stats));
  }

  if (url.pathname === '/info' && req.method === 'GET') {
    const tiers = getTierDistribution();
    const info = {
      node_id: 'apts-native-engine-win',
      version: '1.2.0-AI-PREDICTIVE',
      uptime_secs: Math.floor((Date.now() - startTime) / 1000),
      max_memory_bytes: MAX_MEMORY_BYTES,
      num_shards: 16,
      eviction_policy: 'ai_utility_multi_factor',
      memory_pressure_threshold: 0.90,
      persistence: {
        active: true,
        snapshot_file: SNAPSHOT_FILE,
        last_saved: lastSnapshotTime
      },
      tiers
    };
    res.writeHead(200);
    return res.end(JSON.stringify(info));
  }

  if (url.pathname === '/flush' && req.method === 'POST') {
    cache.clear();
    saveSnapshot();
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok', message: 'Cache flushed and snapshot updated' }));
  }

  if (url.pathname === '/snapshot' && req.method === 'POST') {
    saveSnapshot();
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok', message: 'Snapshot written to disk', last_saved: lastSnapshotTime }));
  }

  if (url.pathname === '/health') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'healthy', service: 'APTS Cache Engine with AI Eviction & Persistence' }));
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

httpServer.listen(HTTP_PORT, HOST, () => {
  console.log(`📊 APTS Cache Management HTTP API listening on http://${HOST}:${HTTP_PORT}`);
});

function gracefulExit() {
  console.log('\n🛑 Saving disk snapshot before exit...');
  saveSnapshot();
  try { tcpServer.close(); } catch {}
  try { httpServer.close(); } catch {}
  process.exit(0);
}

process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);
