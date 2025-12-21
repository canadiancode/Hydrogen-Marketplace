import {useState, useEffect} from 'react';
import {useLoaderData, Link, useRouteError, isRouteErrorResponse, useSearchParams} from 'react-router';
import {fetchCreatorByHandle, fetchListingsByCreatorId} from '~/lib/supabase';
import {ChevronDownIcon} from '@heroicons/react/20/solid';
import {Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react';
import {decodeHTMLEntities} from '~/lib/html-entities';

export const meta = ({data}) => {
  if (!data?.creator) {
    return [{title: 'Creator Not Found | WornVault'}];
  }
  
  const decodedDisplayName = data.creator.display_name ? decodeHTMLEntities(data.creator.display_name) : data.creator.handle;
  return [
    {title: `${decodedDisplayName} | WornVault`},
    {name: 'description', content: data.creator.bio ? decodeHTMLEntities(data.creator.bio) : `View ${decodedDisplayName}'s profile and products on WornVault`},
    {rel: 'canonical', href: `/creators/${data.creator.handle}`},
  ];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({params, context, request}) {
  const {handle} = params;
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase configuration for creator profile page.');
    throw new Response('Server configuration error', {status: 500});
  }
  
  if (!handle) {
    throw new Response('Creator handle is required', {status: 400});
  }
  
  try {
    // Fetch creator by handle
    const creator = await fetchCreatorByHandle(handle, supabaseUrl, serviceRoleKey);
    
    if (!creator) {
      throw new Response('Creator not found', {status: 404});
    }
    
    // Get sort parameter from URL (default to 'newest' like shop page)
    const url = new URL(request.url);
    const sortParam = url.searchParams.get('sort') || 'newest';
    const validSorts = ['newest', 'oldest', 'price_high', 'price_low', 'title'];
    const sortBy = validSorts.includes(sortParam) ? sortParam : 'newest';
    
    // Fetch creator's listings
    const listings = await fetchListingsByCreatorId(creator.id, supabaseUrl, serviceRoleKey, {sortBy});
    
    // Construct cover image URL from storage path if available
    let coverImageUrl = null;
    if (creator.cover_image_storage_path) {
      const storagePath = creator.cover_image_storage_path;
      // If it's already a full URL, use it as-is
      if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
        coverImageUrl = storagePath;
      } else {
        // Construct the public URL from storage path
        const supabaseUrlClean = supabaseUrl.replace(/\/$/, ''); // Remove trailing slash
        coverImageUrl = `${supabaseUrlClean}/storage/v1/object/public/creator-cover-images/${storagePath}`;
      }
    }
    
    return {
      creator: {
        ...creator,
        coverImageUrl,
      },
      listings,
      sortBy,
      supabaseUrl,
    };
  } catch (error) {
    console.error('Error loading creator profile:', error);
    if (error instanceof Response) {
      throw error;
    }
    throw new Response('Failed to load creator profile', {status: 500});
  }
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });
}

function validateImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const allowedDomains = [
      'supabase.co',
      'via.placeholder.com',
      'cdn.shopify.com',
    ];
    return allowedDomains.some(domain => parsed.hostname.includes(domain));
  } catch {
    return false;
  }
}

export default function CreatorProfile() {
  const {creator, listings, sortBy: initialSortBy} = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [copied, setCopied] = useState(false);
  
  // Update URL when sort changes
  useEffect(() => {
    const currentSort = searchParams.get('sort') || 'newest';
    if (sortBy !== currentSort) {
      const params = new URLSearchParams(searchParams);
      if (sortBy && sortBy !== 'newest') {
        params.set('sort', sortBy);
      } else {
        params.delete('sort');
      }
      setSearchParams(params, {replace: true});
    }
  }, [sortBy]); // eslint-disable-line react-hooks/exhaustive-deps
  
  if (!creator) {
    return null;
  }
  
  const isVerified = creator.verification_status === 'verified';
  const profileImageUrl = creator.profile_image_url && validateImageUrl(creator.profile_image_url)
    ? creator.profile_image_url
    : 'https://via.placeholder.com/150?text=No+Image';
  
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  
  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        const decodedDisplayName = creator.display_name ? decodeHTMLEntities(creator.display_name) : creator.handle;
        await navigator.share({
          title: `${decodedDisplayName} on WornVault`,
          text: `Check out ${decodedDisplayName}'s profile on WornVault`,
          url: shareUrl,
        });
      } catch (err) {
        console.log('Share cancelled or failed');
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy URL');
      }
    }
  };
  
  const sortOptions = [
    {value: 'newest', label: 'Newest First'},
    {value: 'oldest', label: 'Oldest First'},
    {value: 'price_high', label: 'Price: High to Low'},
    {value: 'price_low', label: 'Price: Low to High'},
    {value: 'title', label: 'Title (A-Z)'},
  ];
  
  // Listings are already sorted by the loader, but we apply client-side sorting
  // when the user changes the sort option (without reloading)
  const sortedListings = sortBy === initialSortBy 
    ? listings 
    : [...listings].sort((a, b) => {
        switch (sortBy) {
          case 'newest':
            return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
          case 'oldest':
            return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
          case 'price_high':
            return parseFloat(b.price) - parseFloat(a.price);
          case 'price_low':
            return parseFloat(a.price) - parseFloat(b.price);
          case 'title':
            return a.title.localeCompare(b.title);
          default:
            return 0;
        }
      });
  
  return (
    <div className="bg-white dark:bg-gray-900 min-h-screen">
      {/* Header/Banner Area - Twitter-like */}
      <div className="bg-gray-200 dark:bg-gray-800 h-48 sm:h-64 relative overflow-hidden">
        {creator.coverImageUrl ? (
          <img
            src={creator.coverImageUrl}
            alt={`${creator.display_name ? decodeHTMLEntities(creator.display_name) : creator.handle} cover`}
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback to gray background if image fails to load
              e.target.style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full bg-gray-200 dark:bg-gray-800" />
        )}
      </div>
      
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        {/* Profile Section */}
        <div className="relative -mt-20 sm:-mt-24">
          {/* Profile Image */}
          <div className="relative inline-block">
            <img
              src={profileImageUrl}
              alt={creator.display_name ? decodeHTMLEntities(creator.display_name) : creator.handle}
              className="size-32 sm:size-40 rounded-full border-4 border-white dark:border-gray-900 bg-white dark:bg-gray-800 object-cover"
              onError={(e) => {
                e.target.src = 'https://via.placeholder.com/150?text=No+Image';
              }}
            />
            {isVerified && (
              <div className="absolute bottom-0 right-0 bg-blue-500 rounded-full p-1 border-2 border-white dark:border-gray-900">
                <svg className="size-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>
          
          {/* Share Button */}
          <div className="absolute top-4 right-4">
            <button
              onClick={handleShare}
              className="inline-flex items-center gap-2 rounded-full border border-gray-300 dark:border-white/20 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {copied ? (
                <>
                  <svg className="size-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </>
              )}
            </button>
          </div>
        </div>
        
        {/* Creator Info */}
        <div className="mt-4 pb-6 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                  {creator.display_name ? decodeHTMLEntities(creator.display_name) : creator.handle}
                </h1>
                {isVerified && (
                  <span className="inline-flex items-center" title="Verified Creator">
                    <svg className="size-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </span>
                )}
              </div>
              
              <p className="text-gray-500 dark:text-gray-400 mb-3">
                @{creator.handle}
              </p>
              
              {creator.bio && (
                <p className="text-gray-900 dark:text-white mb-3 whitespace-pre-wrap">
                  {decodeHTMLEntities(creator.bio)}
                </p>
              )}
              
              {/* Join Date */}
              {creator.created_at && (
                <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Joined {formatDate(creator.created_at)}</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Social Share Links */}
          <div className="mt-4 flex items-center gap-4">
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
              aria-label="Share on Facebook"
            >
              <svg className="size-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M20 10c0-5.523-4.477-10-10-10S0 4.477 0 10c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V10h2.54V7.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V10h2.773l-.443 2.89h-2.33v6.988C16.343 19.128 20 14.991 20 10z" clipRule="evenodd" />
              </svg>
            </a>
            <a
              href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`${creator.display_name ? decodeHTMLEntities(creator.display_name) : creator.handle} on WornVault`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
              aria-label="Share on X"
            >
              <svg className="size-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M11.4678 8.77491L17.2961 2H15.915L10.8543 7.88256L6.81232 2H2.15039L8.26263 10.8955L2.15039 18H3.53159L8.87581 11.7878L13.1444 18H17.8063L11.4675 8.77491H11.4678ZM9.57608 10.9738L8.95678 10.0881L4.02925 3.03974H6.15068L10.1273 8.72795L10.7466 9.61374L15.9156 17.0075H13.7942L9.57608 10.9742V10.9738Z" />
              </svg>
            </a>
          </div>
        </div>
        
        {/* Products Section */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Products ({listings.length})
            </h2>
            
            {/* Sort Menu */}
            {listings.length > 0 && (
              <Menu as="div" className="relative inline-block">
                <MenuButton className="group inline-flex justify-center text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
                  Sort
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="-mr-1 ml-1 size-5 shrink-0 text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-400"
                  />
                </MenuButton>
                <MenuItems
                  transition
                  className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white dark:bg-gray-800 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 transition focus:outline-hidden data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-100 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
                >
                  <div className="py-1">
                    {sortOptions.map((option) => (
                      <MenuItem key={option.value}>
                        {({focus}) => (
                          <button
                            type="button"
                            onClick={() => setSortBy(option.value)}
                            className={`${
                              sortBy === option.value
                                ? 'font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700'
                                : 'text-gray-500 dark:text-gray-400'
                            } ${
                              focus
                                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                                : ''
                            } block w-full text-left px-4 py-2 text-sm`}
                          >
                            {option.label}
                          </button>
                        )}
                      </MenuItem>
                    ))}
                  </div>
                </MenuItems>
              </Menu>
            )}
          </div>
          
          {/* Products Grid */}
          {sortedListings.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">
                No products available at the moment.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:gap-x-8">
              {sortedListings.map((listing, index) => {
                const isValidImage = validateImageUrl(listing.thumbnailUrl);
                const imageUrl = isValidImage 
                  ? listing.thumbnailUrl 
                  : 'https://via.placeholder.com/400x400?text=No+Image';
                
                return (
                  <div key={listing.id} className="group relative">
                    <Link to={`/listings/${listing.id}`} prefetch="intent" className="block">
                      <img
                        alt={listing.title || 'Product image'}
                        src={imageUrl}
                        loading={index < 6 ? 'eager' : 'lazy'}
                        decoding="async"
                        className="aspect-square w-full rounded-md bg-gray-200 dark:bg-gray-800 object-cover group-hover:opacity-75 lg:aspect-auto lg:h-80"
                        onError={(e) => {
                          e.target.src = 'https://via.placeholder.com/400x400?text=No+Image';
                        }}
                      />
                    </Link>
                    <div className="mt-4 flex justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm text-gray-700 dark:text-gray-300">
                          <Link to={`/listings/${listing.id}`} prefetch="intent" className="hover:text-indigo-600 dark:hover:text-indigo-400">
                            <span aria-hidden="true" className="absolute inset-0" />
                            <span className="line-clamp-2">{listing.title}</span>
                          </Link>
                        </h3>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white ml-2 flex-shrink-0">
                        {listing.priceFormatted}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Error boundary for creator profile page
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isDev = process.env.NODE_ENV === 'development';
  
  let errorMessage = 'Something went wrong';
  let errorStatus = 500;
  
  if (isRouteErrorResponse(error)) {
    errorStatus = error.status;
    if (errorStatus === 404) {
      errorMessage = 'Creator not found';
    } else {
      errorMessage = isDev 
        ? (error?.data?.message ?? error.data ?? 'An error occurred')
        : 'We encountered an error loading this creator profile. Please try again later.';
    }
  } else if (error instanceof Error && isDev) {
    errorMessage = error.message;
  }
  
  if (!isDev) {
    console.error('ErrorBoundary caught:', error);
  }
  
  return (
    <div className="bg-white dark:bg-gray-900 min-h-screen">
      <div className="mx-auto max-w-4xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 sm:pb-24 lg:px-8">
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <h2 className="text-lg font-medium text-red-800 dark:text-red-200 mb-2">
            {errorStatus === 404 ? 'Creator Not Found' : 'Something went wrong'}
          </h2>
          <p className="text-sm text-red-700 dark:text-red-300">
            {errorMessage}
          </p>
          {errorStatus === 404 && (
            <Link
              to="/shop"
              className="mt-4 inline-block text-sm font-medium text-red-800 dark:text-red-200 hover:underline"
            >
              Browse all products →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creators.$handle').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */