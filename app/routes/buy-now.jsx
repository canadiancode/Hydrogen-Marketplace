import {redirect, data} from 'react-router';
import {CartForm} from '@shopify/hydrogen';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';

/**
 * Buy Now route handler
 * Adds item to cart (or creates cart if none exists) and redirects to checkout
 * 
 * @param {Route.ActionArgs}
 */
export async function action({request, context}) {
  const {cart} = context;

  // Only allow POST requests
  if (request.method !== 'POST') {
    return data({error: 'Method not allowed'}, {status: 405});
  }

  const formData = await request.formData();
  const variantId = formData.get('variantId');
  const quantity = parseInt(formData.get('quantity') || '1', 10);

  // Validate inputs
  if (!variantId || typeof variantId !== 'string') {
    return data({error: 'Variant ID is required'}, {status: 400});
  }

  if (isNaN(quantity) || quantity < 1) {
    return data({error: 'Invalid quantity'}, {status: 400});
  }

  // Rate limiting for buy now operations
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `buy-now:${clientIP}`, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    return data(
      {
        error: 'Too many requests. Please wait a moment before trying again.',
      },
      {status: 429}
    );
  }

  try {
    // Get current cart
    const currentCart = await cart.get();

    // Prepare the line item to add
    const lineToAdd = {
      merchandiseId: variantId.startsWith('gid://')
        ? variantId
        : `gid://shopify/ProductVariant/${variantId}`,
      quantity,
    };

    let cartResult;
    let headers = new Headers();

    if (currentCart?.id) {
      // Cart exists - add the item to existing cart
      // First, check if this variant is already in the cart
      const existingLine = currentCart.lines?.nodes?.find(
        (line) => line.merchandise?.id === lineToAdd.merchandiseId
      );

      if (existingLine) {
        // Update quantity if item already exists
        const newQuantity = existingLine.quantity + quantity;
        const result = await cart.updateLines([
          {
            id: existingLine.id,
            quantity: newQuantity,
          },
        ]);
        
        // Check for errors
        if (result.errors?.length) {
          return data(
            {
              error: result.errors[0].message || 'Failed to update cart. Please try again.',
            },
            {status: 400}
          );
        }
        
        cartResult = result.cart;
      } else {
        // Add new line to cart
        const result = await cart.addLines([lineToAdd]);
        
        // Check for errors
        if (result.errors?.length) {
          return data(
            {
              error: result.errors[0].message || 'Failed to add item to cart. Please try again.',
            },
            {status: 400}
          );
        }
        
        cartResult = result.cart;
      }

      // Update cart ID in headers
      if (cartResult?.id) {
        headers = cart.setCartId(cartResult.id);
      }
    } else {
      // No cart exists - create new cart with this item
      const result = await cart.create({
        lines: [lineToAdd],
      });
      
      // Check for errors
      if (result.errors?.length) {
        return data(
          {
            error: result.errors[0].message || 'Failed to create cart. Please try again.',
          },
          {status: 400}
        );
      }
      
      cartResult = result.cart;

      // Set cart ID in headers
      if (cartResult?.id) {
        headers = cart.setCartId(cartResult.id);
      }
    }

    // Final check for cart result
    if (!cartResult) {
      return data(
        {error: 'Failed to add item to cart. Please try again.'},
        {status: 500}
      );
    }

    // Redirect to checkout
    if (cartResult.checkoutUrl) {
      return redirect(cartResult.checkoutUrl, {headers});
    } else {
      // Fallback: redirect to cart page if checkout URL is not available
      return redirect('/cart', {headers});
    }
  } catch (error) {
    console.error('Error in buy-now action:', error);
    return data(
      {
        error:
          'An error occurred while processing your request. Please try again.',
      },
      {status: 500}
    );
  }
}

/**
 * @param {Route.LoaderArgs}
 */
export async function loader() {
  // Redirect GET requests to home page
  return redirect('/');
}

export default function BuyNow() {
  // This component should never render as we always redirect
  return null;
}

/** @typedef {import('./+types/buy-now').Route} Route */

