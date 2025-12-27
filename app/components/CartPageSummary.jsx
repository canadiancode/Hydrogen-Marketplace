import {Money} from '@shopify/hydrogen';
import {QuestionMarkCircleIcon} from '@heroicons/react/20/solid';

/**
 * Order summary component for cart page using Tailwind template design.
 * Displays subtotal, shipping estimate, and tax estimate.
 * 
 * @param {{
 *   cart: CartApiQueryFragment | null;
 * }}
 */
export function CartPageSummary({cart}) {
  if (!cart) return null;

  const subtotalAmount = cart.cost?.subtotalAmount;
  const totalAmount = cart.cost?.totalAmount;
  const totalTaxAmount = cart.cost?.totalTaxAmount;
  
  // Calculate shipping estimate (if available)
  // Note: Shopify doesn't provide shipping estimate in cart by default
  // This would typically come from a shipping calculator API
  const shippingEstimate = null;
  
  // Calculate shipping from total if tax is available
  // This is a simplified calculation - in production, use Shopify's shipping calculator
  const calculatedShipping = subtotalAmount && totalAmount && totalTaxAmount
    ? {
        amount: String(
          parseFloat(totalAmount.amount) - 
          parseFloat(subtotalAmount.amount) - 
          parseFloat(totalTaxAmount.amount || '0')
        ),
        currencyCode: totalAmount.currencyCode,
      }
    : null;

  return (
    <section
      aria-labelledby="summary-heading"
      className="mt-16 rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-6 sm:p-6 lg:col-span-5 lg:mt-0 lg:p-8"
    >
      <h2 id="summary-heading" className="text-lg font-medium text-gray-900 dark:text-white">
        Order summary
      </h2>

      <dl className="mt-6 space-y-4">
        <div className="flex items-center justify-between">
          <dt className="text-sm text-gray-600 dark:text-gray-400">Subtotal</dt>
          <dd className="text-sm font-medium text-gray-900 dark:text-white">
            {subtotalAmount ? (
              <Money data={subtotalAmount} />
            ) : (
              '-'
            )}
          </dd>
        </div>

        {/* Shipping Estimate */}
        {(calculatedShipping || shippingEstimate) && (
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
            <dt className="flex items-center text-sm text-gray-600 dark:text-gray-400">
              <span>Shipping estimate</span>
              <a
                href="#"
                className="ml-2 shrink-0 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
                onClick={(e) => {
                  e.preventDefault();
                  // Could open a modal or tooltip with shipping info
                }}
              >
                <span className="sr-only">Learn more about how shipping is calculated</span>
                <QuestionMarkCircleIcon aria-hidden="true" className="size-5" />
              </a>
            </dt>
            <dd className="text-sm font-medium text-gray-900 dark:text-white">
              {calculatedShipping ? (
                <Money data={calculatedShipping} />
              ) : shippingEstimate ? (
                <Money data={shippingEstimate} />
              ) : (
                'Calculated at checkout'
              )}
            </dd>
          </div>
        )}

        {/* Tax Estimate */}
        {totalTaxAmount && parseFloat(totalTaxAmount.amount) > 0 && (
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
            <dt className="flex text-sm text-gray-600 dark:text-gray-400">
              <span>Tax estimate</span>
              <a
                href="#"
                className="ml-2 shrink-0 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
                onClick={(e) => {
                  e.preventDefault();
                  // Could open a modal or tooltip with tax info
                }}
              >
                <span className="sr-only">Learn more about how tax is calculated</span>
                <QuestionMarkCircleIcon aria-hidden="true" className="size-5" />
              </a>
            </dt>
            <dd className="text-sm font-medium text-gray-900 dark:text-white">
              <Money data={totalTaxAmount} />
            </dd>
          </div>
        )}
      </dl>

      {/* Checkout Button */}
      {cart.checkoutUrl && (
        <div className="mt-6">
          <a
            href={cart.checkoutUrl}
            className="w-full rounded-md border border-transparent bg-indigo-600 px-4 py-3 text-base font-medium text-white shadow-sm hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-800 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Checkout
          </a>
        </div>
      )}
    </section>
  );
}

/** @typedef {import('storefrontapi.generated').CartApiQueryFragment} CartApiQueryFragment */

