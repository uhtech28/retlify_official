/**
 * Redis client with graceful fallback.
 *
 * If REDIS_URL is set, connects to Redis (ioredis).
 * If not set OR connection fails, exports null and callers fall back to in-memory.
 *
 * This lets the app run on a single VM without Redis, and seamlessly upgrade
 * to multi-instance deployments (Render/Railway/Fly.io) by setting REDIS_URL.
 */

'use strict';

let client = null;
let connected = false;

if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      reconnectOnError: (err) => err.message.includes('READONLY'),
      retryStrategy: (times) => {
        if (times > 10) return null;
        return Math.min(times * 200, 3000);
      },
    });

    client.on('connect', () => {
      connected = true;
      console.log('[redis] connected');
    });

    client.on('error', (err) => {
      if (connected) {
        console.error('[redis] error:', err.message);
        connected = false;
      }
    });

    client.on('close', () => {
      if (connected) console.log('[redis] connection closed');
      connected = false;
    });
  } catch (err) {
    console.error('[redis] failed to init, falling back to in-memory:', err.message);
    client = null;
  }
} else {
  console.log('[redis] REDIS_URL not set - using in-memory cache (single-instance mode)');
}

function isReady() {
  return client && client.status === 'ready';
}

async function shutdown() {
  if (client) {
    try { await client.quit(); }
    catch (_) { client.disconnect(); }
  }
}

module.exports = { client, isReady, shutdown };
