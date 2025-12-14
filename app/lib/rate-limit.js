/**
 * Rate Limiting Utility
 * 
 * Simple in-memory rate limiting for protecting endpoints from abuse.
 * For production, consider using a distributed cache like Redis.
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
