/**
 * Shopify Webhook Utilities
 * 
 * Provides secure webhook verification and processing utilities for Shopify webhooks.
 * Uses HMAC SHA-256 signature verification to ensure webhooks are authentic.
 */

import {constantTimeEquals} from '~/lib/auth-helpers';

// Maximum webhook payload size (5MB - Shopify's limit is typically 256KB, but we allow buffer)
const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;

/**
 * Verifies Shopify webhook signature using HMAC SHA-256
 * 
 * Shopify sends webhooks with a X-Shopify-Hmac-SHA256 header containing
 * a base64-encoded HMAC SHA-256 signature of the request body.
 * 
 * SECURITY: Uses constant-time comparison to prevent timing attacks
 * 
 * @param {string} body - The request body as string
 * @param {string} signature - The X-Shopify-Hmac-SHA256 header value
 * @param {string} webhookSecret - Shopify webhook secret (from Shopify admin)
 * @returns {Promise<boolean>} - True if signature is valid
 */
export async function verifyShopifyWebhookSignature(body, signature, webhookSecret) {
  if (!webhookSecret) {
    console.error('SHOPIFY_WEBHOOK_SECRET is not configured');
    return false;
  }

  if (!signature) {
    console.error('Missing X-Shopify-Hmac-SHA256 header');
    return false;
  }

  if (!body || typeof body !== 'string') {
    console.error('Invalid body for signature verification');
    return false;
  }

  try {
    // Verify signature using Web Crypto API
    const encoder = new TextEncoder();
    const keyData = encoder.encode(webhookSecret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      {name: 'HMAC', hash: 'SHA-256'},
      false,
      ['sign']
    );

    const signatureData = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(body)
    );

    // Convert signature to base64
    const calculatedSignature = btoa(
      String.fromCharCode(...new Uint8Array(signatureData))
    );

    // Constant-time comparison to prevent timing attacks
    return constantTimeEquals(signature, calculatedSignature);
  } catch (error) {
    console.error('Error verifying Shopify webhook signature:', error);
    return false;
  }
}

/**
 * Verifies Shopify webhook from request
 * 
 * @param {Request} request - The incoming webhook request
 * @param {string} webhookSecret - Shopify webhook secret
 * @returns {Promise<{valid: boolean, body?: string, error?: string}>}
 */
export async function verifyShopifyWebhook(request, webhookSecret) {
  const signature = request.headers.get('X-Shopify-Hmac-SHA256');
  
  // Check Content-Length header for size limit
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (isNaN(size) || size > MAX_PAYLOAD_SIZE) {
      return {valid: false, error: 'Payload too large'};
    }
  }

  try {
    // Read body once
    const body = await request.text();
    
    // Check actual body size
    if (body.length > MAX_PAYLOAD_SIZE) {
      return {valid: false, error: 'Payload too large'};
    }

    const isValid = await verifyShopifyWebhookSignature(body, signature, webhookSecret);
    
    if (!isValid) {
      return {valid: false, error: 'Invalid signature'};
    }

    return {valid: true, body};
  } catch (error) {
    console.error('Error verifying Shopify webhook:', error);
    return {valid: false, error: 'Verification failed'};
  }
}

/**
 * Parses webhook payload from request body
 * 
 * @param {string} body - The request body as string
 * @returns {Promise<object>} - Parsed JSON payload
 */
export function parseWebhookPayload(body) {
  if (!body || typeof body !== 'string') {
    throw new Error('Invalid body');
  }

  try {
    const parsed = JSON.parse(body);
    
    // Validate it's an object
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Payload must be an object');
    }
    
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON payload');
    }
    throw error;
  }
}

/**
 * Validates required environment variables for webhook processing
 * 
 * @param {object} env - Environment variables
 * @returns {boolean} - True if all required vars are present
 */
export function validateWebhookEnv(env) {
  return !!(
    env.SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.SHOPIFY_WEBHOOK_SECRET
  );
}

/**
 * Validates order data structure
 * 
 * @param {object} orderData - Parsed order data
 * @returns {{valid: boolean, error?: string}}
 */
export function validateOrderData(orderData) {
  if (!orderData || typeof orderData !== 'object') {
    return {valid: false, error: 'Order data must be an object'};
  }

  if (!orderData.id) {
    return {valid: false, error: 'Missing order ID'};
  }

  if (!Array.isArray(orderData.line_items)) {
    return {valid: false, error: 'line_items must be an array'};
  }

  // Validate numeric fields
  const numericFields = ['total_price', 'subtotal_price', 'total_tax'];
  for (const field of numericFields) {
    if (orderData[field] !== undefined && orderData[field] !== null) {
      const value = parseFloat(orderData[field]);
      if (isNaN(value) || !isFinite(value) || value < 0) {
        return {valid: false, error: `Invalid ${field} value`};
      }
    }
  }

  return {valid: true};
}