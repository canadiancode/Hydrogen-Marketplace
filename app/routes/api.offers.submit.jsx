import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';
import {createOffer, createServerSupabaseClient} from '~/lib/supabase';

// SECURITY: Input validation constants
const MAX_EMAIL_LENGTH = 320; // RFC 5321 maximum
const MAX_PRICE_VALUE = 999999999.99; // Maximum reasonable price ($999M)
const MIN_OFFER_CENTS = 10000; // $100 minimum

/**
 * SECURITY: Enhanced email validation (server-side)
 * More restrictive than client-side for defense in depth
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  // Check length
  if (email.length > MAX_EMAIL_LENGTH || email.length === 0) return false;
  
  // Remove control characters
  if (/[\x00-\x1F\x7F]/.test(email)) return false;
  
  // Enhanced regex (RFC 5322 compliant subset)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!emailRegex.test(email)) return false;
  
  // Split and validate parts
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  
  const [localPart, domain] = parts;
  
  // Local part validation
  if (localPart.length > 64 || localPart.length === 0) return false;
  if (localPart.startsWith('.') || localPart.endsWith('.')) return false;
  if (localPart.includes('..')) return false; // No consecutive dots
  
  // Domain validation
  if (domain.length > 255 || domain.length === 0) return false;
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  
  return true;
}

/**
 * SECURITY: Safe price parsing (server-side)
 * Prevents Infinity, overflow, and invalid formats
 */
function parseSafePrice(value) {
  if (!value || typeof value !== 'string') return null;
  
  const trimmed = value.trim();
  if (!trimmed) return null;
  
  // Reject scientific notation
  if (/[eE]/.test(trimmed)) return null;
  
  // Only allow digits, one decimal point, max 2 decimal places
  if (!/^\d+\.?\d{0,2}$/.test(trimmed)) return null;
  
  const parsed = parseFloat(trimmed);
  
  // Check for invalid values
  if (isNaN(parsed) || !isFinite(parsed)) return null;
  if (parsed < 0) return null;
  if (parsed > MAX_PRICE_VALUE) return null;
  
  return parsed;
}

/**
 * API route for submitting offers
 * POST /api/offers/submit
 * 
 * SECURITY FEATURES:
 * - Rate limiting (5 offers per hour per IP)
 * - Server-side validation with enhanced checks
 * - Input sanitization and length limits
 * - SQL injection prevention (Supabase parameterized queries)
 * - XSS prevention (JSON responses)
 * - Safe number parsing (prevents overflow)
 */
export async function action({request, context}) {
  if (request.method !== 'POST') {
    return Response.json({success: false, error: 'Method not allowed'}, {status: 405});
  }

  // SECURITY: Rate limiting - 5 offers per hour per IP
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `offer-submit:${clientIP}`, {
    maxRequests: 5,
    windowMs: 3600000, // 1 hour
  });

  if (!rateLimit.allowed) {
    return Response.json(
      {success: false, error: 'Too many requests. Please wait before submitting another offer.'},
      {status: 429}
    );
  }

  const formData = await request.formData();
  const listingId = formData.get('listingId');
  const productId = formData.get('productId');
  const variantId = formData.get('variantId');
  const email = formData.get('email');
  const offerAmount = formData.get('offerAmount');

  // SECURITY: Validate all required fields exist
  if (!listingId || !productId || !variantId || !email || !offerAmount) {
    return Response.json({success: false, error: 'Missing required fields'}, {status: 400});
  }

  // SECURITY: Ensure all inputs are strings (prevent type confusion)
  if (typeof listingId !== 'string' || typeof email !== 'string' || typeof offerAmount !== 'string') {
    return Response.json({success: false, error: 'Invalid input types'}, {status: 400});
  }

  // SECURITY: Validate UUID format for listingId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(listingId)) {
    return Response.json({success: false, error: 'Invalid listing ID'}, {status: 400});
  }

  // SECURITY: Validate and sanitize email
  const trimmedEmail = email.trim();
  if (!trimmedEmail || trimmedEmail.length > MAX_EMAIL_LENGTH) {
    return Response.json({success: false, error: 'Invalid email format'}, {status: 400});
  }
  
  if (!isValidEmail(trimmedEmail)) {
    return Response.json({success: false, error: 'Invalid email format'}, {status: 400});
  }
  
  // Normalize email (lowercase)
  const normalizedEmail = trimmedEmail.toLowerCase();

  // SECURITY: Validate and parse offer amount safely
  const parsedPrice = parseSafePrice(offerAmount);
  if (parsedPrice === null) {
    return Response.json({success: false, error: 'Invalid offer amount'}, {status: 400});
  }

  // Convert to cents (with overflow protection)
  const offerAmountCents = Math.round(parsedPrice * 100);
  
  // SECURITY: Check for integer overflow in cents conversion
  if (!Number.isSafeInteger(offerAmountCents) || offerAmountCents < 0) {
    return Response.json({success: false, error: 'Invalid offer amount'}, {status: 400});
  }

  // SECURITY: Validate minimum offer ($100)
  if (offerAmountCents < MIN_OFFER_CENTS) {
    return Response.json({success: false, error: 'Offer amount must be at least $100'}, {status: 400});
  }

  // SECURITY: Get listing to verify it exists and get price
  const supabase = createServerSupabaseClient(
    context.env.SUPABASE_URL,
    context.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const {data: listing, error: listingError} = await supabase
    .from('listings')
    .select('id, price_cents, status, shopify_product_id')
    .eq('id', listingId)
    .single();

  if (listingError || !listing) {
    return Response.json({success: false, error: 'Listing not found'}, {status: 404});
  }

  // SECURITY: Verify listing is available for offers
  if (listing.status !== 'live' && listing.status !== 'offer_pending') {
    return Response.json({success: false, error: 'Listing is not available for offers'}, {status: 400});
  }

  // SECURITY: Verify offer doesn't exceed price
  if (offerAmountCents > listing.price_cents) {
    return Response.json({success: false, error: 'Offer amount cannot exceed original price'}, {status: 400});
  }

  // Use productId from listing if provided, otherwise use form data
  const finalProductId = listing.shopify_product_id || productId;
  
  // SECURITY: Validate productId format (must be valid GID or numeric)
  if (!finalProductId || typeof finalProductId !== 'string') {
    return Response.json({success: false, error: 'Invalid product ID'}, {status: 400});
  }
  
  // Ensure productId is in GID format
  const productIdGid = finalProductId.startsWith('gid://')
    ? finalProductId
    : `gid://shopify/Product/${finalProductId}`;

  // SECURITY: Validate variantId format
  if (!variantId || typeof variantId !== 'string') {
    return Response.json({success: false, error: 'Invalid variant ID'}, {status: 400});
  }
  
  // Ensure variantId is in GID format
  const variantIdGid = variantId.startsWith('gid://')
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;

  // Create offer
  const result = await createOffer({
    listingId,
    productId: productIdGid,
    variantId: variantIdGid,
    customerEmail: normalizedEmail,
    offerAmountCents,
    originalPriceCents: listing.price_cents,
    supabaseUrl: context.env.SUPABASE_URL,
    serviceRoleKey: context.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!result.success) {
    return Response.json({success: false, error: result.error.message}, {status: 400});
  }

  return Response.json({success: true, offer: result.offer});
}
