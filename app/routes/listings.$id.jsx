import {Fragment, useState} from 'react';
import {useLoaderData, Link} from 'react-router';
import {Tab, TabGroup, TabList, TabPanel, TabPanels} from '@headlessui/react';
import {fetchPublicListingById} from '~/lib/supabase';
import {sanitizeHTML} from '~/lib/sanitize';
import {decodeHTMLEntities} from '~/lib/html-entities';
import {BuyNowButton} from '~/components/BuyNowButton';

export const meta = ({data}) => {
  return [
    {title: `${data?.listing?.title || 'Product'} | WornVault`},
    {
      rel: 'canonical',
      href: `/listings/${data?.listing?.id}`,
    },
  ];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({context, params}) {
  const {id} = params;
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase configuration for listing page.');
    throw new Response('Server configuration error', {status: 500});
  }
  
  if (!id) {
    throw new Response('Listing ID is required', {status: 400});
  }
  
  // Fetch the listing (only returns if status is 'live')
  const listing = await fetchPublicListingById(id, supabaseUrl, serviceRoleKey);
  
  if (!listing) {
    throw new Response('Listing not found', {status: 404});
  }
  
  return {
    listing,
  };
}

function classNames(...classes) {
  return classes.filter(Boolean).join(' ');
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function ListingDetail() {
  const {listing} = useLoaderData();
  const [copied, setCopied] = useState(false);
  
  if (!listing) {
    return null;
  }
  
  const mainImage = listing.photos?.[0]?.publicUrl || 'https://via.placeholder.com/800x600?text=No+Image';
  
  // Get share URL - will be set properly on client side
  const getShareUrl = () => {
    if (typeof window !== 'undefined') {
      return window.location.href;
    }
    return '';
  };
  
  const handleShare = async () => {
    const shareUrl = getShareUrl();
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: listing.title,
          text: `Check out ${listing.title} on WornVault`,
          url: shareUrl,
        });
      } catch (err) {
        // User cancelled or error occurred
        console.log('Share cancelled or failed');
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy URL');
      }
    }
  };
  
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  
  return (
    <div className="bg-white dark:bg-gray-900">
      <div className="mx-auto px-4 py-16 sm:px-6 sm:py-24 lg:max-w-7xl lg:px-8">
        {/* Product */}
        <div className="lg:grid lg:grid-cols-7 lg:grid-rows-1 lg:gap-x-8 lg:gap-y-10 xl:gap-x-16">
          {/* Product image */}
          <div className="lg:col-span-4 lg:row-end-1">
            <img
              alt={listing.title || 'Product image'}
              src={mainImage}
              className="aspect-4/3 w-full rounded-lg bg-gray-100 dark:bg-gray-800 object-cover"
            />
          </div>

          {/* Product details */}
          <div className="mx-auto mt-14 max-w-2xl sm:mt-16 lg:col-span-3 lg:row-span-2 lg:row-end-2 lg:mt-0 lg:max-w-none">
            <div className="flex flex-col-reverse">
              <div className="mt-4">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-3xl">
                  {listing.title}
                </h1>

                <h2 id="information-heading" className="sr-only">
                  Product information
                </h2>
                
                {/* Date Posted */}
                {listing.created_at && (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Posted on <time dateTime={listing.created_at}>{formatDate(listing.created_at)}</time>
                  </p>
                )}
                
                {/* Category */}
                {listing.category && (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Category: <span className="font-medium text-gray-900 dark:text-white">{listing.category}</span>
                  </p>
                )}
                
                {/* Condition */}
                {listing.condition && (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Condition: <span className="font-medium text-gray-900 dark:text-white">{listing.condition}</span>
                  </p>
                )}

                {/* Price */}
                <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">
                  ${listing.price}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {listing.shopify_variant_id ? (
                <BuyNowButton
                  variantId={listing.shopify_variant_id}
                  quantity={1}
                  className="flex w-full items-center justify-center rounded-md border border-transparent bg-indigo-600 dark:bg-indigo-500 px-8 py-3 text-base font-medium text-white hover:bg-indigo-700 dark:hover:bg-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-900 focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Buy Now
                </BuyNowButton>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex w-full items-center justify-center rounded-md border border-transparent bg-gray-400 dark:bg-gray-600 px-8 py-3 text-base font-medium text-white cursor-not-allowed opacity-50"
                  title="This item is not available for purchase yet"
                >
                  Buy Now (Unavailable)
                </button>
              )}
              <button
                type="button"
                className="flex w-full items-center justify-center rounded-md border border-transparent bg-indigo-50 dark:bg-indigo-900/20 px-8 py-3 text-base font-medium text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-900 focus:outline-hidden"
              >
                Add to Cart
              </button>
            </div>

            {/* Share Section */}
            <div className="mt-10 border-t border-gray-200 dark:border-white/10 pt-10">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">Share</h3>
              <ul role="list" className="mt-4 flex items-center space-x-6">
                <li>
                  <button
                    onClick={handleShare}
                    className="flex size-6 items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400"
                    aria-label="Share this product"
                  >
                    {copied ? (
                      <span className="text-sm text-green-600 dark:text-green-400">Copied!</span>
                    ) : (
                      <svg fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" className="size-5">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    )}
                  </button>
                </li>
                <li>
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex size-6 items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400"
                  >
                    <span className="sr-only">Share on Facebook</span>
                    <svg fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" className="size-5">
                      <path
                        d="M20 10c0-5.523-4.477-10-10-10S0 4.477 0 10c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V10h2.54V7.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V10h2.773l-.443 2.89h-2.33v6.988C16.343 19.128 20 14.991 20 10z"
                        clipRule="evenodd"
                        fillRule="evenodd"
                      />
                    </svg>
                  </a>
                </li>
                <li>
                  <a
                    href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(listing.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex size-6 items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400"
                  >
                    <span className="sr-only">Share on X</span>
                    <svg fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" className="size-5">
                      <path d="M11.4678 8.77491L17.2961 2H15.915L10.8543 7.88256L6.81232 2H2.15039L8.26263 10.8955L2.15039 18H3.53159L8.87581 11.7878L13.1444 18H17.8063L11.4675 8.77491H11.4678ZM9.57608 10.9738L8.95678 10.0881L4.02925 3.03974H6.15068L10.1273 8.72795L10.7466 9.61374L15.9156 17.0075H13.7942L9.57608 10.9742V10.9738Z" />
                    </svg>
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Tabs Section */}
          <div className="mx-auto mt-16 w-full max-w-2xl lg:col-span-4 lg:mt-0 lg:max-w-none">
            <TabGroup>
              <div className="border-b border-gray-200 dark:border-white/10">
                <TabList className="-mb-px flex space-x-8">
                  <Tab className="border-b-2 border-transparent py-6 text-sm font-medium whitespace-nowrap text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:text-gray-800 dark:hover:text-gray-200 data-selected:border-indigo-600 dark:data-selected:border-indigo-400 data-selected:text-indigo-600 dark:data-selected:text-indigo-400">
                    Product Description
                  </Tab>
                  <Tab className="border-b-2 border-transparent py-6 text-sm font-medium whitespace-nowrap text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:text-gray-800 dark:hover:text-gray-200 data-selected:border-indigo-600 dark:data-selected:border-indigo-400 data-selected:text-indigo-600 dark:data-selected:text-indigo-400">
                    Creator Profile
                  </Tab>
                </TabList>
              </div>
              <TabPanels as={Fragment}>
                {/* Product Description Tab */}
                <TabPanel className="-mb-10 pt-10">
                  <h3 className="sr-only">Product Description</h3>
                  {listing.story ? (
                    <div
                      className="prose prose-sm max-w-none text-gray-500 dark:text-gray-400 [&_p]:my-2 [&_p]:text-sm/6"
                      dangerouslySetInnerHTML={{__html: sanitizeHTML(listing.story)}}
                    />
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No description available.</p>
                  )}
                </TabPanel>

                {/* Creator Profile Tab */}
                <TabPanel className="pt-10">
                  <h3 className="sr-only">Creator Profile</h3>
                  {listing.creator ? (
                    <div className="space-y-0">
                      {/* Header/Banner Area - Twitter-like */}
                      <div className="bg-gray-200 dark:bg-gray-800 h-48 sm:h-64 relative overflow-hidden">
                        {listing.creator.coverImageUrl ? (
                          <img
                            src={listing.creator.coverImageUrl}
                            alt={`${listing.creator.display_name ? decodeHTMLEntities(listing.creator.display_name) : 'Creator'} cover`}
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
                      
                      {/* Profile Section - Overlapping Cover */}
                      <div className="relative -mt-20 sm:-mt-24">
                        {/* Profile Image */}
                        <div className="relative inline-block">
                          {listing.creator.profile_image_url ? (
                            <img
                              src={listing.creator.profile_image_url}
                              alt={listing.creator.display_name ? decodeHTMLEntities(listing.creator.display_name) : 'Creator'}
                              className="size-32 sm:size-40 rounded-full border-4 border-white dark:border-gray-900 bg-white dark:bg-gray-800 object-cover"
                              onError={(e) => {
                                e.target.src = 'https://via.placeholder.com/150?text=No+Image';
                              }}
                            />
                          ) : (
                            <div className="size-32 sm:size-40 rounded-full border-4 border-white dark:border-gray-900 bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                              <svg className="size-16 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Creator Info */}
                      <div className="mt-4 pb-6 border-b border-gray-200 dark:border-white/10">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                                {listing.creator.display_name ? decodeHTMLEntities(listing.creator.display_name) : 'Unknown Creator'}
                              </h4>
                            </div>
                            
                            {listing.creator.handle && (
                              <p className="text-gray-500 dark:text-gray-400 mb-3">
                                @{listing.creator.handle}
                              </p>
                            )}
                            
                            {listing.creator.bio && (
                              <p className="text-gray-900 dark:text-white mb-3 whitespace-pre-wrap">
                                {decodeHTMLEntities(listing.creator.bio)}
                              </p>
                            )}
                          </div>
                          
                          {/* Social Share Links */}
                          <div className="ml-4 flex items-center gap-4 flex-shrink-0">
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
                              href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`${listing.creator.display_name ? decodeHTMLEntities(listing.creator.display_name) : 'Creator'} on WornVault`)}`}
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
                        
                        {/* View Full Profile Link */}
                        <div className="mt-4">
                          <Link
                            to={`/creators/${listing.creator.handle || listing.creator.id}`}
                            className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300"
                          >
                            View full profile →
                          </Link>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Creator information not available.</p>
                  )}
                </TabPanel>

              </TabPanels>
            </TabGroup>
          </div>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/listings.$id').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
