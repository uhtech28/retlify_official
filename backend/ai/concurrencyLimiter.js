/**
 * Concurrency limiters for external AI APIs.
 *
 * External services (OpenRouter, Pollinations) have per-account rate limits.
 * Without this, 500 concurrent users all triggering image generation would
 * fire 500 simultaneous requests and get throttled/banned.
 *
 * This limits in-flight requests globally (per process). Combined with
 * Redis-backed per-IP rate limiting, we get both per-user fairness and
 * per-service protection.
 */

'use strict';

function createLimiter(concurrency) {
  try {
    const pLimit = require('p-limit');
    return pLimit.default ? pLimit.default(concurrency) : pLimit(concurrency);
  } catch {
    const queue = [];
    let active = 0;

    const run = async (fn, resolve, reject) => {
      active++;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        active--;
        if (queue.length > 0) {
          const next = queue.shift();
          run(next.fn, next.resolve, next.reject);
        }
      }
    };

    return (fn) => new Promise((resolve, reject) => {
      if (active < concurrency) {
        run(fn, resolve, reject);
      } else {
        queue.push({ fn, resolve, reject });
      }
    });
  }
}

const limits = {
  openrouter:   createLimiter(parseInt(process.env.AI_OPENROUTER_CONCURRENCY || '10',  10)),
  pollinations: createLimiter(parseInt(process.env.AI_POLLINATIONS_CONCURRENCY || '8', 10)),
  gemini:       createLimiter(parseInt(process.env.AI_GEMINI_CONCURRENCY || '10',      10)),
};

module.exports = limits;
