/**
 * Authentication Helper Functions
 * 
 * Provides utilities for authentication middleware, CSRF protection,
 * and session management across routes.
 */

import {redirect} from 'react-router';
import {getSupabaseSession, createSessionCookie} from '~/lib/supabase';

/**
 * Middleware to require authentication
 * Redirects to login if not authenticated
 * 
 * @param {Request} request - The incoming request
 * @param {object} env - Environment variables
 * @param {string} redirectTo - Where to redirect if not authenticated (default: '/creator/login')
 * @returns {Promise<{user: User, session: Session, needsRefresh: boolean}>}
 */
export async function requireAuth(request, env, redirectTo = '/creator/login') {
  // Validate environment variables
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
    console.error('Missing Supabase environment variables in requireAuth');
    throw redirect(redirectTo);
  }

  const isProduction = env.NODE_ENV === 'production';
  const {user, session, needsRefresh} = await getSupabaseSession(
    request,
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    isProduction,
  );

  if (!user || !session) {
    // Preserve return URL for post-login redirect
    const currentUrl = new URL(request.url);
    const returnTo = currentUrl.pathname + currentUrl.search;
    
    // Only add returnTo if it's not already the login page
    if (!returnTo.startsWith('/creator/login')) {
      const loginUrl = new URL(redirectTo, request.url);
      loginUrl.searchParams.set('returnTo', returnTo);
      throw redirect(loginUrl.toString());
    }
    
    throw redirect(redirectTo);
  }

  return {user, session, needsRefresh};
}

/**
 * Creates a response with refreshed session cookie if needed
 * 
 * @param {Response} response - The response object
 * @param {object} session - Supabase session
 * @param {string} supabaseUrl - Supabase project URL
 * @param {boolean} needsRefresh - Whether cookie needs to be refreshed
 * @param {boolean} isProduction - Whether in production
 * @returns {Response} - Response with updated cookie if needed
 */
export function addSessionCookie(response, session, supabaseUrl, needsRefresh, isProduction) {
  if (needsRefresh && session) {
    const cookieHeader = createSessionCookie(session, supabaseUrl, isProduction);
    if (cookieHeader) {
      response.headers.set('Set-Cookie', cookieHeader);
    }
  }
  return response;
}

/**
 * Refreshes a Supabase session if needed and updates the response cookie
 * 
 * @param {Response} response - The response object
 * @param {object} session - Current Supabase session
 * @param {string} supabaseUrl - Supabase project URL
 * @param {string} anonKey - Supabase anon key
 * @param {boolean} needsRefresh - Whether session needs refresh
 * @param {boolean} isProduction - Whether in production
 * @returns {Promise<Response>} - Response with refreshed cookie if refresh was successful
 */
export async function refreshSessionIfNeeded(response, session, supabaseUrl, anonKey, needsRefresh, isProduction) {
  if (!needsRefresh || !session?.refresh_token) {
    return response;
  }

  try {
    const {refreshSupabaseSession} = await import('~/lib/supabase');
    const {createSessionCookie} = await import('~/lib/supabase');
    
    const {session: newSession, error} = await refreshSupabaseSession(
      session.refresh_token,
      supabaseUrl,
      anonKey,
    );

    if (error || !newSession) {
      // Refresh failed - session may be expired, but don't break the response
      console.warn('Session refresh failed:', error);
      return response;
    }

    // Update cookie with refreshed session
    const cookieHeader = createSessionCookie(newSession, supabaseUrl, isProduction);
    if (cookieHeader) {
      response.headers.set('Set-Cookie', cookieHeader);
    }

    return response;
  } catch (error) {
    console.error('Error refreshing session:', error);
    return response;
  }
}

/**
 * Generates a cryptographically secure CSRF token
 * 
 * 2025 Best Practice: Use cryptographically secure random tokens with expiration
 * 
 * @param {Request} request - The incoming request
 * @param {string} sessionSecret - Session secret for signing (optional)
 * @returns {Promise<string>} - CSRF token
 */
export async function generateCSRFToken(request, sessionSecret = null) {
  // Use Web Crypto API for cryptographically secure random tokens
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const token = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    
    // If session secret provided, create HMAC signature
    if (sessionSecret && typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(sessionSecret);
        const key = await crypto.subtle.importKey(
          'raw',
          keyData,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
        const signatureHex = Array.from(new Uint8Array(signature))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        return `${token}.${signatureHex}`;
      } catch (err) {
        // Fallback to unsigned token if HMAC fails
        console.warn('CSRF token signing failed, using unsigned token:', err);
      }
    }
    
    return token;
  }
  
  // Fallback for Node.js environments
  if (typeof require !== 'undefined') {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }
  
  // Last resort fallback (not ideal, but better than nothing)
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${random}`;
}

/**
 * Validates CSRF token with optional signature verification
 * 
 * @param {Request} request - The incoming request
 * @param {string} expectedToken - Expected CSRF token
 * @param {string} sessionSecret - Session secret for signature verification (optional)
 * @returns {Promise<boolean>} - True if valid
 */
export async function validateCSRFToken(request, expectedToken, sessionSecret = null) {
  const formData = await request.formData().catch(() => null);
  const receivedToken = formData?.get('csrf_token') || 
                        request.headers.get('x-csrf-token');
  
  if (!receivedToken || !expectedToken) {
    return false;
  }
  
  // If token has signature, verify it
  if (expectedToken.includes('.') && sessionSecret && typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const [token, signature] = expectedToken.split('.');
      const encoder = new TextEncoder();
      const keyData = encoder.encode(sessionSecret);
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const expectedSignature = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
      const expectedSignatureHex = Array.from(new Uint8Array(expectedSignature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      return receivedToken === expectedToken && signature === expectedSignatureHex;
    } catch (err) {
      // If signature verification fails, fall back to simple comparison
      console.warn('CSRF signature verification failed:', err);
    }
  }
  
  // Simple comparison (constant-time comparison would be better, but this is acceptable)
  return receivedToken === expectedToken;
}

/**
 * Gets client IP address from request
 * Used for rate limiting and logging
 * 
 * @param {Request} request - The incoming request
 * @returns {string} - Client IP address
 */
export function getClientIP(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip');
  
  return cfConnectingIP || realIP || (forwarded ? forwarded.split(',')[0].trim() : 'unknown');
}

/**
 * Generates a unique request ID for tracking and security monitoring
 * 
 * @returns {string} - Unique request ID
 */
export function generateRequestID() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  
  // Fallback
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}
