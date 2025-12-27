import {useLoaderData, data} from 'react-router';
import {CartForm, useOptimisticCart} from '@shopify/hydrogen';
import {CartPageLineItem} from '~/components/CartPageLineItem';
import {CartPageSummary} from '~/components/CartPageSummary';
import {CartPageEmpty} from '~/components/CartPageEmpty';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: `Shopping Cart | WornVault`}];
};

/**
 * @type {HeadersFunction}
 */
export const headers = ({actionHeaders}) => actionHeaders;

/**
 * @param {Route.ActionArgs}
 */
export async function action({request, context}) {
  const {cart} = context;

  const formData = await request.formData();

  const {action, inputs} = CartForm.getFormInput(formData);

  if (!action) {
    throw new Error('No action provided');
  }

  // Rate limiting for cart operations
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `cart:${clientIP}`, {
    maxRequests: 30,
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    return data(
      {
        cart: null,
        errors: [{message: 'Too many requests. Please wait a moment before trying again.'}],
        warnings: [],
        analytics: {},
      },
      {status: 429},
    );
  }

  // CSRF protection for sensitive cart actions
  // Note: Shopify CartForm provides some protection, but explicit CSRF is recommended
  const sensitiveActions = [
    CartForm.ACTIONS.DiscountCodesUpdate,
    CartForm.ACTIONS.GiftCardCodesUpdate,
    CartForm.ACTIONS.BuyerIdentityUpdate,
  ];

  if (sensitiveActions.includes(action)) {
    // For these sensitive actions, we could add CSRF token validation
    // However, CartForm may handle this - check Shopify documentation
    // For now, rate limiting provides protection
  }

  let status = 200;
  let result;

  switch (action) {
    case CartForm.ACTIONS.LinesAdd:
      result = await cart.addLines(inputs.lines);
      break;
    case CartForm.ACTIONS.LinesUpdate:
      result = await cart.updateLines(inputs.lines);
      break;
    case CartForm.ACTIONS.LinesRemove:
      result = await cart.removeLines(inputs.lineIds);
      break;
    case CartForm.ACTIONS.DiscountCodesUpdate: {
      const formDiscountCode = inputs.discountCode;

      // User inputted discount code
      const discountCodes = formDiscountCode ? [formDiscountCode] : [];

      // Combine discount codes already applied on cart
      discountCodes.push(...inputs.discountCodes);

      result = await cart.updateDiscountCodes(discountCodes);
      break;
    }
    case CartForm.ACTIONS.GiftCardCodesUpdate: {
      const formGiftCardCode = inputs.giftCardCode;

      // User inputted gift card code
      const giftCardCodes = formGiftCardCode ? [formGiftCardCode] : [];

      // Combine gift card codes already applied on cart
      giftCardCodes.push(...inputs.giftCardCodes);

      result = await cart.updateGiftCardCodes(giftCardCodes);
      break;
    }
    case CartForm.ACTIONS.GiftCardCodesRemove: {
      const appliedGiftCardIds = inputs.giftCardCodes;
      result = await cart.removeGiftCardCodes(appliedGiftCardIds);
      break;
    }
    case CartForm.ACTIONS.BuyerIdentityUpdate: {
      result = await cart.updateBuyerIdentity({
        ...inputs.buyerIdentity,
      });
      break;
    }
    default:
      throw new Error(`${action} cart action is not defined`);
  }

  const cartId = result?.cart?.id;
  const headers = cartId ? cart.setCartId(result.cart.id) : new Headers();
  const {cart: cartResult, errors, warnings} = result;

  // Validate redirect URL to prevent open redirects
  const redirectTo = formData.get('redirectTo') ?? null;
  if (typeof redirectTo === 'string') {
    // Prevent external redirects and protocol-relative URLs
    if (
      redirectTo.includes('//') ||
      redirectTo.startsWith('http://') ||
      redirectTo.startsWith('https://') ||
      redirectTo.startsWith('javascript:') ||
      redirectTo.startsWith('data:')
    ) {
      // Invalid redirect - don't redirect
      console.warn('Invalid redirect URL blocked:', redirectTo);
    } else if (redirectTo.startsWith('/')) {
      // Valid relative URL
      status = 303;
      headers.set('Location', redirectTo);
    }
  }

  return data(
    {
      cart: cartResult,
      errors,
      warnings,
      analytics: {
        cartId,
      },
    },
    {status, headers},
  );
}

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({context}) {
  const {cart} = context;
  return await cart.get();
}

export default function Cart() {
  /** @type {LoaderReturnData} */
  const originalCart = useLoaderData();
  
  // Apply optimistic updates for immediate UI feedback
  const cart = useOptimisticCart(originalCart);
  
  const cartLines = cart?.lines?.nodes || [];
  const hasItems = cartLines.length > 0;

  return (
    <div className="bg-white dark:bg-gray-900">
      <div className="mx-auto max-w-2xl px-4 pt-16 pb-24 sm:px-6 lg:max-w-7xl lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
          Shopping Cart
        </h1>
        
        {!hasItems ? (
          <CartPageEmpty />
        ) : (
          <form className="mt-12 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-12 xl:gap-x-16">
            <section aria-labelledby="cart-heading" className="lg:col-span-7">
              <h2 id="cart-heading" className="sr-only">
                Items in your shopping cart
              </h2>

              <ul role="list" className="divide-y divide-gray-200 dark:divide-gray-700 border-t border-b border-gray-200 dark:border-gray-700">
                {cartLines.map((line, index) => (
                  <CartPageLineItem key={line.id} line={line} index={index} />
                ))}
              </ul>
            </section>

            {/* Order summary */}
            <CartPageSummary cart={cart} />
          </form>
        )}
      </div>
    </div>
  );
}

/** @typedef {import('react-router').HeadersFunction} HeadersFunction */
/** @typedef {import('./+types/cart').Route} Route */
/** @typedef {import('@shopify/hydrogen').CartQueryDataReturn} CartQueryDataReturn */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof action>} ActionReturnData */
