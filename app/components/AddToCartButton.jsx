import {useEffect, useRef, startTransition} from 'react';
import {CartForm} from '@shopify/hydrogen';

/**
 * Internal component that handles cart drawer opening logic
 */
function AddToCartButtonContent({fetcher, analytics, children, disabled, onClick, onAddToCart, className}) {
  const previousStateRef = useRef('idle');
  const previousDataRef = useRef(null);
  const processedDataRef = useRef(new Set());
  
  // Open cart drawer when form submission succeeds
  useEffect(() => {
    const currentState = fetcher.state;
    const previousState = previousStateRef.current;
    const currentData = fetcher.data;
    const previousData = previousDataRef.current;
    
    // Detect state transition from submitting to idle (form completed)
    const justCompleted = previousState === 'submitting' && currentState === 'idle';
    // Also check if data changed (new response received)
    const dataChanged = currentData !== previousData && currentData !== null;
    
    if ((justCompleted || dataChanged) && currentData) {
      // Create a unique key for this response to avoid processing twice
      const dataKey = currentData.cart?.id 
        ? `cart-${currentData.cart.id}-${currentData.cart.updatedAt || Date.now()}`
        : `response-${Date.now()}`;
      
      // Skip if we've already processed this exact response
      if (processedDataRef.current.has(dataKey)) {
        previousStateRef.current = currentState;
        previousDataRef.current = currentData;
        return;
      }
      
      // Handle both array and object error formats from Shopify
      const errors = currentData.errors;
      const hasNoErrors = !errors || 
        (Array.isArray(errors) && errors.length === 0) ||
        (errors !== null && typeof errors === 'object' && Object.keys(errors).length === 0);
      
      // Check if cart exists and is valid
      const hasCart = !!currentData.cart;
      
      // Process successful cart addition
      if (hasNoErrors && hasCart) {
        processedDataRef.current.add(dataKey);
        
        // Clean up old entries (keep last 5 to prevent memory leaks)
        if (processedDataRef.current.size > 10) {
          const entries = Array.from(processedDataRef.current);
          processedDataRef.current.clear();
          entries.slice(-5).forEach(key => processedDataRef.current.add(key));
        }
        
        // Cart addition succeeded - call callback to open drawer
        if (onAddToCart) {
          // Use startTransition for smooth UI updates
          startTransition(() => {
            onAddToCart();
          });
        }
      }
    }
    
    // Update refs
    previousStateRef.current = currentState;
    previousDataRef.current = currentData;
  }, [fetcher.state, fetcher.data, onAddToCart]);

  return (
    <>
      <input
        name="analytics"
        type="hidden"
        value={JSON.stringify(analytics)}
      />
      <button
        type="submit"
        onClick={onClick}
        disabled={disabled ?? fetcher.state !== 'idle'}
        className={className}
      >
        {children}
      </button>
    </>
  );
}

/**
 * @param {{
 *   analytics?: unknown;
 *   children: React.ReactNode;
 *   disabled?: boolean;
 *   lines: Array<OptimisticCartLineInput>;
 *   onClick?: () => void;
 *   onAddToCart?: () => void;
 *   className?: string;
 * }}
 */
export function AddToCartButton({
  analytics,
  children,
  disabled,
  lines,
  onClick,
  onAddToCart,
  className = '',
}) {
  return (
    <CartForm route="/cart" inputs={{lines}} action={CartForm.ACTIONS.LinesAdd}>
      {(fetcher) => (
        <AddToCartButtonContent
          fetcher={fetcher}
          analytics={analytics}
          children={children}
          disabled={disabled}
          onClick={onClick}
          onAddToCart={onAddToCart}
          className={className}
        />
      )}
    </CartForm>
  );
}

/** @typedef {import('react-router').FetcherWithComponents} FetcherWithComponents */
/** @typedef {import('@shopify/hydrogen').OptimisticCartLineInput} OptimisticCartLineInput */
