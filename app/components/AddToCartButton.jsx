import {useEffect, useRef, startTransition} from 'react';
import {CartForm} from '@shopify/hydrogen';

/**
 * Internal component that handles cart drawer opening logic
 */
function AddToCartButtonContent({fetcher, analytics, children, disabled, onClick, onAddToCart, className}) {
  const previousStateRef = useRef('idle');
  const previousDataRef = useRef(null);
  const processedDataRef = useRef(new Set());
  const userInitiatedRef = useRef(false);
  const hasProcessedInitialMountRef = useRef(false);
  const submissionStartTimeRef = useRef(null);
  
  // Track when user explicitly clicks the button
  const handleButtonClick = (e) => {
    // Mark that this was user-initiated BEFORE form submission
    userInitiatedRef.current = true;
    submissionStartTimeRef.current = Date.now();
    
    // Call the onClick callback if provided
    if (onClick) {
      onClick();
    }
    
    // Note: We'll also call onAddToCart when form completes
    // But we don't call it here to avoid opening drawer before item is added
    // Note: The form will submit naturally via type="submit"
  };
  
  // Open cart drawer when form submission succeeds
  useEffect(() => {
    const currentState = fetcher.state;
    const previousState = previousStateRef.current;
    const currentData = fetcher.data;
    const previousData = previousDataRef.current;
    
    // On initial mount, if there's already data, mark it as processed to prevent auto-opening
    // This handles the case where CartForm might have existing state from navigation
    if (!hasProcessedInitialMountRef.current) {
      hasProcessedInitialMountRef.current = true;
      // Initialize refs with current state, but don't process anything
      previousStateRef.current = currentState;
      previousDataRef.current = currentData;
      return;
    }
    
    // Track when submission starts (idle -> submitting) after user click
    // This ensures we're tracking a user-initiated submission
    if (userInitiatedRef.current && previousState === 'idle' && currentState === 'submitting') {
      // Submission started - update refs and continue tracking
      previousStateRef.current = currentState;
      previousDataRef.current = currentData;
      return;
    }
    
    // Detect state transition from submitting to idle (form completed)
    const justCompleted = previousState === 'submitting' && currentState === 'idle';
    
    // Also check if data changed after user click (alternative detection method)
    const dataChangedAfterClick = userInitiatedRef.current && currentData !== previousData && currentData !== null;
    
    // Only process if:
    // 1. This was a user-initiated submission (button was clicked)
    // 2. AND (we're seeing a completion transition OR data changed after click)
    // 3. AND we have response data
    const shouldProcess = userInitiatedRef.current && (justCompleted || dataChangedAfterClick) && currentData;
    
    if (shouldProcess) {
      // Create a unique key for this response to avoid processing twice
      const dataKey = currentData.cart?.id 
        ? `cart-${currentData.cart.id}-${currentData.cart.updatedAt || Date.now()}`
        : `response-${Date.now()}`;
      
      // Skip if we've already processed this exact response
      if (processedDataRef.current.has(dataKey)) {
        previousStateRef.current = currentState;
        previousDataRef.current = currentData;
        // Reset user initiated flag after processing
        userInitiatedRef.current = false;
        submissionStartTimeRef.current = null;
        return;
      }
      
      // Handle both array and object error formats from Shopify
      const errors = currentData.errors;
      const hasNoErrors = !errors || 
        (Array.isArray(errors) && errors.length === 0) ||
        (errors !== null && typeof errors === 'object' && Object.keys(errors).length === 0);
      
      // Check if cart exists and is valid
      const hasCart = !!currentData.cart;
      
      // If we have a cart (even with warnings), consider it a successful addition
      // The cart addition itself is handled by CartForm, we just need to open the drawer
      if (hasCart && hasNoErrors) {
        processedDataRef.current.add(dataKey);
        
        // Clean up old entries (keep last 5 to prevent memory leaks)
        if (processedDataRef.current.size > 10) {
          const entries = Array.from(processedDataRef.current);
          processedDataRef.current.clear();
          entries.slice(-5).forEach(key => processedDataRef.current.add(key));
        }
      }
      
      // Always call onAddToCart if provided when form completes
      // This ensures the drawer opens for user-initiated submissions
      // We check for cart existence, but if form completed without errors, item was likely added
      if (onAddToCart) {
        // Only open drawer if we have a cart or no errors (successful addition)
        if (hasCart || hasNoErrors) {
          // Use startTransition for smooth UI updates
          startTransition(() => {
            onAddToCart();
          });
        }
      }
      
      // Reset user initiated flag after processing
      userInitiatedRef.current = false;
      submissionStartTimeRef.current = null;
    }
    
    // Always update refs to track state for next render
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
        onClick={handleButtonClick}
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
