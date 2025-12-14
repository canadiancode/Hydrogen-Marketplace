/**
 * Rate Limiting Utility
 * 
 * Provides rate limiting for protecting endpoints from abuse.
 * 
 * ⚠️ PRODUCTION WARNING:
 * The default in-memory implementation does NOT work in distributed environments
 * (e.g., Cloudflare Workers with multiple instances). Each instance maintains
 * its own rate limit map, allowing attackers to bypass limits by hitting
 * different instances.
 * 
 * For production, use one of these options:
 * 1. Cloudflare KV (recommended for Cloudflare Workers)
 * 2. Cloudflare Durable Objects (for strict rate limiting)
 * 3. Redis or similar distributed cache
 * 
 * @example Using Cloudflare KV:
 * ```javascript
 * import {rateLimitWithKV} from '~/lib/rate-limit';
 * const allowed = await rateLimitWithKV(env.RATE_LIMIT_KV, key, 5, 15 * 60 * 1000);
 * ```
 */

const rateLimitMap = new Map();

/**
 * Rate limit check
 * @param {string} key - Unique identifier (usually IP address)
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {boolean} - True if request is allowed, false if rate limited
 */
export function rateLimit(key, maxRequests = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, {count: 1, resetTime: now + windowMs});
    return true;
  }
  
  const record = rateLimitMap.get(key);
  
  // Reset if window has passed
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
    return true;
  }
  
  // Check if limit exceeded
  if (record.count >= maxRequests) {
    return false;
  }
  
  record.count++;
  return true;
}

/**
 * Get remaining requests for a key
 * @param {string} key - Unique identifier
 * @returns {number} - Remaining requests or -1 if not found
 */
export function getRemainingRequests(key) {
  const record = rateLimitMap.get(key);
  if (!record) return -1;
  
  const now = Date.now();
  if (now > record.resetTime) {
    return -1; // Window expired
  }
  
  return Math.max(0, record.count);
}

/**
 * Clear rate limit for a key (useful for testing or manual reset)
 * @param {string} key - Unique identifier
 */
export function clearRateLimit(key) {
  rateLimitMap.delete(key);
}

/**
 * Clean up expired entries periodically
 * Run this periodically to prevent memory leaks
 */
export function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}

// Clean up expired entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredEntries, 5 * 60 * 1000);
}

/**
 * Rate limiting using Cloudflare KV (for production)
 * 
 * This implementation uses Cloudflare KV for distributed rate limiting
 * that works across all worker instances.
 * 
 * Setup:
 * 1. Create a KV namespace in Cloudflare dashboard
 * 2. Bind it to your worker: wrangler.toml -> [[kv_namespaces]] -> binding = "RATE_LIMIT_KV"
 * 3. Pass env.RATE_LIMIT_KV to this function
 * 
 * @param {KVNamespace} kvNamespace - Cloudflare KV namespace
 * @param {string} key - Unique identifier (usually IP address)
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<boolean>} - True if request is allowed, false if rate limited
 */
export async function rateLimitWithKV(kvNamespace, key, maxRequests = 5, windowMs = 15 * 60 * 1000) {
  if (!kvNamespace) {
    // Fallback to in-memory if KV not available
    console.warn('KV namespace not provided, falling back to in-memory rate limiting');
    return rateLimit(key, maxRequests, windowMs);
  }
  
  const now = Date.now();
  const kvKey = `rate_limit:${key}`;
  
  try {
    // Get current record from KV
    const recordStr = await kvNamespace.get(kvKey);
    
    if (!recordStr) {
      // No record exists, create new one
      const record = {count: 1, resetTime: now + windowMs};
      await kvNamespace.put(kvKey, JSON.stringify(record), {
        expirationTtl: Math.ceil(windowMs / 1000), // KV uses seconds
      });
      return true;
    }
    
    const record = JSON.parse(recordStr);
    
    // Reset if window has passed
    if (now > record.resetTime) {
      const newRecord = {count: 1, resetTime: now + windowMs};
      await kvNamespace.put(kvKey, JSON.stringify(newRecord), {
        expirationTtl: Math.ceil(windowMs / 1000),
      });
      return true;
    }
    
    // Check if limit exceeded
    if (record.count >= maxRequests) {
      return false;
    }
    
    // Increment count
    record.count++;
    await kvNamespace.put(kvKey, JSON.stringify(record), {
      expirationTtl: Math.ceil((record.resetTime - now) / 1000),
    });
    
    return true;
  } catch (error) {
    // If KV fails, fall back to in-memory (better than blocking all requests)
    console.error('KV rate limit error, falling back to in-memory:', error);
    return rateLimit(key, maxRequests, windowMs);
  }
}
