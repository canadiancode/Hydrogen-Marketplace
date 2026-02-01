import {useState, useEffect, useRef} from 'react';
import {useLoaderData, useFetcher, useRevalidator, useRouteError, isRouteErrorResponse} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';
import {fetchCreatorProfile, fetchCreatorOffers, createUserSupabaseClient} from '~/lib/supabase';
import {PhotoIcon} from '@heroicons/react/24/outline';
import {Dialog, DialogBackdrop, DialogPanel, DialogTitle} from '@headlessui/react';
import {ExclamationTriangleIcon, CheckCircleIcon} from '@heroicons/react/24/outline';

export const meta = () => {
  return [{title: 'WornVault | Offers'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    return {
      user,
      offers: [],
    };
  }

  const supabaseUrl = context.env.SUPABASE_URL;
  const anonKey = context.env.SUPABASE_ANON_KEY;
  const accessToken = session.access_token;

  if (!supabaseUrl || !anonKey || !accessToken) {
    console.error('Loader: Missing Supabase configuration');
    return {
      user,
      offers: [],
    };
  }

  // Fetch creator profile to get creator_id
  // CRITICAL: Pass request's fetch to avoid Cloudflare Workers I/O context errors
  const creatorProfile = await fetchCreatorProfile(
    user.email,
    supabaseUrl,
    anonKey,
    accessToken,
    request.fetch || fetch
  );
  
  if (!creatorProfile || !creatorProfile.id) {
    // Creator profile doesn't exist yet - return empty offers
    return {
      user,
      offers: [],
    };
  }

  // Fetch offers for creator's listings
  // CRITICAL: Pass request's fetch to avoid Cloudflare Workers I/O context errors
  const offers = await fetchCreatorOffers(
    creatorProfile.id,
    supabaseUrl,
    anonKey,
    accessToken,
    request.fetch || fetch
  );
  
  return {
    user,
    offers,
  };
}

export default function CreatorOffers() {
  const {offers} = useLoaderData();
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Offers</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Accept or decline offers for your listings. Offers expire after 30 days.
          </p>
        </div>
        
        {/* Offers list */}
        {offers.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
              You don't have any offers yet.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500">
              When customers make offers on your listings, they'll appear here.
            </p>
          </div>
        ) : (
          <ul role="list" className="divide-y divide-gray-100 dark:divide-white/5">
            {offers.map((offer) => (
              <OfferItem key={offer.id} offer={offer} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Status badge component for offers
 */
function OfferStatusBadge({status}) {
  if (status === 'pending') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-yellow-50 px-4 py-2 !text-[11px] font-medium text-yellow-800 inset-ring inset-ring-yellow-600/20 dark:bg-yellow-400/10 dark:text-yellow-500 dark:inset-ring-yellow-400/20">
        Pending
      </p>
    );
  }
  
  if (status === 'accepted') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-green-50 px-4 py-2 !text-[11px] font-medium text-green-700 inset-ring inset-ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:inset-ring-green-500/20">
        Accepted
      </p>
    );
  }
  
  if (status === 'expired') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-gray-50 px-4 py-2 !text-[11px] font-medium text-gray-600 inset-ring inset-ring-gray-500/10 dark:bg-gray-400/10 dark:text-gray-400 dark:inset-ring-gray-400/20">
        Expired
      </p>
    );
  }
  
  if (status === 'declined') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-red-50 px-4 py-2 !text-[11px] font-medium text-red-700 inset-ring inset-ring-red-600/20 dark:bg-red-400/10 dark:text-red-400 dark:inset-ring-red-500/20">
        Declined
      </p>
    );
  }
  
  return null;
}

/**
 * Offer item component - matches listing item style
 */
function OfferItem({offer}) {
  const acceptFetcher = useFetcher();
  const rejectFetcher = useFetcher();
  const revalidator = useRevalidator();
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  // Track optimistic status updates to avoid revalidation loops
  // This prevents redirect loops by updating UI directly without triggering loader
  const [optimisticStatus, setOptimisticStatus] = useState(offer.status);

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toISOString();
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const listing = offer.listing || {};
  const originalPrice = listing.price || '0.00';
  const offerAmount = offer.offer_amount || '0.00';
  const discountPercent = offer.discount_percentage || '0.0';

  // Track previous fetcher states to detect transitions
  const prevAcceptState = useRef(acceptFetcher.state);
  const prevRejectState = useRef(rejectFetcher.state);

  // Update optimistic status when accept action succeeds or fails
  // Track state transitions to prevent infinite loops
  useEffect(() => {
    const wasSubmitting = prevAcceptState.current === 'submitting';
    const isIdle = acceptFetcher.state === 'idle';
    const hasData = acceptFetcher.data !== undefined;
    const hasSuccess = acceptFetcher.data?.success === true;
    const hasError = acceptFetcher.data?.success === false;

    if (wasSubmitting && isIdle && hasData) {
      if (hasSuccess) {
        // Keep optimistic status as 'accepted', then revalidate to sync with server
        // Small delay to ensure server has processed the update
        setTimeout(() => {
          revalidator.revalidate();
        }, 100);
      } else if (hasError) {
        // Reset on error - revert optimistic update
        setOptimisticStatus(offer.status);
        console.error('Error accepting offer:', acceptFetcher.data?.error);
        // Could show error toast here
      }
    }

    prevAcceptState.current = acceptFetcher.state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptFetcher.state, acceptFetcher.data]);

  // Update optimistic status when reject action succeeds or fails
  // Track state transitions to prevent infinite loops
  useEffect(() => {
    const wasSubmitting = prevRejectState.current === 'submitting';
    const isIdle = rejectFetcher.state === 'idle';
    const hasData = rejectFetcher.data !== undefined;
    const hasSuccess = rejectFetcher.data?.success === true;
    const hasError = rejectFetcher.data?.success === false;

    if (wasSubmitting && isIdle && hasData) {
      if (hasSuccess) {
        // Keep optimistic status as 'declined', then revalidate to sync with server
        // Small delay to ensure server has processed the update
        setTimeout(() => {
          revalidator.revalidate();
        }, 100);
      } else if (hasError) {
        // Reset on error - revert optimistic update
        setOptimisticStatus(offer.status);
        console.error('Error rejecting offer:', rejectFetcher.data?.error);
        // Could show error toast here
      }
    }

    prevRejectState.current = rejectFetcher.state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rejectFetcher.state, rejectFetcher.data]);

  // Sync optimistic status with actual offer status when loader data updates
  // This ensures UI stays in sync after revalidation
  useEffect(() => {
    // Only sync if not currently submitting and status has changed
    if (acceptFetcher.state === 'idle' && rejectFetcher.state === 'idle') {
      if (offer.status !== optimisticStatus) {
        setOptimisticStatus(offer.status);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.status]);

  // Use optimistic status for UI, fallback to original offer status
  const displayStatus = optimisticStatus || offer.status;

  const handleAcceptOffer = () => {
    setShowAcceptConfirm(true);
  };

  const confirmAccept = () => {
    // Optimistically update UI immediately
    setOptimisticStatus('accepted');
    setShowAcceptConfirm(false);
    
    const formData = new FormData();
    formData.append('offerId', offer.id);
    acceptFetcher.submit(formData, {
      method: 'POST',
      action: '/api/offers/accept',
    });
  };

  const handleRejectOffer = () => {
    setShowRejectConfirm(true);
  };

  const confirmReject = () => {
    // Optimistically update UI immediately
    setOptimisticStatus('declined');
    setShowRejectConfirm(false);
    
    const formData = new FormData();
    formData.append('offerId', offer.id);
    rejectFetcher.submit(formData, {
      method: 'POST',
      action: '/api/offers/reject',
    });
  };

  return (
    <>
      <li className="flex items-center justify-between gap-x-6 py-5">
        {/* Photo thumbnail on the left - full height of row */}
        <div className="flex-shrink-0">
          <div className="h-20 w-20 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-white/10 flex items-center justify-center">
            {offer.thumbnailUrl ? (
              <img
                src={offer.thumbnailUrl}
                alt={listing.title || 'Product'}
                className="h-full w-full object-cover"
              />
            ) : (
              <PhotoIcon className="h-8 w-8 text-gray-400 dark:text-gray-500" />
            )}
          </div>
        </div>
        
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-x-3">
            <p className="text-sm/6 font-semibold text-gray-900 dark:text-white">
              {listing.title || 'Unknown Product'}
            </p>
            <OfferStatusBadge status={displayStatus} />
          </div>
          <div className="mt-1 flex items-center gap-x-2 text-xs/5 text-gray-500 dark:text-gray-400">
            <p className="whitespace-nowrap">
              Offer made on <time dateTime={formatDateTime(offer.created_at)}>{formatDate(offer.created_at)}</time> at {formatTime(offer.created_at)}
            </p>
            <svg viewBox="0 0 2 2" className="size-0.5 fill-current">
              <circle r={1} cx={1} cy={1} />
            </svg>
            <p className="truncate">{offer.customer_email}</p>
          </div>
          <div className="mt-1 flex items-center gap-x-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Original Price</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                ${originalPrice}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Offer Amount</p>
              <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                ${offerAmount}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Discount</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {discountPercent}%
              </p>
            </div>
            {offer.expires_at && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Expires</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  <time dateTime={formatDateTime(offer.expires_at)}>{formatDate(offer.expires_at)}</time>
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-none items-center gap-x-4">
          {displayStatus === 'pending' && (
            <>
              <button
                type="button"
                onClick={handleAcceptOffer}
                disabled={acceptFetcher.state === 'submitting' || rejectFetcher.state === 'submitting'}
                className="hidden rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:block dark:focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {acceptFetcher.state === 'submitting' ? 'Accepting...' : 'Accept Offer'}
              </button>
              <button
                type="button"
                onClick={handleRejectOffer}
                disabled={acceptFetcher.state === 'submitting' || rejectFetcher.state === 'submitting'}
                className="hidden rounded-md bg-red-600 px-2.5 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:block dark:focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reject
              </button>
            </>
          )}
        </div>
      </li>

      {/* Accept Confirmation Modal */}
      <AcceptConfirmModal
        open={showAcceptConfirm}
        onClose={() => setShowAcceptConfirm(false)}
        onConfirm={confirmAccept}
        offerAmount={offerAmount}
        listingTitle={listing.title || 'this listing'}
        isSubmitting={acceptFetcher.state === 'submitting'}
      />

      {/* Reject Confirmation Modal */}
      <RejectConfirmModal
        open={showRejectConfirm}
        onClose={() => setShowRejectConfirm(false)}
        onConfirm={confirmReject}
        offerAmount={offerAmount}
        listingTitle={listing.title || 'this listing'}
        isSubmitting={rejectFetcher.state === 'submitting'}
      />
    </>
  );
}

/**
 * Confirmation modal for accepting offers
 */
function AcceptConfirmModal({open, onClose, onConfirm, offerAmount, listingTitle, isSubmitting}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-gray-500/75 dark:bg-gray-900/75 transition-opacity duration-300 ease-in-out data-closed:opacity-0"
      />

      <div className="fixed inset-0 z-10 overflow-y-auto">
        <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
          <DialogPanel
            transition
            className="relative transform overflow-hidden rounded-lg bg-white dark:bg-gray-800 px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6 data-closed:opacity-0 data-closed:scale-95"
          >
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 sm:mx-0 sm:h-10 sm:w-10">
                <CheckCircleIcon className="h-6 w-6 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              </div>
              <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                <DialogTitle as="h3" className="text-base font-semibold leading-6 text-gray-900 dark:text-white">
                  Accept Offer
                </DialogTitle>
                <div className="mt-2">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Are you sure you want to accept the offer of <strong>${offerAmount}</strong> for <strong>{listingTitle}</strong>?
                  </p>
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-md p-4 space-y-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Please review the following considerations:
                    </p>
                    <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-2 list-disc list-inside">
                      <li>If approved, an email will be sent to the customer.</li>
                      <li>The customer will have 7 days to pay for the item. During this time, other customers cannot purchase this item.</li>
                      <li>If the customer doesn't pay for the item within 7 days, the listing will go back live with your saved price.</li>
                    </ul>
                    <p className="text-sm font-medium text-indigo-700 dark:text-indigo-400 pt-2 border-t border-indigo-200 dark:border-indigo-800">
                      Note: Accepting this offer will set the listing to a pending state, removing it from the main WornVault marketplace.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
              <button
                type="button"
                onClick={onConfirm}
                disabled={isSubmitting}
                className="inline-flex w-full justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 sm:ml-3 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Accepting...' : 'Accept Offer'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="mt-3 inline-flex w-full justify-center rounded-md bg-white dark:bg-gray-700 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white shadow-xs ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 sm:mt-0 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Cancel
              </button>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Confirmation modal for rejecting offers
 */
function RejectConfirmModal({open, onClose, onConfirm, offerAmount, listingTitle, isSubmitting}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-gray-500/75 dark:bg-gray-900/75 transition-opacity duration-300 ease-in-out data-closed:opacity-0"
      />

      <div className="fixed inset-0 z-10 overflow-y-auto">
        <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
          <DialogPanel
            transition
            className="relative transform overflow-hidden rounded-lg bg-white dark:bg-gray-800 px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6 data-closed:opacity-0 data-closed:scale-95"
          >
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 sm:mx-0 sm:h-10 sm:w-10">
                <ExclamationTriangleIcon className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
              </div>
              <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                <DialogTitle as="h3" className="text-base font-semibold leading-6 text-gray-900 dark:text-white">
                  Reject Offer
                </DialogTitle>
                <div className="mt-2">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Are you sure you want to reject the offer of <strong>${offerAmount}</strong> for <strong>{listingTitle}</strong>? This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
              <button
                type="button"
                onClick={onConfirm}
                disabled={isSubmitting}
                className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-red-500 sm:ml-3 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Rejecting...' : 'Reject Offer'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="mt-3 inline-flex w-full justify-center rounded-md bg-white dark:bg-gray-700 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white shadow-xs ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 sm:mt-0 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Cancel
              </button>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Error boundary for offers route
 * Provides user-friendly error handling
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
  
  let errorMessage = 'Something went wrong while loading offers';
  let errorStatus = 500;
  
  if (isRouteErrorResponse(error)) {
    errorStatus = error.status;
    errorMessage = isDev 
      ? (error?.data?.message ?? error.data ?? 'An error occurred')
      : 'We encountered an error loading your offers. Please try refreshing the page.';
  } else if (error instanceof Error && isDev) {
    errorMessage = error.message;
  }
  
  // Log full error server-side but don't expose to client in production
  if (!isDev) {
    console.error('ErrorBoundary caught:', error);
  }
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-red-500 dark:text-red-400 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Error Loading Offers
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-6">
            {errorMessage}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 transition-colors"
          >
            Refresh Page
          </button>
          {isDev && error instanceof Error && error.stack && (
            <pre className="mt-8 text-xs overflow-auto text-left max-w-2xl mx-auto bg-gray-100 dark:bg-gray-800 p-4 rounded">
              {error.stack}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.offers').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */