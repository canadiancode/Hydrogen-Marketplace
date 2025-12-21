import {useState, createContext, useContext, Suspense, startTransition} from 'react';
import {Dialog, DialogBackdrop, DialogPanel, DialogTitle} from '@headlessui/react';
import {XMarkIcon} from '@heroicons/react/24/outline';
import {Await} from 'react-router';
import {useOptimisticCart, CartForm, Money} from '@shopify/hydrogen';
import {CartLineItem} from './CartLineItem';
import {Link} from 'react-router';

export const CartDrawerContext = createContext(null);

/**
 * Provider component that manages cart drawer state
 * @param {{children: React.ReactNode; cart: Promise<any> | null}}
 */
export function CartDrawerProvider({children, cart}) {
  const [open, setOpen] = useState(false);

  return (
    <CartDrawerContext.Provider value={{open, setOpen, cart}}>
      {children}
      <CartDrawerContent />
    </CartDrawerContext.Provider>
  );
}

/**
 * Hook to access cart drawer context
 */
export function useCartDrawer() {
  const context = useContext(CartDrawerContext);
  if (!context) {
    throw new Error('useCartDrawer must be used within CartDrawerProvider');
  }
  return context;
}

/**
 * The actual drawer content component
 */
function CartDrawerContent() {
  const {open, setOpen, cart} = useCartDrawer();

  const handleClose = () => {
    startTransition(() => {
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onClose={handleClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-gray-500/75 dark:bg-gray-900/75 transition-opacity duration-500 ease-in-out data-closed:opacity-0"
      />

      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">
            <DialogPanel
              transition
              className="pointer-events-auto w-screen max-w-md transform transition duration-500 ease-in-out data-closed:translate-x-full sm:duration-700"
            >
              <div className="flex h-full flex-col overflow-y-auto bg-white dark:bg-gray-900 shadow-xl">
                <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                  <div className="flex items-start justify-between">
                    <DialogTitle className="text-lg font-medium text-gray-900 dark:text-white">
                      Shopping cart
                    </DialogTitle>
                    <div className="ml-3 flex h-7 items-center">
                      <button
                        type="button"
                        onClick={handleClose}
                        className="relative -m-2 p-2 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
                      >
                        <span className="absolute -inset-0.5" />
                        <span className="sr-only">Close panel</span>
                        <XMarkIcon aria-hidden="true" className="size-6" />
                      </button>
                    </div>
                  </div>

                  {open && (
                    <div className="mt-8">
                      <Suspense fallback={<CartLoadingState />}>
                        <Await resolve={cart}>
                          {(resolvedCart) => <CartItemsList cart={resolvedCart} onClose={handleClose} />}
                        </Await>
                      </Suspense>
                    </div>
                  )}
                </div>

                {open && <CartDrawerFooter />}
              </div>
            </DialogPanel>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Footer section with subtotal and checkout button
 */
function CartDrawerFooter() {
  const {cart} = useCartDrawer();

  return (
    <Suspense fallback={null}>
      <Await resolve={cart}>
        {(resolvedCart) => <CartDrawerFooterContent cart={resolvedCart} />}
      </Await>
    </Suspense>
  );
}

/**
 * Footer content component (extracted to use hooks properly)
 */
function CartDrawerFooterContent({cart}) {
  const optimisticCart = useOptimisticCart(cart);
  const subtotal = optimisticCart?.cost?.subtotalAmount;
  const checkoutUrl = optimisticCart?.checkoutUrl;
  const discountCodes = optimisticCart?.discountCodes?.filter((code) => code.applicable) || [];
  const appliedGiftCards = optimisticCart?.appliedGiftCards || [];

  if (!subtotal) return null;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-6 sm:px-6">
      <div className="flex justify-between text-base font-medium text-gray-900 dark:text-white">
        <p>Subtotal</p>
        <p>
          {subtotal ? <Money data={subtotal} /> : '-'}
        </p>
      </div>
      
      {/* Discount codes */}
      {discountCodes.length > 0 && (
        <div className="mt-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">Discount(s): </span>
          <span className="font-medium text-gray-900 dark:text-white">
            {discountCodes.map(({code}) => code).join(', ')}
          </span>
        </div>
      )}

      {/* Gift cards */}
      {appliedGiftCards.length > 0 && (
        <div className="mt-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">Gift card(s) applied</span>
        </div>
      )}

      <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
        Shipping and taxes calculated at checkout.
      </p>
      <div className="mt-6">
        {checkoutUrl ? (
          <a
            href={checkoutUrl}
            className="flex items-center justify-center rounded-md border border-transparent bg-indigo-600 dark:bg-indigo-500 px-6 py-3 text-base font-medium text-white shadow-xs hover:bg-indigo-700 dark:hover:bg-indigo-400"
          >
            Checkout
          </a>
        ) : (
          <Link
            to="/cart"
            className="flex items-center justify-center rounded-md border border-transparent bg-indigo-600 dark:bg-indigo-500 px-6 py-3 text-base font-medium text-white shadow-xs hover:bg-indigo-700 dark:hover:bg-indigo-400"
          >
            View Cart
          </Link>
        )}
      </div>
      <ContinueShoppingButton />
    </div>
  );
}

/**
 * Cart items list component (extracted to use hooks properly)
 */
function CartItemsList({cart, onClose}) {
  const optimisticCart = useOptimisticCart(cart);
  const hasItems = optimisticCart?.totalQuantity > 0;

  if (!hasItems) {
    return <CartEmptyState onClose={onClose} />;
  }

  return (
    <div className="flow-root">
      <ul role="list" className="-my-6 divide-y divide-gray-200 dark:divide-gray-700">
        {(optimisticCart?.lines?.nodes ?? []).map((line) => (
          <CartLineItem key={line.id} line={line} layout="aside" />
        ))}
      </ul>
    </div>
  );
}

/**
 * Loading state for cart
 */
function CartLoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-gray-500 dark:text-gray-400">Loading cart...</p>
    </div>
  );
}

/**
 * Continue shopping button
 */
function ContinueShoppingButton() {
  const {setOpen} = useCartDrawer();
  return (
    <div className="mt-6 flex justify-center text-center text-sm text-gray-500 dark:text-gray-400">
      <p>
        or{' '}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Continue Shopping
          <span aria-hidden="true"> &rarr;</span>
        </button>
      </p>
    </div>
  );
}

/**
 * Empty cart state
 */
function CartEmptyState({onClose}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-gray-500 dark:text-gray-400 mb-4">
        Looks like you haven&rsquo;t added anything yet, let&rsquo;s get you started!
      </p>
      <Link
        to="/collections"
        onClick={onClose}
        prefetch="viewport"
        className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        Continue shopping →
      </Link>
    </div>
  );
}

