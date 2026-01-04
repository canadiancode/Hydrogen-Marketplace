import {Fragment, useState} from 'react';
import {useLoaderData, Link} from 'react-router';
import {Tab, TabGroup, TabList, TabPanel, TabPanels} from '@headlessui/react';
import {startTransition} from 'react';
import {fetchPublicListingById} from '~/lib/supabase';
import {sanitizeHTML} from '~/lib/sanitize';
import {decodeHTMLEntities} from '~/lib/html-entities';
import {BuyNowButton} from '~/components/BuyNowButton';
import {AddToCartButton} from '~/components/AddToCartButton';
import {useAside} from '~/components/Aside';
import {useCartDrawer} from '~/components/CartDrawer';
import {Breadcrumbs} from '~/components/Breadcrumbs';

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
  
  // Fetch creator's social links from creator_verifications
  let creatorSocialLinks = null;
  if (listing.creator?.id) {
    const {createServerSupabaseClient} = await import('~/lib/supabase');
    const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
    
    const {data: verification, error: verificationError} = await supabase
      .from('creator_verifications')
      .select('submitted_links')
      .eq('creator_id', listing.creator.id)
      .order('created_at', {ascending: false})
      .limit(1)
      .maybeSingle();
    
    if (!verificationError && verification?.submitted_links) {
      const submittedLinks = verification.submitted_links;
      creatorSocialLinks = {
        instagram: submittedLinks.instagram_url || submittedLinks.instagram || null,
        facebook: submittedLinks.facebook_url || submittedLinks.facebook || null,
        tiktok: submittedLinks.tiktok_url || submittedLinks.tiktok || null,
        x: submittedLinks.x_url || submittedLinks.x || null,
        youtube: submittedLinks.youtube_url || submittedLinks.youtube || null,
        twitch: submittedLinks.twitch_url || submittedLinks.twitch || null,
      };
    }
  }
  
  // Fetch Shopify variant data if shopify_variant_id or shopify_product_id exists
  let shopifyVariant = null;
  let variantIdGid = null;
  
  if (!context.storefront) {
    console.warn('[Listing Loader] Storefront API not available');
  } else if (listing.shopify_variant_id) {
    // We have variant ID directly - use it
    variantIdGid = listing.shopify_variant_id.startsWith('gid://')
      ? listing.shopify_variant_id
      : `gid://shopify/ProductVariant/${listing.shopify_variant_id.split('/').pop()}`;
    
    // Try to fetch full variant data from Storefront API (optional - for availability check)
    try {
      const response = await context.storefront.query(VARIANT_QUERY, {
        variables: {id: variantIdGid},
      });
      
      // Hydrogen's storefront.query returns data directly
      const node = response?.node;
      const errors = response?.errors;
      
      if (errors) {
        console.error('[Listing Loader] Variant query errors:', errors);
      }
      
      if (!errors && node?.__typename === 'ProductVariant') {
        shopifyVariant = node;
      } else if (node) {
        console.warn('[Listing Loader] Node is not ProductVariant:', node.__typename);
      }
    } catch (error) {
      // Log but don't fail - we can still use the variant ID
      console.error('[Listing Loader] Failed to fetch Shopify variant details:', error);
    }
  } else if (listing.shopify_product_id) {
    // We only have product ID - fetch the first variant from the product
    try {
      const productIdGid = listing.shopify_product_id.startsWith('gid://')
        ? listing.shopify_product_id
        : `gid://shopify/Product/${listing.shopify_product_id.split('/').pop()}`;
      
      console.log('[Listing Loader] Querying Storefront API for product:', productIdGid);
      
      // Hydrogen's storefront.query returns data directly, not wrapped in a 'data' property
      const response = await context.storefront.query(PRODUCT_VARIANT_QUERY, {
        variables: {id: productIdGid},
      });
      
      // Response structure: {node: {...}, errors: [...]} or {errors: [...]}
      const node = response?.node;
      const errors = response?.errors;
      
      console.log('[Listing Loader] Storefront API response:', {
        hasResponse: !!response,
        responseKeys: response ? Object.keys(response) : [],
        hasNode: !!node,
        nodeType: node?.__typename,
        nodeKeys: node ? Object.keys(node) : [],
        hasErrors: !!errors,
        errors: errors,
        variantsCount: node?.variants?.nodes?.length || 0,
        fullNode: JSON.stringify(node, null, 2).substring(0, 1000),
      });
      
      if (errors) {
        console.error('[Listing Loader] Product variant query errors:', JSON.stringify(errors, null, 2));
      }
      
      if (!errors && node?.__typename === 'Product') {
        const variants = node.variants?.nodes || [];
        console.log('[Listing Loader] Found variants:', variants.length, variants.map(v => ({id: v.id, available: v.availableForSale})));
        
        if (variants.length > 0) {
          const firstVariant = variants[0];
          shopifyVariant = firstVariant;
          variantIdGid = firstVariant.id;
          
          console.log('[Listing Loader] Successfully set variant:', variantIdGid);
          
          // Optionally update the listing with the variant ID for future requests
          // (This is a non-blocking operation, don't await it)
          if (listing.id) {
            const {createServerSupabaseClient} = await import('~/lib/supabase');
            const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
            supabase
              .from('listings')
              .update({shopify_variant_id: variantIdGid})
              .eq('id', listing.id)
              .then(() => {
                console.log('[Listing Loader] Updated listing with variant ID:', listing.id);
              })
              .catch((err) => {
                console.warn('[Listing Loader] Failed to update listing with variant ID:', err.message);
              });
          }
        } else {
          console.warn('[Listing Loader] Product has no variants in response');
        }
      } else if (node) {
        console.warn('[Listing Loader] Node is not Product:', node.__typename);
      } else if (!node) {
        console.warn('[Listing Loader] No node returned - product may not be available in Storefront API yet');
        
        // Fallback: Try to get variant ID from Admin API if Storefront API fails
        // This handles cases where product exists but isn't synced to Storefront API yet
        try {
          const shopifyClientId = context.env.SHOPIFY_ADMIN_CLIENT_ID;
          const shopifyClientSecret = context.env.SHOPIFY_ADMIN_CLIENT_SECRET;
          const storeDomain = context.env.PUBLIC_STORE_DOMAIN;
          
          if (shopifyClientId && shopifyClientSecret && storeDomain) {
            // Import Admin API helper to get access token
            const {getAdminAccessToken} = await import('~/lib/shopify-admin');
            
            // Get access token (this function is not exported, so we'll need to create a helper)
            // Actually, let's create a simple inline function to get the variant ID
            const adminTokenResponse = await fetch(
              `https://${storeDomain}/admin/oauth/access_token`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  client_id: shopifyClientId,
                  client_secret: shopifyClientSecret,
                  grant_type: 'client_credentials',
                }),
              }
            );
            
            if (adminTokenResponse.ok) {
              const tokenData = await adminTokenResponse.json();
              const adminAccessToken = tokenData.access_token;
              
              if (adminAccessToken) {
                // Query Admin API for product variants
                const adminQuery = `
                  query getProduct($id: ID!) {
                    product(id: $id) {
                      id
                      variants(first: 1) {
                        edges {
                          node {
                            id
                          }
                        }
                      }
                    }
                  }
                `;
                
                const adminResponse = await fetch(
                  `https://${storeDomain}/admin/api/2024-10/graphql.json`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-Shopify-Access-Token': adminAccessToken,
                    },
                    body: JSON.stringify({
                      query: adminQuery,
                      variables: {id: productIdGid},
                    }),
                  }
                );
                
                if (adminResponse.ok) {
                  const adminResult = await adminResponse.json();
                  
                  if (!adminResult.errors && adminResult.data?.product?.variants?.edges?.[0]?.node?.id) {
                    const adminVariantId = adminResult.data.product.variants.edges[0].node.id;
                    variantIdGid = adminVariantId;
                    
                    console.log('[Listing Loader] Got variant ID from Admin API fallback:', variantIdGid);
                    
                    // Save variant ID to database for future requests
                    if (listing.id) {
                      const {createServerSupabaseClient} = await import('~/lib/supabase');
                      const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
                      supabase
                        .from('listings')
                        .update({shopify_variant_id: variantIdGid})
                        .eq('id', listing.id)
                        .then(() => {
                          console.log('[Listing Loader] Updated listing with variant ID from Admin API:', listing.id);
                        })
                        .catch((err) => {
                          console.warn('[Listing Loader] Failed to update listing with variant ID:', err.message);
                        });
                    }
                  }
                }
              }
            }
          }
        } catch (adminError) {
          console.warn('[Listing Loader] Admin API fallback failed:', adminError.message);
        }
      }
    } catch (error) {
      // Log but don't fail - listing can still be displayed
      console.error('[Listing Loader] Exception fetching Shopify product variant:', error);
    }
  }
  
  console.log('[Listing Loader] Final variant state:', {
    variantIdGid,
    hasShopifyVariant: !!shopifyVariant,
    shopifyProductId: listing.shopify_product_id,
  });
  
  return {
    listing,
    shopifyVariant,
    variantIdGid,
    creatorSocialLinks,
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
  const {listing, shopifyVariant, variantIdGid, creatorSocialLinks} = useLoaderData();
  const [copied, setCopied] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const {open} = useAside();
  const {setOpen: setCartDrawerOpen} = useCartDrawer();
  
  if (!listing) {
    return null;
  }
  
  const photos = listing.photos || [];
  const mainImage = photos[selectedImageIndex]?.publicUrl || photos[0]?.publicUrl || 'https://via.placeholder.com/800x600?text=No+Image';
  
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
      <div className="mx-auto px-4 py-4 sm:px-6 lg:max-w-7xl lg:px-8">
        {/* Breadcrumbs */}
        <div className="mb-6">
          <Breadcrumbs data={{listing}} />
        </div>
        {/* Product */}
        <div className="lg:grid lg:grid-cols-7 lg:grid-rows-1 lg:gap-x-8 lg:gap-y-10 xl:gap-x-16">
          {/* Product images */}
          <div className="lg:col-span-4 lg:row-end-1">
            {/* Main image */}
            <div className="aspect-4/3 w-full rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden mb-4">
              <img
                alt={listing.title || 'Product image'}
                src={mainImage}
                className="w-full h-full object-cover"
              />
            </div>
            
            {/* Thumbnail gallery */}
            {photos.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {photos.map((photo, index) => (
                  <button
                    key={photo.id || index}
                    type="button"
                    onClick={() => setSelectedImageIndex(index)}
                    className={`aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                      selectedImageIndex === index
                        ? 'border-indigo-600 dark:border-indigo-400'
                        : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <img
                      src={photo.publicUrl}
                      alt={`${listing.title} - Image ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
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
              {variantIdGid ? (
                <>
                  <BuyNowButton
                    variantId={variantIdGid}
                    quantity={1}
                    className="flex w-full items-center justify-center rounded-md border border-transparent bg-indigo-600 dark:bg-indigo-500 px-8 py-3 text-base font-medium text-white hover:bg-indigo-700 dark:hover:bg-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-900 focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Buy Now
                  </BuyNowButton>
                  <AddToCartButton
                    disabled={shopifyVariant?.availableForSale === false}
                    onClick={() => {
                      // Optional: can still open aside if needed for mobile
                      // open('cart');
                    }}
                    onAddToCart={() => {
                      // Open cart drawer when item is successfully added
                      startTransition(() => {
                        setCartDrawerOpen(true);
                      });
                    }}
                    lines={[
                      {
                        merchandiseId: variantIdGid,
                        quantity: 1,
                        attributes: [
                          {
                            key: 'listing_id',
                            value: listing.id,
                          },
                        ],
                        ...(shopifyVariant ? {selectedVariant: shopifyVariant} : {}),
                      },
                    ]}
                    className="flex w-full items-center justify-center rounded-md border border-transparent bg-indigo-50 dark:bg-indigo-900/20 px-8 py-3 text-base font-medium text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-900 focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
                  >
                    {shopifyVariant?.availableForSale === false ? 'Sold Out' : 'Add to Cart'}
                  </AddToCartButton>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled
                    className="flex w-full items-center justify-center rounded-md border border-transparent bg-gray-400 dark:bg-gray-600 px-8 py-3 text-base font-medium text-white cursor-not-allowed opacity-50"
                    title="This item is not available for purchase yet"
                  >
                    Buy Now (Unavailable)
                  </button>
                  <button
                    type="button"
                    disabled
                    className="flex w-full items-center justify-center rounded-md border border-transparent bg-gray-100 dark:bg-gray-800 px-8 py-3 text-base font-medium text-gray-500 dark:text-gray-400 cursor-not-allowed"
                    title="This item is not available for purchase yet"
                  >
                    Add to Cart (Unavailable)
                  </button>
                </>
              )}
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
                          
                          {/* Social Media Links */}
                          {creatorSocialLinks && Object.values(creatorSocialLinks).some(url => url) && (
                            <div className="ml-4 flex items-center gap-4 flex-shrink-0">
                              {creatorSocialLinks.instagram && (
                                <a
                                  href={creatorSocialLinks.instagram}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 dark:text-gray-500 hover:text-pink-600 dark:hover:text-pink-400 transition-colors"
                                  aria-label="Instagram"
                                >
                                  <svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path fillRule="evenodd" d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z" clipRule="evenodd" />
                                  </svg>
                                </a>
                              )}
                              {creatorSocialLinks.facebook && (
                                <a
                                  href={creatorSocialLinks.facebook}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                  aria-label="Facebook"
                                >
                                  <svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" clipRule="evenodd" />
                                  </svg>
                                </a>
                              )}
                              {creatorSocialLinks.tiktok && (
                                <a
                                  href={creatorSocialLinks.tiktok}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 dark:text-gray-500 hover:text-black dark:hover:text-white transition-colors"
                                  aria-label="TikTok"
                                >
                                  <svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
                                  </svg>
                                </a>
                              )}
                              {creatorSocialLinks.x && (
                                <a
                                  href={creatorSocialLinks.x}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
                                  aria-label="X (Twitter)"
                                >
                                  <svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M13.6823 10.6218L20.2391 3H18.6854L12.9921 9.61788L8.44486 3H3.2002L10.0765 13.0074L3.2002 21H4.75404L10.7663 14.0113L15.5685 21H20.8131L13.6819 10.6218H13.6823ZM11.5541 13.0956L10.8574 12.0991L5.31391 4.16971H7.70053L12.1742 10.5689L12.8709 11.5655L18.6861 19.8835H16.2995L11.5541 13.096V13.0956Z" />
                                  </svg>
                                </a>
                              )}
                              {creatorSocialLinks.youtube && (
                                <a
                                  href={creatorSocialLinks.youtube}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                  aria-label="YouTube"
                                >
                                  <svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path fillRule="evenodd" d="M19.812 5.418c.861.23 1.538.907 1.768 1.768C21.998 8.746 22 12 22 12s0 3.255-.418 4.814a2.504 2.504 0 0 1-1.768 1.768c-1.56.419-7.814.419-7.814.419s-6.255 0-7.814-.419a2.505 2.505 0 0 1-1.768-1.768C2 15.255 2 12 2 12s0-3.255.417-4.814a2.507 2.507 0 0 1 1.768-1.768C5.744 5 11.998 5 11.998 5s6.255 0 7.814.418ZM15.194 12 10 15V9l5.194 3Z" clipRule="evenodd" />
                                  </svg>
                                </a>
                              )}
                              {creatorSocialLinks.twitch && (
                                <a
                                  href={creatorSocialLinks.twitch}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 dark:text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                                  aria-label="Twitch"
                                >
                                  <svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                                  </svg>
                                </a>
                              )}
                            </div>
                          )}
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

const VARIANT_FRAGMENT = `#graphql
  fragment VariantFragment on ProductVariant {
    id
    availableForSale
    compareAtPrice {
      amount
      currencyCode
    }
    price {
      amount
      currencyCode
    }
    title
    sku
    image {
      id
      url
      altText
      width
      height
    }
    product {
      id
      title
      handle
      vendor
    }
    selectedOptions {
      name
      value
    }
  }
`;

const VARIANT_QUERY = `#graphql
  query Variant($id: ID!) {
    node(id: $id) {
      ... on ProductVariant {
        ...VariantFragment
      }
    }
  }
  ${VARIANT_FRAGMENT}
`;

const PRODUCT_VARIANT_QUERY = `#graphql
  query ProductVariant($id: ID!) {
    node(id: $id) {
      __typename
      ... on Product {
        id
        variants(first: 1) {
          nodes {
            ...VariantFragment
          }
        }
      }
    }
  }
  ${VARIANT_FRAGMENT}
`;

/** @typedef {import('./+types/listings.$id').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
