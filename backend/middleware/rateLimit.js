/**
 * Rate limiters with Redis store when available, memory store otherwise.
 *
 * In multi-instance deployments (Render/Railway/Fly.io), memory-store rate
 * limiters are per-process - users can just retry on another instance.
 * Redis store gives coherent limits across all instances.
 */

'use strict';

const rateLimit = require('express-rate-limit');
const { client: redis } = require('../config/redis');

function makeStore() {
  if (!process.env.REDIS_URL) return undefined;
  try {
    const RedisStore = require('rate-limit-redis').default || require('rate-limit-redis');
    return new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: 'retlify:rl:',
    });
  } catch (err) {
    console.error('[rateLimit] failed to init Redis store, using memory:', err.message);
    return undefined;
  }
}

function make(opts) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(),
    ...opts,
  });
}

const authLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many auth attempts. Try again later.' },
});

const contactLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many requests.' },
});

const aiLimiter = make({
  windowMs: 60 * 1000,
  max: 60,
  message: { message: 'AI rate limit exceeded. Slow down and retry.' },
});

const globalLimiter = make({
  windowMs: 60 * 1000,
  max: 300,
  message: { message: 'Global rate limit exceeded.' },
});

module.exports = { authLimiter, contactLimiter, aiLimiter, globalLimiter };
