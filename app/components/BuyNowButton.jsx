import {useFetcher} from 'react-router';
import {useState} from 'react';

/**
 * BuyNowButton component that adds an item to cart and redirects to checkout
 * 
 * @param {{
 *   variantId: string; // Shopify variant ID (GID format: gid://shopify/ProductVariant/...)
 *   quantity?: number;
 *   disabled?: boolean;
 *   className?: string;
 *   children?: React.ReactNode;
 * }}
 */
export function BuyNowButton({
  variantId,
  quantity = 1,
  disabled = false,
  className = '',
  children,
}) {
  const fetcher = useFetcher();
  const [isLoading, setIsLoading] = useState(false);

  const handleBuyNow = async () => {
    if (!variantId || disabled || isLoading) {
      return;
    }

    setIsLoading(true);

    try {
      // Submit to buy-now route which will add to cart and redirect to checkout
      fetcher.submit(
        {
          variantId,
          quantity: quantity.toString(),
        },
        {
          method: 'POST',
          action: '/buy-now',
        }
      );
    } catch (error) {
      console.error('Error initiating buy now:', error);
      setIsLoading(false);
    }
  };

  const isDisabled = disabled || isLoading || fetcher.state !== 'idle' || !variantId;

  return (
    <button
      type="button"
      onClick={handleBuyNow}
      disabled={isDisabled}
      className={className}
      aria-label="Buy now"
    >
      {isLoading || fetcher.state !== 'idle' ? (
        <span className="flex items-center justify-center">
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Processing...
        </span>
      ) : (
        children || 'Buy Now'
      )}
    </button>
  );
}

