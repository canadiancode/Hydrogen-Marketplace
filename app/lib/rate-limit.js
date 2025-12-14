/**
 * Rate Limiting Utility
 * 
 * Simple in-memory rate limiter for protecting endpoints from abuse.
 * 
 * ⚠️ PRODUCTION WARNING: This implementation uses in-memory storage which
 * does NOT work in distributed environments like Cloudflare Workers.
 * 
 * For production, you MUST use one of these distributed solutions:
 * 1. Cloudflare KV (recommended for Cloudflare Workers)
 * 2. Cloudflare Durable Objects (for strict rate limiting)
 * 3. Redis (if using a different hosting platform)
 * 
 * Example Cloudflare KV implementation:
 * ```javascript
 * async function checkRateLimitKV(kvNamespace, identifier, maxRequests, windowMs) {
 *   const key = `rate_limit:${identifier}`;
 *   const data = await kvNamespace.get(key, 'json');
 *   const now = Date.now();
 *   
 *   if (!data || data.expiresAt < now) {
 *     await kvNamespace.put(key, JSON.stringify({
 *       count: 1,
 *       expiresAt: now + windowMs,
 *       resetAt: now + windowMs,
 *     }), { expirationTtl: Math.ceil(windowMs / 1000) });
 *     return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
 *   }
 *   
 *   if (data.count >= maxRequests) {
 *     return { allowed: false, remaining: 0, resetAt: data.expiresAt };
 *   }
 *   
 *   data.count += 1;
 *   await kvNamespace.put(key, JSON.stringify(data), { expirationTtl: Math.ceil((data.expiresAt - now) / 1000) });
 *   return { allowed: true, remaining: maxRequests - data.count, resetAt: data.expiresAt };
 * }
 * ```
 */

// In-memory store for rate limit data
// ⚠️ WARNING: This only works in single-instance environments
// In production with Cloudflare Workers, this will NOT work correctly
// across multiple worker instances. Use Cloudflare KV or Durable Objects instead.
const rateLimitStore = new Map();

// Track last cleanup time to avoid cleaning too frequently
let lastCleanup = 0;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Cleans up expired entries from the rate limit store
 * Should be called periodically to prevent memory leaks
 * Note: In Cloudflare Workers, we can't use setInterval, so cleanup happens lazily
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (data.expiresAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Checks if a request should be rate limited
 * 
 * @param {string} identifier - Unique identifier (e.g., IP address, user email)
 * @param {number} maxRequests - Maximum number of requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
export async function checkRateLimit(identifier, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  
  // Lazy cleanup: clean up expired entries periodically (but not on every request)
  if (now - lastCleanup > CLEANUP_INTERVAL) {
    cleanupExpiredEntries();
    lastCleanup = now;
  }
  
  const key = identifier;
  const data = rateLimitStore.get(key);

  if (!data || data.expiresAt < now) {
    // Create new rate limit entry
    const newData = {
      count: 1,
      expiresAt: now + windowMs,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, newData);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: newData.resetAt,
    };
  }

  // Increment count
  data.count += 1;

  if (data.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: data.expiresAt,
    };
  }

  rateLimitStore.set(key, data);
  return {
    allowed: true,
    remaining: maxRequests - data.count,
    resetAt: data.expiresAt,
  };
}

/**
 * Rate limit middleware for route actions
 * 
 * @param {Request} request - The incoming request
 * @param {string} identifier - Unique identifier (IP or user email)
 * @param {object} options - Rate limit options
 * @param {number} options.maxRequests - Max requests per window (default: 10)
 * @param {number} options.windowMs - Time window in ms (default: 60000 = 1 minute)
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number} | null>}
 */
export async function rateLimitMiddleware(
  request,
  identifier,
  options = {}
) {
  const {maxRequests = 10, windowMs = 60000} = options;
  return await checkRateLimit(identifier, maxRequests, windowMs);
}

/**
 * Simple synchronous-style rate limit function for backward compatibility
 * Returns true if allowed, false if rate limited
 * 
 * @param {string} identifier - Unique identifier (e.g., IP address)
 * @param {number} maxRequests - Maximum number of requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<boolean>} - true if allowed, false if rate limited
 */
export async function rateLimit(identifier, maxRequests = 10, windowMs = 60000) {
  const result = await checkRateLimit(identifier, maxRequests, windowMs);
  return result.allowed;
}
