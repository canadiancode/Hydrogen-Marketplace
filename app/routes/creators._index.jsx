import {useLoaderData, Link, useRouteError, isRouteErrorResponse} from 'react-router';
import {fetchAllCreators, createServerSupabaseClient} from '~/lib/supabase';
import {decodeHTMLEntities} from '~/lib/html-entities';
import {Breadcrumbs} from '~/components/Breadcrumbs';

/**
 * @type {Route.MetaFunction}
 */
export const meta = ({data}) => {
  return [
    {title: 'Creators | WornVault'},
    {name: 'description', content: 'Discover creators on WornVault'},
  ];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({context}) {
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase configuration for creators page.');
    return {
      creators: [],
      error: 'Server configuration error',
    };
  }
  
  try {
    // Fetch all creators
    const creators = await fetchAllCreators(supabaseUrl, serviceRoleKey);
    
    // Fetch all creator verifications in one query for efficiency
    const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
    const creatorIds = creators.map(c => c.id);
    
    let verificationsMap = {};
    if (creatorIds.length > 0) {
      const {data: verifications, error: verificationError} = await supabase
        .from('creator_verifications')
        .select('creator_id, submitted_links')
        .in('creator_id', creatorIds);
      
      if (!verificationError && verifications) {
        // Create a map of creator_id -> submitted_links
        verifications.forEach(verification => {
          if (verification.submitted_links) {
            verificationsMap[verification.creator_id] = verification.submitted_links;
          }
        });
      }
    }
    
    // Fetch OAuth-verified platforms from creators table
    let creatorsDataMap = {};
    if (creatorIds.length > 0) {
      const {data: creatorsData, error: creatorsError} = await supabase
        .from('creators')
        .select('id,x_url,x_username,x_verified,instagram_url,instagram_username,instagram_verified,tiktok_url,tiktok_username,tiktok_verified,youtube_url,youtube_username,youtube_verified,twitch_url,twitch_username,twitch_verified')
        .in('id', creatorIds);
      
      if (!creatorsError && creatorsData) {
        creatorsData.forEach(creator => {
          creatorsDataMap[creator.id] = creator;
        });
      }
    }
    
    // Process creators to add image URLs and social links
    const processedCreators = creators.map(creator => {
      // Construct cover image URL from storage path if available
      let coverImageUrl = null;
      if (creator.cover_image_storage_path) {
        const storagePath = creator.cover_image_storage_path;
        // If it's already a full URL, use it as-is
        if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
          coverImageUrl = storagePath;
        } else {
          // Construct the public URL from storage path
          const supabaseUrlClean = supabaseUrl.replace(/\/$/, '');
          coverImageUrl = `${supabaseUrlClean}/storage/v1/object/public/creator-cover-images/${storagePath}`;
        }
      }
      
      // Use default Tailwind image if no cover image
      if (!coverImageUrl) {
        coverImageUrl = 'https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?ixlib=rb-1.2.1&ixid=MXwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHw%3D&auto=format&fit=crop&w=512&q=80';
      }
      
      // Validate and use profile image URL
      let profileImageUrl = creator.profile_image_url;
      if (!profileImageUrl || !validateImageUrl(profileImageUrl)) {
        profileImageUrl = 'https://via.placeholder.com/150?text=No+Image';
      }
      
      // Extract social links from verification data AND creators table
      let creatorSocialLinks = null;
      const submittedLinks = verificationsMap[creator.id];
      const creatorData = creatorsDataMap[creator.id];
      
      // Merge both sources (OAuth-verified takes precedence)
      const socialLinks = {
        instagram: submittedLinks?.instagram_url || submittedLinks?.instagram || null,
        facebook: submittedLinks?.facebook_url || submittedLinks?.facebook || null,
        tiktok: submittedLinks?.tiktok_url || submittedLinks?.tiktok || null,
        x: submittedLinks?.x_url || submittedLinks?.x || null,
        youtube: submittedLinks?.youtube_url || submittedLinks?.youtube || null,
        twitch: submittedLinks?.twitch_url || submittedLinks?.twitch || null,
      };
      
      // Override with OAuth-verified data from creators table (takes precedence)
      if (creatorData) {
        const platforms = ['instagram', 'tiktok', 'x', 'youtube', 'twitch'];
        platforms.forEach((platform) => {
          const urlField = `${platform}_url`;
          if (creatorData[urlField]) {
            socialLinks[platform] = creatorData[urlField];
          }
        });
      }
      
      // Only set creatorSocialLinks if at least one platform has a URL
      if (Object.values(socialLinks).some(url => url)) {
        creatorSocialLinks = socialLinks;
      }
      
      return {
        ...creator,
        coverImageUrl,
        profileImageUrl,
        socialLinks: creatorSocialLinks,
      };
    });
    
    return {
      creators: processedCreators,
    };
  } catch (error) {
    console.error('Error loading creators:', error);
    return {
      creators: [],
      error: 'Failed to load creators',
    };
  }
}

/**
 * Validates that an image URL is safe to use
 * @param {string} url - The URL to validate
 * @returns {boolean} True if the URL is valid and safe
 */
function validateImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const allowedDomains = [
      'supabase.co',
      'via.placeholder.com',
      'cdn.shopify.com',
      'images.unsplash.com',
    ];
    return allowedDomains.some(domain => parsed.hostname.includes(domain));
  } catch {
    return false;
  }
}

export default function CreatorsPage() {
  const {creators, error} = useLoaderData();
  
  if (error) {
    return (
      <div className="bg-white dark:bg-gray-900 min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-white dark:bg-gray-900 min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Breadcrumbs */}
        <div className="mb-8">
          <Breadcrumbs />
        </div>
        
        <div className="mb-12 pb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            Creators
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Discover creators on WornVault
          </p>
        </div>
        
        {creators.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              No creators available at the moment.
            </p>
          </div>
        ) : (
          <CreatorsGrid creators={creators} />
        )}
      </div>
    </div>
  );
}

/**
 * CreatorsGrid Component
 * Displays creators in a grid following Tailwind template
 * @param {{creators: Array}} props
 */
function CreatorsGrid({creators}) {
  return (
    <ul role="list" className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 xl:gap-x-8">
      {creators.map((creator) => {
        const displayName = creator.display_name 
          ? decodeHTMLEntities(creator.display_name) 
          : creator.handle || 'Unknown Creator';
        
        return (
          <li key={creator.id} className="relative">
            <Link 
              to={`/creators/${creator.handle}`} 
              prefetch="intent"
              className="group block rounded-lg bg-gray-100 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600 dark:bg-gray-800 dark:focus-within:outline-indigo-500 relative sm:pb-20"
            >
              <span className="sr-only">View details for {displayName}</span>
              {/* Background Image - Square aspect ratio */}
              <div className="relative aspect-square overflow-hidden rounded-lg">
                <img
                  alt={`${displayName} cover`}
                  src={creator.coverImageUrl}
                  className="pointer-events-none w-full h-full object-cover outline -outline-offset-1 outline-black/5 group-hover:opacity-75 dark:outline-white/10"
                  onError={(e) => {
                    // Fallback to default image if cover image fails
                    e.target.src = 'https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?ixlib=rb-1.2.1&ixid=MXwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHw%3D&auto=format&fit=crop&w=512&q=80';
                  }}
                />
                
                {/* Circular Profile Photo Overlay - positioned at bottom center, protruding more */}
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                  <div className="relative size-20 sm:size-24 rounded-full overflow-hidden border border-white dark:border-gray-900 bg-white dark:bg-gray-800 shadow-lg">
                    <img
                      alt={displayName}
                      src={creator.profileImageUrl}
                      className="w-full h-full object-cover pointer-events-none"
                      onError={(e) => {
                        e.target.src = 'https://via.placeholder.com/150?text=No+Image';
                      }}
                    />
                    {/* Verification Badge */}
                    {creator.verification_status === 'verified' && (
                      <div className="absolute bottom-0 right-0 bg-blue-500 rounded-full p-1 border-2 border-white dark:border-gray-900">
                        <svg className="size-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Creator Info - moved inside Link to make entire card clickable */}
              <div className="mt-10 sm:mt-12 text-center px-2 pb-4 sm:pb-6 flex flex-col">
                <p className="pointer-events-none block truncate text-sm font-medium text-gray-900 dark:text-white">
                  {displayName}
                </p>
                <p className="pointer-events-none block text-sm font-medium text-gray-500 dark:text-gray-400">
                  @{creator.handle}
                </p>
                
                {/* Social Media Icons */}
                {creator.socialLinks && Object.values(creator.socialLinks).some(url => url) && (
                  <div className="mt-4 flex items-center justify-center gap-3 pointer-events-auto">
                    {creator.socialLinks.instagram && (
                      <a
                        href={creator.socialLinks.instagram}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-pink-600 dark:text-gray-500 dark:hover:text-pink-400 transition-colors"
                        aria-label="Instagram"
                      >
                        <svg fill="currentColor" viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                          <path
                            fillRule="evenodd"
                            d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </a>
                    )}
                    {creator.socialLinks.facebook && (
                      <a
                        href={creator.socialLinks.facebook}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
                        aria-label="Facebook"
                      >
                        <svg fill="currentColor" viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                          <path
                            fillRule="evenodd"
                            d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </a>
                    )}
                    {creator.socialLinks.tiktok && (
                      <a
                        href={creator.socialLinks.tiktok}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-black dark:text-gray-500 dark:hover:text-white transition-colors"
                        aria-label="TikTok"
                      >
                        <svg fill="currentColor" viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
                        </svg>
                      </a>
                    )}
                    {creator.socialLinks.x && (
                      <a
                        href={creator.socialLinks.x}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-white transition-colors"
                        aria-label="X (Twitter)"
                      >
                        <svg fill="currentColor" viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                          <path d="M13.6823 10.6218L20.2391 3H18.6854L12.9921 9.61788L8.44486 3H3.2002L10.0765 13.0074L3.2002 21H4.75404L10.7663 14.0113L15.5685 21H20.8131L13.6819 10.6218H13.6823ZM11.5541 13.0956L10.8574 12.0991L5.31391 4.16971H7.70053L12.1742 10.5689L12.8709 11.5655L18.6861 19.8835H16.2995L11.5541 13.096V13.0956Z" />
                        </svg>
                      </a>
                    )}
                    {creator.socialLinks.youtube && (
                      <a
                        href={creator.socialLinks.youtube}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
                        aria-label="YouTube"
                      >
                        <svg fill="currentColor" viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                          <path
                            fillRule="evenodd"
                            d="M19.812 5.418c.861.23 1.538.907 1.768 1.768C21.998 8.746 22 12 22 12s0 3.255-.418 4.814a2.504 2.504 0 0 1-1.768 1.768c-1.56.419-7.814.419-7.814.419s-6.255 0-7.814-.419a2.505 2.505 0 0 1-1.768-1.768C2 15.255 2 12 2 12s0-3.255.417-4.814a2.507 2.507 0 0 1 1.768-1.768C5.744 5 11.998 5 11.998 5s6.255 0 7.814.418ZM15.194 12 10 15V9l5.194 3Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </a>
                    )}
                    {creator.socialLinks.twitch && (
                      <a
                        href={creator.socialLinks.twitch}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-purple-600 dark:text-gray-500 dark:hover:text-purple-400 transition-colors"
                        aria-label="Twitch"
                      >
                        <svg fill="currentColor" viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                          <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                        </svg>
                      </a>
                    )}
                  </div>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Error boundary for creators page
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isDev = process.env.NODE_ENV === 'development';
  
  let errorMessage = 'Something went wrong';
  let errorStatus = 500;
  
  if (isRouteErrorResponse(error)) {
    errorStatus = error.status;
    errorMessage = isDev 
      ? (error?.data?.message ?? error.data ?? 'An error occurred')
      : 'We encountered an error loading creators. Please try again later.';
  } else if (error instanceof Error && isDev) {
    errorMessage = error.message;
  }
  
  if (!isDev) {
    console.error('ErrorBoundary caught:', error);
  }
  
  return (
    <div className="bg-white dark:bg-gray-900 min-h-screen">
      <div className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 sm:pb-24 lg:px-8">
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <h2 className="text-lg font-medium text-red-800 dark:text-red-200 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-red-700 dark:text-red-300">
            {errorMessage}
          </p>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creators._index').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

