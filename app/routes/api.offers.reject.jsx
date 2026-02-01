import {data} from 'react-router';
import {requireAuth, getClientIP} from '~/lib/auth-helpers';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {fetchCreatorProfile, rejectOffer} from '~/lib/supabase';

/**
 * API route for rejecting offers
 * POST /api/offers/reject
 * 
 * SECURITY FEATURES:
 * - Rate limiting (10 actions per minute per IP)
 * - Requires authentication
 * - Verifies creator owns the listing
 * - Validates offer is still pending
 * - Checks offer expiration
 * - Prevents information disclosure
 */
export async function action({request, context}) {
  if (request.method !== 'POST') {
    return data({success: false, error: 'Method not allowed'}, {status: 405});
  }

  // SECURITY: Rate limiting - 10 actions per minute per IP
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `offer-action:${clientIP}`, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    return data(
      {success: false, error: 'Too many requests. Please wait before trying again.'},
      {status: 429}
    );
  }

  // Require authentication
  const {user, session} = await requireAuth(request, context.env);

  if (!user?.email || !session?.access_token) {
    return data({success: false, error: 'Unauthorized'}, {status: 401});
  }

  const formData = await request.formData();
  const offerId = formData.get('offerId');

  // SECURITY: Validate input type and presence
  if (!offerId || typeof offerId !== 'string') {
    return data({success: false, error: 'Missing or invalid offer ID'}, {status: 400});
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(offerId)) {
    return data({success: false, error: 'Invalid offer ID format'}, {status: 400});
  }

  // Get creator profile
  // CRITICAL: Pass request's fetch to avoid Cloudflare Workers I/O context errors
  const creatorProfile = await fetchCreatorProfile(
    user.email,
    context.env.SUPABASE_URL,
    context.env.SUPABASE_ANON_KEY,
    session.access_token,
    request.fetch || fetch
  );

  if (!creatorProfile || !creatorProfile.id) {
    // SECURITY: Generic error message to prevent information disclosure
    return data({success: false, error: 'Unauthorized'}, {status: 403});
  }

  // Reject offer
  // CRITICAL: Pass request's fetch to avoid Cloudflare Workers I/O context errors
  const result = await rejectOffer({
    offerId,
    creatorId: creatorProfile.id,
    supabaseUrl: context.env.SUPABASE_URL,
    anonKey: context.env.SUPABASE_ANON_KEY,
    accessToken: session.access_token,
    customFetch: request.fetch || fetch,
  });

  if (!result.success) {
    // SECURITY: Use generic error messages to prevent information disclosure
    // Don't expose specific error details that could help attackers
    const isClientError = result.error?.message?.includes('not found') || 
                         result.error?.message?.includes('Unauthorized') ||
                         result.error?.message?.includes('already') ||
                         result.error?.message?.includes('expired');
    
    return data(
      {success: false, error: isClientError ? result.error.message : 'Unable to process request'},
      {status: isClientError ? 400 : 500}
    );
  }

  return data({
    success: true,
    offer: result.offer,
  });
}
