/**
 * Retlify AI Cache Service
 *
 * Redis-backed when REDIS_URL is set (production / multi-instance).
 * Falls back to in-memory LRU+TTL when Redis is unavailable (dev / single VM).
 *
 * Interface is identical either way:
 *   await cache.set('key', value, 60);   // 60s TTL
 *   const v = await cache.get('key');    // null if missing/expired
 *   await cache.del('key');
 *   cache.stats();                       // { hits, misses, size, backend }
 */

'use strict';

const { client: redis, isReady } = require('../config/redis');

const DEFAULT_TTL_SECONDS = 300;
const MAX_ENTRIES         = 500;
const NAMESPACE_SEP       = ':';
const KEY_PREFIX          = 'retlify:cache:';

const _store = new Map();
let _hits   = 0;
let _misses = 0;

async function get(key) {
  if (isReady()) {
    try {
      const raw = await redis.get(KEY_PREFIX + key);
      if (raw == null) { _misses++; return null; }
      _hits++;
      return JSON.parse(raw);
    } catch (err) {
      console.error('[cache] redis get failed, falling back:', err.message);
    }
  }

  const entry = _store.get(key);
  if (!entry) { _misses++; return null; }
  if (Date.now() > entry.expiresAt) {
    _store.delete(key);
    _misses++;
    return null;
  }
  _hits++;
  return entry.value;
}

async function set(key, value, ttlSeconds) {
  if (ttlSeconds == null) ttlSeconds = DEFAULT_TTL_SECONDS;

  if (isReady()) {
    try {
      await redis.set(KEY_PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds);
      return;
    } catch (err) {
      console.error('[cache] redis set failed, falling back:', err.message);
    }
  }

  if (_store.size >= MAX_ENTRIES) {
    const firstKey = _store.keys().next().value;
    _store.delete(firstKey);
  }
  _store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
    createdAt: Date.now(),
  });
}

async function del(key) {
  if (isReady()) {
    try {
      await redis.del(KEY_PREFIX + key);
      return;
    } catch (err) {
      console.error('[cache] redis del failed:', err.message);
    }
  }
  _store.delete(key);
}

async function invalidateNamespace(namespace) {
  const prefix = namespace + NAMESPACE_SEP;

  if (isReady()) {
    try {
      const stream = redis.scanStream({ match: KEY_PREFIX + prefix + '*', count: 100 });
      const pipeline = redis.pipeline();
      for await (const keys of stream) {
        for (const k of keys) pipeline.del(k);
      }
      await pipeline.exec();
      return;
    } catch (err) {
      console.error('[cache] redis invalidate failed:', err.message);
    }
  }

  for (const key of _store.keys()) {
    if (key.startsWith(prefix)) _store.delete(key);
  }
}

function cacheKey(...parts) {
  return parts
    .map(p => String(p || '').toLowerCase().trim().replace(/\s+/g, ' '))
    .join(NAMESPACE_SEP);
}

function withCache(fn, keyFn, ttlSeconds) {
  if (ttlSeconds == null) ttlSeconds = DEFAULT_TTL_SECONDS;
  return async function (...args) {
    const key = keyFn(args);
    const cached = await get(key);
    if (cached !== null) return cached;
    const result = await fn(...args);
    await set(key, result, ttlSeconds);
    return result;
  };
}

function purgeExpired() {
  if (isReady()) return 0;
  const now = Date.now();
  let purged = 0;
  for (const [key, entry] of _store.entries()) {
    if (now > entry.expiresAt) { _store.delete(key); purged++; }
  }
  return purged;
}

function stats() {
  return {
    backend:    isReady() ? 'redis' : 'memory',
    size:       _store.size,
    hits:       _hits,
    misses:     _misses,
    hitRate:    _hits + _misses > 0
      ? Math.round((_hits / (_hits + _misses)) * 100) + '%'
      : 'N/A',
    maxEntries: MAX_ENTRIES,
  };
}

setInterval(purgeExpired, 5 * 60 * 1000).unref && setInterval(purgeExpired, 5 * 60 * 1000).unref();

const TTL = {
  SUGGESTIONS:     60,
  RECOMMENDATIONS: 300,
  TRENDS:          600,
  INSIGHTS:        900,
  DESCRIPTION:     3600,
  TRANSLATION:     86400,
};

module.exports = { get, set, del, invalidateNamespace, cacheKey, withCache, stats, TTL };
