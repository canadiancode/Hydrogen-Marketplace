import {redirect} from 'react-router';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';

/**
 * Automatically applies a discount found on the url
 * If a cart exists it's updated with the discount, otherwise a cart is created with the discount already applied
 *
 * @example
 * Example path applying a discount and optional redirecting (defaults to the home page)
 * ```js
 * /discount/FREESHIPPING?redirect=/products
 *
 * ```
 * @param {Route.LoaderArgs}
 */
export async function loader({request, context, params}) {
  // Rate limiting: max 10 discount code applications per minute per IP
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `discount:${clientIP}`, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    return redirect('/');
  }

  const {cart} = context;
  const {code} = params;

  // Validate discount code format
  if (code && (code.length > 50 || !/^[a-zA-Z0-9_-]+$/.test(code))) {
    // Invalid discount code format - redirect without applying
    return redirect('/');
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  let redirectParam =
    searchParams.get('redirect') || searchParams.get('return_to') || '/';

  // Enhanced redirect validation - prevent external redirects and protocol-relative URLs
  if (
    redirectParam.includes('//') ||
    redirectParam.startsWith('http://') ||
    redirectParam.startsWith('https://') ||
    redirectParam.startsWith('javascript:') ||
    redirectParam.startsWith('data:')
  ) {
    redirectParam = '/';
  }

  // Ensure redirect is relative
  if (!redirectParam.startsWith('/')) {
    redirectParam = '/' + redirectParam;
  }

  searchParams.delete('redirect');
  searchParams.delete('return_to');

  const redirectUrl = `${redirectParam}?${searchParams}`;

  if (!code) {
    return redirect(redirectUrl);
  }

  try {
    const result = await cart.updateDiscountCodes([code]);
    const headers = cart.setCartId(result.cart.id);

    // Using set-cookie on a 303 redirect will not work if the domain origin have port number (:3000)
    // If there is no cart id and a new cart id is created in the progress, it will not be set in the cookie
    // on localhost:3000
    return redirect(redirectUrl, {
      status: 303,
      headers,
    });
  } catch (error) {
    // Log error but don't expose details
    console.error('Error applying discount code:', {
      error: error.message,
      code,
      timestamp: new Date().toISOString(),
    });
    // Redirect without applying discount code
    return redirect(redirectUrl);
  }
}

/** @typedef {import('./+types/discount.$code').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
