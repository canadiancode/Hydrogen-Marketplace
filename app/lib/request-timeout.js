/**
 * Request Timeout Utility
 * 
 * Adds timeout protection to prevent hanging requests
 * Critical for production scale to prevent resource exhaustion
 */

/**
 * Creates an AbortSignal that times out after specified duration
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {AbortSignal} - Signal that aborts after timeout
 */
export function createTimeoutSignal(timeoutMs = 30000) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    return AbortSignal.timeout(timeoutMs);
  }
  
  // Fallback for environments without AbortSignal.timeout
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

/**
 * Wraps a request with timeout protection
 * @param {Request} request - Original request
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Request} - Request with timeout signal
 */
export function addRequestTimeout(request, timeoutMs = 30000) {
  const timeoutSignal = createTimeoutSignal(timeoutMs);
  
  // Combine existing signal with timeout signal
  if (request.signal) {
    const combinedController = new AbortController();
    
    // Abort if either signal aborts
    request.signal.addEventListener('abort', () => {
      combinedController.abort();
    });
    
    timeoutSignal.addEventListener('abort', () => {
      combinedController.abort();
    });
    
    return new Request(request, {signal: combinedController.signal});
  }
  
  return new Request(request, {signal: timeoutSignal});
}
