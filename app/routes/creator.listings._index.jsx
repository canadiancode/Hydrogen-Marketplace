import {useLoaderData, Link, useSearchParams, useNavigate} from 'react-router';
import {useState, useEffect} from 'react';
import {requireAuth} from '~/lib/auth-helpers';
import {CheckCircleIcon, XMarkIcon} from '@heroicons/react/24/solid';
import {EllipsisVerticalIcon} from '@heroicons/react/20/solid';
import {PhotoIcon} from '@heroicons/react/24/outline';
import {Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react';
import {fetchCreatorProfile, fetchCreatorListings, createUserSupabaseClient} from '~/lib/supabase';

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    return {
      user,
      listings: [],
    };
  }

  const supabaseUrl = context.env.SUPABASE_URL;
  const anonKey = context.env.SUPABASE_ANON_KEY;
  const accessToken = session.access_token;

  if (!supabaseUrl || !anonKey || !accessToken) {
    console.error('Loader: Missing Supabase configuration');
    return {
      user,
      listings: [],
    };
  }

  // Fetch creator profile to get creator_id
  const creatorProfile = await fetchCreatorProfile(user.email, supabaseUrl, anonKey, accessToken, request.fetch || fetch);
  
  if (!creatorProfile || !creatorProfile.id) {
    // Creator profile doesn't exist yet - return empty listings
    return {
      user,
      listings: [],
    };
  }

  // Fetch creator's listings from Supabase
  const allListings = await fetchCreatorListings(creatorProfile.id, supabaseUrl, anonKey, accessToken, request.fetch || fetch);
  
  // Filter out sold items (sold, shipped, completed) - these belong in /creator/sales
  const activeListings = allListings.filter(listing => 
    listing.status !== 'sold' && 
    listing.status !== 'shipped' && 
    listing.status !== 'completed'
  );
  
  // SECURITY: Validate UUID format for all listing IDs to prevent injection attacks
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  // Get public URLs for photos and fetch accepted offers for draft and reserved listings
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, request.fetch || fetch);
  
  // SECURITY: Get draft and reserved listing IDs with explicit ownership verification
  // Filter by status and validate UUID format, then verify ownership
  const draftAndReservedListingIds = activeListings
    .filter(listing => {
      // Validate UUID format
      if (!uuidRegex.test(listing.id)) {
        console.error('SECURITY: Invalid listing ID format:', listing.id);
        return false;
      }
      // SECURITY: Explicitly verify listing belongs to creator
      if (listing.creator_id !== creatorProfile.id) {
        console.error('SECURITY: Listing does not belong to creator:', listing.id);
        return false;
      }
      // Only include draft and reserved listings (both can have accepted offers)
      return listing.status === 'draft' || listing.status === 'reserved';
    })
    .map(listing => listing.id);
  
  // SECURITY: Fetch accepted offers for draft and reserved listings with validation
  let acceptedOffersMap = {};
  if (draftAndReservedListingIds.length > 0) {
    const now = new Date();
    const {data: acceptedOffers, error: offersError} = await supabase
      .from('offers')
      .select('listing_id, offer_amount_cents, discount_expires_at')
      .in('listing_id', draftAndReservedListingIds)
      .eq('status', 'accepted')
      .order('created_at', {ascending: false});
    
    if (offersError) {
      console.error('Error fetching accepted offers:', offersError);
    } else if (acceptedOffers) {
      // SECURITY: Create a map of listing_id -> accepted offer
      // If multiple accepted offers exist (shouldn't happen in normal flow),
      // we take the most recent one based on created_at ordering
      // This ensures consistency in display
      acceptedOffers.forEach(offer => {
        // SECURITY: Validate offer data before adding to map
        if (!offer.listing_id || !uuidRegex.test(offer.listing_id)) {
          console.error('SECURITY: Invalid offer listing_id:', offer.listing_id);
          return;
        }
        
        // SECURITY: Validate offer amount is a positive integer
        if (!offer.offer_amount_cents || 
            !Number.isInteger(offer.offer_amount_cents) || 
            offer.offer_amount_cents <= 0) {
          console.error('SECURITY: Invalid offer amount:', offer.offer_amount_cents);
          return;
        }
        
        // SECURITY: Only add offer if listing_id is in our verified list
        if (!draftAndReservedListingIds.includes(offer.listing_id)) {
          console.error('SECURITY: Offer listing_id not in verified list:', offer.listing_id);
          return;
        }
        
        // SECURITY: Filter out expired offers
        if (offer.discount_expires_at) {
          const expirationDate = new Date(offer.discount_expires_at);
          if (expirationDate <= now) {
            // Offer has expired, skip it
            return;
          }
        }
        
        // Only store the first (most recent) offer for each listing
        if (!acceptedOffersMap[offer.listing_id]) {
          acceptedOffersMap[offer.listing_id] = {
            offerAmountCents: offer.offer_amount_cents,
            discountExpiresAt: offer.discount_expires_at,
          };
        }
      });
    }
  }
  
  const listingsWithPhotoUrls = await Promise.all(
    activeListings.map(async (listing) => {
      if (listing.photos && listing.photos.length > 0) {
        // Get public URL for the first photo
        const {data} = supabase.storage
          .from('listing-photos')
          .getPublicUrl(listing.photos[0].storage_path);
        
        return {
          ...listing,
          thumbnailUrl: data?.publicUrl || null,
          acceptedOffer: acceptedOffersMap[listing.id] || null,
        };
      }
      return {
        ...listing,
        acceptedOffer: acceptedOffersMap[listing.id] || null,
      };
    })
  );
  
  return {
    user,
    creatorProfile,
    listings: listingsWithPhotoUrls,
  };
}

export default function CreatorListings() {
  const {listings, creatorProfile} = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Check for success parameter and show banner
  useEffect(() => {
    const submitted = searchParams.get('submitted');
    const updated = searchParams.get('updated');
    
    if (submitted === 'true') {
      setSuccessMessage('Listing submitted successfully! Your listing has been submitted and is now pending approval. It will be visible to buyers once approved.');
      setShowSuccessBanner(true);
      // Remove the parameter from URL without reloading
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('submitted');
      navigate(`/creator/listings?${newSearchParams.toString()}`, {replace: true});
      
      // Auto-dismiss banner after 5 seconds
      const timer = setTimeout(() => {
        setShowSuccessBanner(false);
      }, 5000);
      
      return () => clearTimeout(timer);
    } else if (updated === 'true') {
      setSuccessMessage('Listing updated successfully! Your changes have been saved.');
      setShowSuccessBanner(true);
      // Remove the parameter from URL without reloading
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('updated');
      navigate(`/creator/listings?${newSearchParams.toString()}`, {replace: true});
      
      // Auto-dismiss banner after 5 seconds
      const timer = setTimeout(() => {
        setShowSuccessBanner(false);
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [searchParams, navigate]);

  const handleDismissBanner = () => {
    setShowSuccessBanner(false);
  };
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Success Banner */}
        {showSuccessBanner && (
          <div className="mb-6 rounded-md bg-green-50 dark:bg-green-900/20 p-4 border border-green-200 dark:border-green-800">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <CheckCircleIcon className="h-5 w-5 text-green-400" aria-hidden="true" />
              </div>
              <div className="ml-3 flex-1">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  {successMessage.split('.')[0]}.
                </p>
                {successMessage.includes('.') && successMessage.split('.').length > 1 && (
                  <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                    {successMessage.split('.').slice(1).join('.').trim()}
                  </p>
                )}
              </div>
              <div className="ml-auto pl-3">
                <button
                  type="button"
                  onClick={handleDismissBanner}
                  className="inline-flex rounded-md bg-green-50 dark:bg-green-900/20 p-1.5 text-green-500 hover:bg-green-100 dark:hover:bg-green-900/30 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 focus:ring-offset-green-50 dark:focus:ring-offset-green-900/20"
                >
                  <span className="sr-only">Dismiss</span>
                  <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">My Listings</h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Manage your inventory overview. View all listings with status badges (pending, live, sold, in validation, completed).
            </p>
          </div>
          <Link
            to="/creator/listings/new"
            className="hidden xl:inline-flex items-center min-w-[160px] px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-900"
          >
            Create New Listing
          </Link>
        </div>
        
        {/* Listings list */}
        {listings.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
              You haven't created any listings yet.
            </p>
            <Link
              to="/creator/listings/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-900"
            >
              Create Your First Listing
            </Link>
          </div>
        ) : (
          <ul role="list" className="divide-y divide-gray-100 dark:divide-white/5">
            {listings.map((listing) => (
              <ListingItem key={listing.id} listing={listing} creatorId={creatorProfile?.id} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Status badge component - matches template style
 */
function StatusBadge({status}) {
  if (status === 'pending_approval') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-yellow-50 px-4 py-2 !text-[11px] font-medium text-yellow-800 inset-ring inset-ring-yellow-600/20 dark:bg-yellow-400/10 dark:text-yellow-500 dark:inset-ring-yellow-400/20">
        Pending Approval
      </p>
    );
  }
  
  if (status === 'live') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-green-50 px-4 py-2 !text-[11px] font-medium text-green-700 inset-ring inset-ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:inset-ring-green-500/20">
        Live
      </p>
    );
  }
  
  if (status === 'sold') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-blue-50 px-4 py-2 !text-[11px] font-medium text-blue-700 inset-ring inset-ring-blue-600/20 dark:bg-blue-400/10 dark:text-blue-400 dark:inset-ring-blue-500/20">
        Sold
      </p>
    );
  }
  
  if (status === 'in_validation') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-purple-50 px-4 py-2 !text-[11px] font-medium text-purple-700 inset-ring inset-ring-purple-600/20 dark:bg-purple-400/10 dark:text-purple-400 dark:inset-ring-purple-500/20">
        In Validation
      </p>
    );
  }
  
  if (status === 'shipped') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-indigo-50 px-4 py-2 !text-[11px] font-medium text-indigo-700 inset-ring inset-ring-indigo-600/20 dark:bg-indigo-400/10 dark:text-indigo-400 dark:inset-ring-indigo-500/20">
        Shipped
      </p>
    );
  }
  
  if (status === 'completed') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-green-50 px-4 py-2 !text-[11px] font-medium text-green-700 inset-ring inset-ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:inset-ring-green-500/20">
        Completed
      </p>
    );
  }
  
  if (status === 'rejected') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-red-50 px-4 py-2 !text-[11px] font-medium text-red-700 inset-ring inset-ring-red-600/20 dark:bg-red-400/10 dark:text-red-400 dark:inset-ring-red-500/20">
        Rejected
      </p>
    );
  }
  
  // Draft status
  return (
    <p className="!p-1 mt-0.5 rounded-md bg-gray-50 px-4 py-2 !text-[11px] font-medium text-gray-600 inset-ring inset-ring-gray-500/10 dark:bg-gray-400/10 dark:text-gray-400 dark:inset-ring-gray-400/20">
      Draft
    </p>
  );
}

/**
 * Listing item component - matches template style
 * 
 * SECURITY: Validates ownership before displaying sensitive offer information
 */
function ListingItem({listing, creatorId}) {
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

  // SECURITY: Sanitize and validate offer amount before display
  const getSafeOfferAmount = (offerAmountCents) => {
    if (!offerAmountCents || !Number.isInteger(offerAmountCents) || offerAmountCents <= 0) {
      return '0.00';
    }
    // Ensure safe conversion to dollars with 2 decimal places
    const amount = (offerAmountCents / 100).toFixed(2);
    // Validate result is a valid number string
    if (isNaN(parseFloat(amount)) || !isFinite(parseFloat(amount))) {
      return '0.00';
    }
    return amount;
  };

  // SECURITY: Check if offer is still valid (not expired)
  const isOfferValid = (discountExpiresAt) => {
    if (!discountExpiresAt) return true; // No expiration means always valid
    const expirationDate = new Date(discountExpiresAt);
    const now = new Date();
    return expirationDate > now;
  };

  // SECURITY: Verify ownership before displaying offer information
  const canDisplayOffer = listing.acceptedOffer && 
                          (listing.status === 'draft' || listing.status === 'reserved') &&
                          listing.creator_id === creatorId &&
                          isOfferValid(listing.acceptedOffer.discountExpiresAt);

  return (
    <li className="flex items-center justify-between gap-x-6 py-5">
      {/* Photo thumbnail on the left - full height of row */}
      <div className="flex-shrink-0">
        <div className="h-20 w-20 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-white/10 flex items-center justify-center">
          {listing.thumbnailUrl ? (
            <img
              src={listing.thumbnailUrl}
              alt={listing.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <PhotoIcon className="h-8 w-8 text-gray-400 dark:text-gray-500" />
          )}
        </div>
      </div>
      
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-x-3">
          <p className="text-sm/6 font-semibold text-gray-900 dark:text-white">{listing.title}</p>
          <StatusBadge status={listing.status} />
        </div>
        <div className="mt-1 flex items-center gap-x-2 text-xs/5 text-gray-500 dark:text-gray-400">
          <p className="whitespace-nowrap">
            Created on <time dateTime={formatDateTime(listing.created_at)}>{formatDate(listing.created_at)}</time>
          </p>
          <svg viewBox="0 0 2 2" className="size-0.5 fill-current">
            <circle r={1} cx={1} cy={1} />
          </svg>
          {listing.category && (
            <p className="truncate">{listing.category}</p>
          )}
          {listing.photos && listing.photos.length > 0 && (
            <>
              <svg viewBox="0 0 2 2" className="size-0.5 fill-current">
                <circle r={1} cx={1} cy={1} />
              </svg>
              <p className="truncate">{listing.photos.length} photo{listing.photos.length !== 1 ? 's' : ''}</p>
            </>
          )}
        </div>
        <div className="mt-1">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              ${listing.price}
            </p>
          </div>
          {/* SECURITY: Only display offer information if ownership is verified and offer is valid */}
          {canDisplayOffer && (
            <div className="mt-2 flex items-center gap-x-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Accepted Offer</p>
                <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                  ${getSafeOfferAmount(listing.acceptedOffer.offerAmountCents)}
                </p>
              </div>
              {listing.acceptedOffer.discountExpiresAt && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Expires</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    <time dateTime={formatDateTime(listing.acceptedOffer.discountExpiresAt)}>
                      {formatDate(listing.acceptedOffer.discountExpiresAt)}
                    </time>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-none items-center gap-x-4">
        {listing.status === 'live' && (
          <Link
            to={`/listings/${listing.id}`}
            className="hidden rounded-md bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 sm:block dark:bg-white/10 dark:text-white dark:shadow-none dark:inset-ring-white/5 dark:hover:bg-white/20"
          >
            View listing<span className="sr-only">, {listing.title}</span>
          </Link>
        )}
        {/* Hide menu (3 dots) for draft and reserved listings - these cannot be edited or deleted */}
        {listing.status !== 'draft' && listing.status !== 'reserved' && (
          <Menu as="div" className="relative flex-none">
            <MenuButton className="relative block text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
              <span className="absolute -inset-2.5" />
              <span className="sr-only">Open options</span>
              <EllipsisVerticalIcon aria-hidden="true" className="size-5" />
            </MenuButton>
            <MenuItems
              transition
              className="absolute right-0 z-10 mt-2 w-32 origin-top-right rounded-md bg-white py-2 shadow-lg outline-1 outline-gray-900/5 transition data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-100 data-enter:ease-out data-leave:duration-75 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
            >
              <MenuItem>
                <Link
                  to={`/creator/listings/${listing.id}/edit`}
                  className="block px-3 py-1 text-sm/6 text-gray-900 data-focus:bg-gray-50 data-focus:outline-hidden dark:text-white dark:data-focus:bg-white/5"
                >
                  Edit<span className="sr-only">, {listing.title}</span>
                </Link>
              </MenuItem>
              <MenuItem>
                <button
                  type="button"
                  className="block w-full text-left px-3 py-1 text-sm/6 text-red-600 data-focus:bg-red-50 data-focus:outline-hidden dark:text-red-400 dark:data-focus:bg-red-900/20"
                  onClick={(e) => {
                    e.preventDefault();
                    // TODO: Implement delete functionality
                    if (confirm(`Are you sure you want to delete "${listing.title}"?`)) {
                      // Handle delete
                    }
                  }}
                >
                  Delete<span className="sr-only">, {listing.title}</span>
                </button>
              </MenuItem>
            </MenuItems>
          </Menu>
        )}
      </div>
    </li>
  );
}