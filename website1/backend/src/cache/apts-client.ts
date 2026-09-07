/**
 * ============================================================================
 * APTS CACHE ENGINE: HIGH-PERFORMANCE TCP & HTTP CLIENT
 * ============================================================================
 * Connects directly to the Rust APTS Cache Engine:
 * - Port 7400: Custom Binary TCP Protocol (sub-millisecond data path)
 * - Port 7401: Axum Management HTTP API (stats, memory pressure, flush, metrics)
 * ============================================================================
 */

import net from 'net';

// APTS Binary Protocol Constants
const MAGIC_BYTE_0 = 0x41; // 'A'
const MAGIC_BYTE_1 = 0x50; // 'P'
const HEADER_SIZE = 12;
const TRAILER_SIZE = 4;

export enum AptsCommand {
  Get = 0x01,
  Set = 0x02,
  Delete = 0x03,
  Exists = 0x04,
  Expire = 0x05,
  Ttl = 0x06,
  MGet = 0x07,
  MSet = 0x08,
  Incr = 0x09,
  Decr = 0x0a,
  Ping = 0x0b,
  Info = 0x0c,
  Flush = 0x0d
}

// Standard IEEE 802.3 CRC32 Lookup Table (matching crc32fast in Rust)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface AptsStats {
  entries: number;
  memory_used_bytes: number;
  memory_max_bytes: number;
  memory_usage_ratio: number;
  eviction_policy: string;
  eviction_policy_tracked_keys: number;
  total_ai_evictions?: number;
  last_evicted_score?: number | null;
  tiers?: { hot: number; warm: number; cold: number; total?: number };
  persistence?: { enabled: boolean; snapshot_file: string; last_snapshot: string; restored_keys: number };
}

export interface AptsInfo {
  node_id: string;
  version: string;
  uptime_secs: number;
  max_memory_bytes: number;
  num_shards: number;
  eviction_policy: string;
  memory_pressure_threshold: number;
}

interface PendingRequest {
  resolve: (val: string | null) => void;
  reject: (err: Error) => void;
  cmd: AptsCommand;
  key: string;
  timer: NodeJS.Timeout;
}

export class AptsCacheClient {
  private tcpHost: string;
  private tcpPort: number;
  private httpPort: number;
  private socket: net.Socket | null = null;
  private isConnected = false;
  private incomingBuffer: Buffer = Buffer.alloc(0);
  private pendingQueue: PendingRequest[] = [];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private fallbackMemory: Map<string, { value: string; expiry: number }> = new Map();

  constructor(host = '127.0.0.1', tcpPort = 7400, httpPort = 7401) {
    this.tcpHost = host;
    this.tcpPort = tcpPort;
    this.httpPort = httpPort;
    this.connect();
  }

  public connect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.socket = new net.Socket();
    this.socket.setKeepAlive(true, 5000);
    this.socket.setNoDelay(true);

    this.socket.connect(this.tcpPort, this.tcpHost, () => {
      this.isConnected = true;
      console.log(`[APTS Cache] Connected to Rust APTS Engine on ${this.tcpHost}:${this.tcpPort} (TCP)`);
      if (this.reconnectTimer) {
        clearInterval(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.socket.on('data', (chunk: Buffer) => {
      this.handleIncomingData(chunk);
    });

    this.socket.on('error', (_err) => {
      // Avoid crash on connection refusal during startup
      this.isConnected = false;
    });

    this.socket.on('close', () => {
      this.isConnected = false;
      this.rejectPendingRequests(new Error('APTS connection closed'));
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, 3000);
  }

  private rejectPendingRequests(err: Error) {
    while (this.pendingQueue.length > 0) {
      const req = this.pendingQueue.shift();
      if (req) {
        clearTimeout(req.timer);
        req.reject(err);
      }
    }
  }

  private handleIncomingData(chunk: Buffer) {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk]);

    while (this.incomingBuffer.length >= HEADER_SIZE) {
      // Verify Magic bytes
      if (
        this.incomingBuffer[0] !== MAGIC_BYTE_0 ||
        this.incomingBuffer[1] !== MAGIC_BYTE_1
      ) {
        // Skip 1 byte to find next valid frame
        this.incomingBuffer = this.incomingBuffer.subarray(1);
        continue;
      }

      const keyLen = this.incomingBuffer.readUInt32BE(4);
      const valLen = this.incomingBuffer.readUInt32BE(8);
      const totalFrameLen = HEADER_SIZE + keyLen + valLen + TRAILER_SIZE;

      if (this.incomingBuffer.length < totalFrameLen) {
        // Incomplete frame, wait for more chunks
        break;
      }

      const frameBuf = this.incomingBuffer.subarray(0, totalFrameLen);
      this.incomingBuffer = this.incomingBuffer.subarray(totalFrameLen);

      // Verify CRC32
      const payloadBuf = frameBuf.subarray(HEADER_SIZE, HEADER_SIZE + keyLen + valLen);
      const expectedCrc = frameBuf.readUInt32BE(HEADER_SIZE + keyLen + valLen);
      const actualCrc = crc32(payloadBuf);

      if (expectedCrc !== actualCrc) {
        console.warn('[APTS Cache] Protocol CRC32 mismatch, discarding frame');
        continue;
      }

      const valBuf = payloadBuf.subarray(keyLen, keyLen + valLen);
      const resultStr = valBuf.length > 0 ? valBuf.toString('utf-8') : null;

      const req = this.pendingQueue.shift();
      if (req) {
        clearTimeout(req.timer);
        req.resolve(resultStr);
      }
    }
  }

  private sendFrame(cmd: AptsCommand, key: string, value = ''): Promise<string | null> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.socket) {
        // Fallback to local memory if engine is offline
        return this.fallbackHandle(cmd, key, value, resolve);
      }

      const keyBuf = Buffer.from(key, 'utf-8');
      const valBuf = Buffer.from(value, 'utf-8');
      const payloadLen = keyBuf.length + valBuf.length;
      const frameLen = HEADER_SIZE + payloadLen + TRAILER_SIZE;

      const frame = Buffer.alloc(frameLen);
      frame[0] = MAGIC_BYTE_0;
      frame[1] = MAGIC_BYTE_1;
      frame[2] = cmd;
      frame[3] = 0x00; // Request flag
      frame.writeUInt32BE(keyBuf.length, 4);
      frame.writeUInt32BE(valBuf.length, 8);

      keyBuf.copy(frame, HEADER_SIZE);
      valBuf.copy(frame, HEADER_SIZE + keyBuf.length);

      const payload = Buffer.concat([keyBuf, valBuf]);
      const crc = crc32(payload);
      frame.writeUInt32BE(crc, HEADER_SIZE + payloadLen);

      const timer = setTimeout(() => {
        const idx = this.pendingQueue.findIndex(p => p.timer === timer);
        if (idx !== -1) {
          this.pendingQueue.splice(idx, 1);
        }
        // Graceful fallback to memory on timeout
        this.fallbackHandle(cmd, key, value, resolve);
      }, 500);

      this.pendingQueue.push({ resolve, reject, cmd, key, timer });
      this.socket.write(frame);
    });
  }

  private fallbackHandle(
    cmd: AptsCommand,
    key: string,
    value: string,
    resolve: (val: string | null) => void
  ) {
    const now = Date.now();
    if (cmd === AptsCommand.Get) {
      const item = this.fallbackMemory.get(key);
      if (item && (item.expiry === 0 || item.expiry > now)) {
        return resolve(item.value);
      }
      this.fallbackMemory.delete(key);
      return resolve(null);
    } else if (cmd === AptsCommand.Set) {
      let ttlSecs = 0;
      let actualVal = value;
      if (value.startsWith('ttl:')) {
        const pipeIdx = value.indexOf('|');
        if (pipeIdx !== -1) {
          ttlSecs = parseInt(value.substring(4, pipeIdx), 10) || 0;
          actualVal = value.substring(pipeIdx + 1);
        }
      }
      const expiry = ttlSecs > 0 ? now + ttlSecs * 1000 : 0;
      this.fallbackMemory.set(key, { value: actualVal, expiry });
      return resolve('OK');
    } else if (cmd === AptsCommand.Delete) {
      this.fallbackMemory.delete(key);
      return resolve('OK');
    } else if (cmd === AptsCommand.Flush) {
      this.fallbackMemory.clear();
      return resolve('OK');
    } else if (cmd === AptsCommand.Ping) {
      return resolve('pong');
    }
    resolve(null);
  }

  // --- High-Level Cache Operations ---

  public async get(key: string): Promise<string | null> {
    return this.sendFrame(AptsCommand.Get, key);
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    const payload = ttlSeconds && ttlSeconds > 0 ? `ttl:${ttlSeconds}|${value}` : value;
    const res = await this.sendFrame(AptsCommand.Set, key, payload);
    return res === 'OK';
  }

  public async delete(key: string): Promise<boolean> {
    const res = await this.sendFrame(AptsCommand.Delete, key);
    return res === 'OK';
  }

  public async ping(): Promise<boolean> {
    const res = await this.sendFrame(AptsCommand.Ping, 'ping');
    return res === 'pong';
  }

  public async flush(): Promise<boolean> {
    const res = await this.sendFrame(AptsCommand.Flush, 'flush');
    this.fallbackMemory.clear();
    // Also call Axum flush HTTP endpoint
    await this.flushHttp().catch(() => {});
    return res === 'OK';
  }

  // --- Axum Management HTTP API (:7401) ---

  public async getStats(): Promise<AptsStats | null> {
    try {
      const res = await fetch(`http://${this.tcpHost}:${this.httpPort}/stats`, {
        signal: AbortSignal.timeout(1000)
      });
      if (res.ok) {
        return (await res.json()) as AptsStats;
      }
    } catch {
      // Rust engine offline or unreachable
    }

    // Return fallback stats
    return {
      entries: this.fallbackMemory.size,
      memory_used_bytes: this.fallbackMemory.size * 512,
      memory_max_bytes: 128 * 1024 * 1024,
      memory_usage_ratio: (this.fallbackMemory.size * 512) / (128 * 1024 * 1024),
      eviction_policy: 'lru',
      eviction_policy_tracked_keys: this.fallbackMemory.size
    };
  }

  public async getInfo(): Promise<AptsInfo | null> {
    try {
      const res = await fetch(`http://${this.tcpHost}:${this.httpPort}/info`, {
        signal: AbortSignal.timeout(1000)
      });
      if (res.ok) {
        return (await res.json()) as AptsInfo;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  public async flushHttp(): Promise<boolean> {
    try {
      const res = await fetch(`http://${this.tcpHost}:${this.httpPort}/flush`, {
        method: 'POST',
        signal: AbortSignal.timeout(1500)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public isEngineConnected(): boolean {
    return this.isConnected;
  }
}

export const aptsCache = new AptsCacheClient();
