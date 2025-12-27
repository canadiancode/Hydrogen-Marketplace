import {useLoaderData} from 'react-router';
import {useEffect} from 'react';
import {startTransition} from 'react';
import {Analytics} from '@shopify/hydrogen';
import {SearchResultsPredictive} from '~/components/SearchResultsPredictive';
import {useSearchModal} from '~/components/SearchModal';
import {getEmptyPredictiveSearchResult} from '~/lib/search';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';
import {createServerSupabaseClient} from '~/lib/supabase';
import {sanitizeHandle, validateHandle} from '~/lib/validation';

/**
 * @type {Route.MetaFunction}
 */
export const meta = ({data}) => {
  const term = data?.term || '';
  return [{title: term ? `Search: ${term} | WornVault` : `Search | WornVault`}];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({request, context}) {
  const url = new URL(request.url);
  
  try {
    // Always use predictive search for /search route (creators and listings)
    return await predictiveSearch({request, context});
  } catch (error) {
    // Sanitize error logging to prevent information disclosure
    const isProduction = context.env?.NODE_ENV === 'production';
    const errorMessage = error.message || 'Unknown error';
    const sanitizedMessage = errorMessage.substring(0, 200); // Limit error message length
    
    console.error('Search error:', {
      message: sanitizedMessage,
      ...(isProduction ? {} : {stack: error.stack}), // Only log stack in development
      url: request.url.substring(0, 200), // Limit URL length in logs
      timestamp: new Date().toISOString(),
    });
    
    return {
      type: 'predictive',
      term: '',
      result: getEmptyPredictiveSearchResult(),
      error: 'An error occurred while searching. Please try again.',
    };
  }
}

/**
 * Renders the /search route - results only page (no search input)
 * Automatically opens search modal if no search term is provided
 */
export default function SearchPage() {
  /** @type {LoaderReturnData} */
  const {term, result, error} = useLoaderData();
  const {setOpen} = useSearchModal();

  // Automatically open search modal if there's no search term
  useEffect(() => {
    if (!term) {
      startTransition(() => {
        setOpen(true);
      });
    }
  }, [term, setOpen]);

  // No-op function for closeSearch since we're not in a modal
  const noOpCloseSearch = () => {};

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
            {term ? `Search Results` : 'Search'}
          </h1>
          {term && result?.total !== undefined && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {result.total === 0 
                ? `No results found for "${term}"`
                : `Found ${result.total} ${result.total === 1 ? 'result' : 'results'} for "${term}"`
              }
            </p>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Search Results - styled to match modal */}
        {!term ? (
          <div className="py-16 text-center">
            <p className="text-gray-500 dark:text-gray-400">
              Enter a search term to see results.
            </p>
          </div>
        ) : !result?.total ? (
          <div className="py-8">
            <SearchResultsPredictive.Empty term={{current: term}} />
          </div>
        ) : (
          <div className="space-y-4">
            <SearchResultsPredictive.Creators
              creators={result?.items?.creators || []}
              closeSearch={noOpCloseSearch}
              term={{current: term}}
            />
            <SearchResultsPredictive.Products
              products={result?.items?.products || []}
              closeSearch={noOpCloseSearch}
              term={{current: term}}
            />
            {/* Note: Collections, Pages, and Articles are not shown in predictive search results */}
          </div>
        )}

        <Analytics.SearchView data={{searchTerm: term, searchResults: result}} />
      </div>
    </div>
  );
}

/**
 * Regular search query and fragments
 * (adjust as needed)
 */
const SEARCH_PRODUCT_FRAGMENT = `#graphql
  fragment SearchProduct on Product {
    __typename
    handle
    id
    publishedAt
    title
    trackingParameters
    vendor
    selectedOrFirstAvailableVariant(
      selectedOptions: []
      ignoreUnknownOptions: true
      caseInsensitiveMatch: true
    ) {
      id
      image {
        url
        altText
        width
        height
      }
      price {
        amount
        currencyCode
      }
      compareAtPrice {
        amount
        currencyCode
      }
      selectedOptions {
        name
        value
      }
      product {
        handle
        title
      }
    }
  }
`;

const SEARCH_PAGE_FRAGMENT = `#graphql
  fragment SearchPage on Page {
     __typename
     handle
    id
    title
    trackingParameters
  }
`;

const SEARCH_ARTICLE_FRAGMENT = `#graphql
  fragment SearchArticle on Article {
    __typename
    handle
    id
    title
    trackingParameters
  }
`;

const PAGE_INFO_FRAGMENT = `#graphql
  fragment PageInfoFragment on PageInfo {
    hasNextPage
    hasPreviousPage
    startCursor
    endCursor
  }
`;

/**
 * Validates that a string contains only safe characters for search patterns
 * Allows alphanumeric, spaces, hyphens, underscores, and basic punctuation
 * @param {string} str - The string to validate
 * @returns {boolean} True if the string is safe
 */
function isValidSearchPattern(str) {
  if (typeof str !== 'string') return false;
  // Allow alphanumeric, spaces, hyphens, underscores, apostrophes, and periods
  // This is safe for search terms and prevents injection attacks
  const SAFE_PATTERN_REGEX = /^[a-zA-Z0-9\s\-_'.,]+$/;
  return SAFE_PATTERN_REGEX.test(str);
}

/**
 * Escapes special characters in a string for use in SQL LIKE patterns
 * Prevents SQL injection by escaping %, _, and backslash characters
 * Also validates input to ensure it's safe for Supabase PostgREST filter syntax
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for use in LIKE queries, or empty string if invalid
 */
function escapeLikePattern(str) {
  if (typeof str !== 'string') return '';
  
  // Remove any null bytes and control characters that could be dangerous
  let cleaned = str.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Validate the cleaned string contains only safe characters
  // This prevents injection attacks before escaping
  if (!isValidSearchPattern(cleaned)) {
    // If invalid, return empty string to prevent any potential injection
    return '';
  }
  
  // Remove characters that could break PostgREST filter syntax
  // Commas are used as separators in .or() filters, so we need to be careful
  // However, Supabase client will URL-encode these, so we just need to escape LIKE chars
  cleaned = cleaned.replace(/,/g, ''); // Remove commas to prevent filter syntax issues
  
  // Escape backslash first, then % and _
  // This prevents SQL injection in LIKE patterns
  cleaned = cleaned.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  
  // Additional safety: limit length to prevent DoS
  const MAX_PATTERN_LENGTH = 500;
  if (cleaned.length > MAX_PATTERN_LENGTH) {
    cleaned = cleaned.substring(0, MAX_PATTERN_LENGTH);
  }
  
  return cleaned;
}

/**
 * Validates that a string is a valid UUID
 * @param {string} str - The string to validate
 * @returns {boolean} True if the string is a valid UUID
 */
function isValidUUID(str) {
  if (typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Safely constructs a Supabase PostgREST .or() filter string
 * Prevents SQL injection by validating and encoding filter components
 * 
 * PostgREST filter format: "column1.operator.value1,column2.operator.value2"
 * 
 * @param {Array<{column: string, operator: string, value: string}>} filters - Array of filter objects
 * @returns {string} Safely constructed filter string, or empty string if invalid
 */
function buildSafeOrFilter(filters) {
  if (!Array.isArray(filters) || filters.length === 0) {
    return '';
  }

  // Validate column names - only allow alphanumeric, underscore, and dot
  const COLUMN_NAME_REGEX = /^[a-zA-Z0-9_.]+$/;
  
  // Validate operators - only allow valid PostgREST operators
  const VALID_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd', 'ov', 'sl', 'sr', 'nxr', 'nxl', 'adj', 'fts', 'plfts', 'phfts', 'wfts'];
  
  const safeFilters = [];
  
  for (const filter of filters) {
    // Validate filter object structure
    if (!filter || typeof filter !== 'object') {
      continue;
    }
    
    const {column, operator, value} = filter;
    
    // Validate column name
    if (!column || typeof column !== 'string' || !COLUMN_NAME_REGEX.test(column)) {
      continue;
    }
    
    // Validate operator
    if (!operator || typeof operator !== 'string' || !VALID_OPERATORS.includes(operator.toLowerCase())) {
      continue;
    }
    
    // Validate value
    if (value === null || value === undefined) {
      continue;
    }
    
    // For ilike/like operators, ensure value is properly escaped
    const normalizedOperator = operator.toLowerCase();
    let safeValue;
    
    if (normalizedOperator === 'ilike' || normalizedOperator === 'like') {
      // Use escapeLikePattern for LIKE/ILIKE operators
      // The value should be the escaped term WITHOUT wildcards
      // We'll add wildcards here for pattern matching
      const stringValue = String(value);
      
      // Remove wildcards if they were already added (to avoid double-escaping)
      // This handles the case where searchPattern was passed with % wildcards
      let termWithoutWildcards = stringValue;
      if (stringValue.startsWith('%') && stringValue.endsWith('%')) {
        termWithoutWildcards = stringValue.slice(1, -1);
      }
      
      const escaped = escapeLikePattern(termWithoutWildcards);
      if (!escaped) {
        continue; // Skip invalid patterns
      }
      // Add wildcards for pattern matching (contains search)
      safeValue = `%${escaped}%`;
    } else {
      // For other operators, validate the value is safe
      const stringValue = String(value);
      // Remove any characters that could break PostgREST filter syntax
      // PostgREST uses commas as separators, so we must ensure no commas in values
      safeValue = stringValue.replace(/,/g, '').replace(/[\x00-\x1F\x7F]/g, '');
      if (!safeValue) {
        continue;
      }
    }
    
    // Construct filter component: column.operator.value
    safeFilters.push(`${column}.${normalizedOperator}.${safeValue}`);
  }
  
  if (safeFilters.length === 0) {
    return '';
  }
  
  // Join with commas (PostgREST separator)
  return safeFilters.join(',');
}

// NOTE: https://shopify.dev/docs/api/storefront/latest/queries/search
export const SEARCH_QUERY = `#graphql
  query RegularSearch(
    $country: CountryCode
    $endCursor: String
    $first: Int
    $language: LanguageCode
    $last: Int
    $term: String!
    $startCursor: String
  ) @inContext(country: $country, language: $language) {
    articles: search(
      query: $term,
      types: [ARTICLE],
      first: $first,
    ) {
      nodes {
        ...on Article {
          ...SearchArticle
        }
      }
    }
    pages: search(
      query: $term,
      types: [PAGE],
      first: $first,
    ) {
      nodes {
        ...on Page {
          ...SearchPage
        }
      }
    }
    products: search(
      after: $endCursor,
      before: $startCursor,
      first: $first,
      last: $last,
      query: $term,
      sortKey: RELEVANCE,
      types: [PRODUCT],
      unavailableProducts: HIDE,
    ) {
      nodes {
        ...on Product {
          ...SearchProduct
        }
      }
      pageInfo {
        ...PageInfoFragment
      }
    }
  }
  ${SEARCH_PRODUCT_FRAGMENT}
  ${SEARCH_PAGE_FRAGMENT}
  ${SEARCH_ARTICLE_FRAGMENT}
  ${PAGE_INFO_FRAGMENT}
`;

/**
 * Regular search fetcher
 * @param {Pick<
 *   Route.LoaderArgs,
 *   'request' | 'context'
 * >}
 * @return {Promise<RegularSearchReturn>}
 */
async function regularSearch({request, context}) {
  const {storefront} = context;
  const url = new URL(request.url);
  const variables = getPaginationVariables(request, {pageBy: 8});
  
  // Validate and limit search term length
  const rawTerm = String(url.searchParams.get('q') || '');
  const MAX_SEARCH_LENGTH = 200;
  const MIN_SEARCH_LENGTH = 2;
  const term = rawTerm.trim().substring(0, MAX_SEARCH_LENGTH);
  
  // Sanitize search term (remove control characters)
  const sanitizedTerm = term.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Require minimum search length to prevent excessive queries
  if (!sanitizedTerm || sanitizedTerm.length < MIN_SEARCH_LENGTH) {
    return {
      type: 'regular',
      term: sanitizedTerm || '',
      result: {total: 0, items: {}},
    };
  }
  
  // Rate limiting for search
  // NOTE: Current implementation uses in-memory rate limiting which won't work
  // in distributed environments (e.g., Cloudflare Workers). For production,
  // implement distributed rate limiting using Cloudflare KV or Durable Objects.
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `search:${clientIP}`, {
    maxRequests: 30,
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    return {
      type: 'regular',
      term: sanitizedTerm,
      error: 'Too many search requests. Please wait a moment.',
      result: {total: 0, items: {}},
    };
  }

  // Search articles, pages, and products for the `q` term
  const {errors, ...items} = await storefront.query(SEARCH_QUERY, {
    variables: {...variables, term: sanitizedTerm},
  });

  if (!items) {
    throw new Error('No search data returned from Shopify API');
  }

  const total = Object.values(items).reduce(
    (acc, {nodes}) => acc + nodes.length,
    0,
  );

  const error = errors
    ? errors.map(({message}) => message).join(', ')
    : undefined;

  return {type: 'regular', term: sanitizedTerm, error, result: {total, items}};
}

/**
 * Predictive search query and fragments
 * (adjust as needed)
 */
const PREDICTIVE_SEARCH_ARTICLE_FRAGMENT = `#graphql
  fragment PredictiveArticle on Article {
    __typename
    id
    title
    handle
    blog {
      handle
    }
    image {
      url
      altText
      width
      height
    }
    trackingParameters
  }
`;

const PREDICTIVE_SEARCH_COLLECTION_FRAGMENT = `#graphql
  fragment PredictiveCollection on Collection {
    __typename
    id
    title
    handle
    image {
      url
      altText
      width
      height
    }
    trackingParameters
  }
`;

const PREDICTIVE_SEARCH_PAGE_FRAGMENT = `#graphql
  fragment PredictivePage on Page {
    __typename
    id
    title
    handle
    trackingParameters
  }
`;

const PREDICTIVE_SEARCH_PRODUCT_FRAGMENT = `#graphql
  fragment PredictiveProduct on Product {
    __typename
    id
    title
    handle
    trackingParameters
    selectedOrFirstAvailableVariant(
      selectedOptions: []
      ignoreUnknownOptions: true
      caseInsensitiveMatch: true
    ) {
      id
      image {
        url
        altText
        width
        height
      }
      price {
        amount
        currencyCode
      }
    }
  }
`;

const PREDICTIVE_SEARCH_QUERY_FRAGMENT = `#graphql
  fragment PredictiveQuery on SearchQuerySuggestion {
    __typename
    text
    styledText
    trackingParameters
  }
`;

// NOTE: https://shopify.dev/docs/api/storefront/latest/queries/predictiveSearch
const PREDICTIVE_SEARCH_QUERY = `#graphql
  query PredictiveSearch(
    $country: CountryCode
    $language: LanguageCode
    $limit: Int!
    $limitScope: PredictiveSearchLimitScope!
    $term: String!
    $types: [PredictiveSearchType!]
  ) @inContext(country: $country, language: $language) {
    predictiveSearch(
      limit: $limit,
      limitScope: $limitScope,
      query: $term,
      types: $types,
    ) {
      articles {
        ...PredictiveArticle
      }
      collections {
        ...PredictiveCollection
      }
      pages {
        ...PredictivePage
      }
      products {
        ...PredictiveProduct
      }
      queries {
        ...PredictiveQuery
      }
    }
  }
  ${PREDICTIVE_SEARCH_ARTICLE_FRAGMENT}
  ${PREDICTIVE_SEARCH_COLLECTION_FRAGMENT}
  ${PREDICTIVE_SEARCH_PAGE_FRAGMENT}
  ${PREDICTIVE_SEARCH_PRODUCT_FRAGMENT}
  ${PREDICTIVE_SEARCH_QUERY_FRAGMENT}
`;

/**
 * Searches Supabase creators for predictive search
 * Returns creators that match the search term by handle or display_name
 * Searches all creators regardless of status
 * 
 * @param {string} searchTerm - The search query term
 * @param {string} supabaseUrl - Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key
 * @param {number} limit - Maximum number of results to return
 * @param {AbortSignal} [signal] - Optional abort signal for cancellation
 * @returns {Promise<Array>} Array of formatted creator objects
 */
async function searchSupabaseCreators(searchTerm, supabaseUrl, serviceRoleKey, limit = 10, signal = null) {
  if (!supabaseUrl || !serviceRoleKey) {
    return [];
  }

  // Validate and sanitize search term
  if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
    return [];
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Escape special characters to prevent SQL injection
  const escapedTerm = escapeLikePattern(searchTerm.trim());
  
  // Additional validation: ensure escaped term is not empty after escaping
  // If escapeLikePattern returns empty, it means the input was invalid/unsafe
  if (!escapedTerm || escapedTerm.length === 0) {
    return [];
  }
  
  // Validate the escaped term one more time before using in query
  // This provides defense in depth against injection attacks
  if (!isValidSearchPattern(escapedTerm)) {
    return [];
  }
  
  // Use safe filter construction to prevent SQL injection
  // Build .or() filter using validated components instead of string interpolation
  // Pass the escaped term (without wildcards) - buildSafeOrFilter will add them
  const orFilter = buildSafeOrFilter([
    {column: 'handle', operator: 'ilike', value: escapedTerm},
    {column: 'display_name', operator: 'ilike', value: escapedTerm},
  ]);
  
  if (!orFilter) {
    // If filter construction fails (invalid input), return empty results
    return [];
  }
  
  let query = supabase
    .from('creators')
    .select('id, handle, display_name, bio, profile_image_url, verification_status')
    .or(orFilter)
    .limit(limit)
    .order('created_at', {ascending: false});
  
  // Apply abort signal if provided
  if (signal) {
    if (signal.aborted) {
      throw new Error('Request aborted');
    }
    signal.addEventListener('abort', () => {
      // Supabase doesn't support cancellation directly, but we can check signal
    });
  }
  
  // Check if request was aborted before query
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  const {data: creators, error: creatorsError} = await query;
  
  // Check if request was aborted after query
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  if (creatorsError) {
    // Sanitize error logging to prevent information disclosure
    const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
    if (!isProduction) {
      console.error('Error searching Supabase creators:', creatorsError);
    } else {
      console.error('Error searching Supabase creators:', {
        code: creatorsError?.code,
        message: creatorsError?.message?.substring(0, 100),
        timestamp: new Date().toISOString(),
      });
    }
    return [];
  }

  if (!creators || creators.length === 0) {
    return [];
  }

  // Transform creators to match a format that can be displayed in search results
  // Filter out creators with invalid handles to prevent security issues
  // We'll create a simple structure that can be rendered
  return creators
    .filter(creator => {
      // Validate handle format before including in results
      // This prevents path traversal and open redirect vulnerabilities
      return creator.handle && validateHandle(creator.handle);
    })
    .map(creator => ({
      __typename: 'Creator',
      id: creator.id,
      handle: creator.handle, // Already validated above
      displayName: creator.display_name || creator.handle,
      bio: creator.bio || null,
      profileImageUrl: creator.profile_image_url || null,
      verificationStatus: creator.verification_status || null,
    }));
}

/**
 * Searches Supabase listings for predictive search
 * Only returns live listings that match the search term
 * 
 * @param {string} searchTerm - The search query term
 * @param {string} supabaseUrl - Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key
 * @param {number} limit - Maximum number of results to return
 * @param {AbortSignal} [signal] - Optional abort signal for cancellation
 * @returns {Promise<Array>} Array of formatted product objects
 */
async function searchSupabaseListings(searchTerm, supabaseUrl, serviceRoleKey, limit = 10, signal = null) {
  if (!supabaseUrl || !serviceRoleKey) {
    return [];
  }

  // Validate and sanitize search term
  if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
    return [];
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Escape special characters to prevent SQL injection
  const escapedTerm = escapeLikePattern(searchTerm.trim());
  
  // Additional validation: ensure escaped term is not empty after escaping
  // If escapeLikePattern returns empty, it means the input was invalid/unsafe
  if (!escapedTerm || escapedTerm.length === 0) {
    return [];
  }
  
  // Validate the escaped term one more time before using in query
  // This provides defense in depth against injection attacks
  if (!isValidSearchPattern(escapedTerm)) {
    return [];
  }
  
  // Use safe filter construction to prevent SQL injection
  // Build .or() filter using validated components instead of string interpolation
  // Pass the escaped term (without wildcards) - buildSafeOrFilter will add them
  const orFilter = buildSafeOrFilter([
    {column: 'title', operator: 'ilike', value: escapedTerm},
    {column: 'story', operator: 'ilike', value: escapedTerm},
  ]);
  
  if (!orFilter) {
    // If filter construction fails (invalid input), return empty results
    return [];
  }
  
  // Using 'story' column instead of 'description' (per schema)
  let query = supabase
    .from('listings')
    .select('id, title, story, price_cents, shopify_product_id, created_at, creator_id')
    .eq('status', 'live') // Only return live listings
    .or(orFilter)
    .limit(limit)
    .order('created_at', {ascending: false});
  
  // Check if request was aborted before query
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  // Apply abort signal listener (Supabase doesn't support cancellation directly)
  if (signal) {
    signal.addEventListener('abort', () => {
      // Signal is aborted - we'll check this after the query completes
    });
  }
  
  const {data: listings, error: listingsError} = await query;
  
  // Check if request was aborted after query
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  if (listingsError) {
    // Sanitize error logging to prevent information disclosure
    const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
    if (!isProduction) {
      console.error('Error searching Supabase listings:', listingsError);
    } else {
      console.error('Error searching Supabase listings:', {
        code: listingsError?.code,
        message: listingsError?.message?.substring(0, 100),
        timestamp: new Date().toISOString(),
      });
    }
    return [];
  }

  if (!listings || listings.length === 0) {
    return [];
  }

  // Limit the number of listings to prevent DoS attacks
  const MAX_LISTINGS_FOR_PHOTOS = 50;
  const limitedListings = listings.slice(0, MAX_LISTINGS_FOR_PHOTOS);

  // Fetch photos for all listings - validate UUIDs first
  const listingIds = limitedListings
    .map(l => l.id)
    .filter(id => isValidUUID(id)); // Filter out invalid UUIDs to prevent injection
  
  if (listingIds.length === 0) {
    return [];
  }

  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('listing_id, storage_path')
    .in('listing_id', listingIds)
    .eq('photo_type', 'reference')
    .order('created_at', {ascending: true});

  if (photosError) {
    // Sanitize error logging
    const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
    if (!isProduction) {
      console.error('Error fetching listing photos:', photosError);
    } else {
      console.error('Error fetching listing photos:', {
        code: photosError?.code,
        message: photosError?.message?.substring(0, 100),
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Group photos by listing_id (get first photo as thumbnail)
  const photosByListing = {};
  if (photos) {
    photos.forEach(photo => {
      // Validate listing_id is a valid UUID before using as key
      if (isValidUUID(photo.listing_id)) {
        if (!photosByListing[photo.listing_id]) {
          photosByListing[photo.listing_id] = [];
        }
        photosByListing[photo.listing_id].push(photo);
      }
    });
  }

  // Fetch creator information for all listings - validate UUIDs first
  const creatorIds = [...new Set(limitedListings.map(l => l.creator_id).filter(Boolean))]
    .filter(id => isValidUUID(id)); // Filter out invalid UUIDs
  
  let creatorsMap = {};
  
  if (creatorIds.length > 0) {
    const {data: creators, error: creatorsError} = await supabase
      .from('creators')
      .select('id, display_name, handle')
      .in('id', creatorIds);
    
    if (!creatorsError && creators) {
      creators.forEach(creator => {
        // Validate creator ID before adding to map
        if (isValidUUID(creator.id)) {
          creatorsMap[creator.id] = creator;
        }
      });
    } else if (creatorsError) {
      // Sanitize error logging
      const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
      if (!isProduction) {
        console.error('Error fetching creators:', creatorsError);
      } else {
        console.error('Error fetching creators:', {
          code: creatorsError?.code,
          message: creatorsError?.message?.substring(0, 100),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Transform listings to match Shopify product format expected by SearchResultsPredictive
  const products = limitedListings.map(listing => {
    const listingPhotos = photosByListing[listing.id] || [];
    const firstPhoto = listingPhotos[0];
    
    // Get public URL for the first photo
    let imageUrl = null;
    let imageAlt = listing.title || 'Product image';
    
    if (firstPhoto?.storage_path) {
      const {data} = supabase.storage
        .from('listing-photos')
        .getPublicUrl(firstPhoto.storage_path);
      imageUrl = data?.publicUrl || null;
    }

    // Use listing ID as handle - listings are accessed via /listings/{id}
    // Note: SearchResultsPredictive expects /products/{handle}, but we'll handle this
    // by using the listing ID as the handle. If needed, create a redirect route later.
    // shopify_product_id exists but we use listing.id for the URL
    const handle = listing.id;
    
    // Convert price_cents to Shopify price format
    const priceAmount = (listing.price_cents / 100).toFixed(2);
    
    // Get creator information
    const creator = listing.creator_id ? creatorsMap[listing.creator_id] : null;
    
    return {
      __typename: 'Product',
      id: listing.id,
      title: listing.title || 'Untitled Listing',
      handle: handle,
      trackingParameters: null, // Not used for Supabase listings
      creator: creator ? {
        id: creator.id,
        displayName: creator.display_name || creator.handle,
        handle: creator.handle,
      } : null,
      selectedOrFirstAvailableVariant: {
        id: `${listing.id}-variant`, // Create a variant ID
        image: imageUrl ? {
          url: imageUrl,
          altText: imageAlt,
          width: 400, // Default dimensions
          height: 400,
        } : null,
        price: {
          amount: priceAmount,
          currencyCode: 'USD', // Default to USD, adjust if you support multiple currencies
        },
      },
    };
  });

  return products;
}

/**
 * Predictive search fetcher
 * Now searches Supabase listings instead of Shopify products
 * Only returns live listings (status = 'live')
 * 
 * @param {Pick<
 *   Route.ActionArgs,
 *   'request' | 'context'
 * >}
 * @return {Promise<PredictiveSearchReturn>}
 */
async function predictiveSearch({request, context}) {
  const url = new URL(request.url);
  
  // Validate and limit search term length
  const rawTerm = String(url.searchParams.get('q') || '').trim();
  const MAX_SEARCH_LENGTH = 200;
  // Sanitize: remove control characters and limit length
  const term = rawTerm.substring(0, MAX_SEARCH_LENGTH).replace(/[\x00-\x1F\x7F]/g, '');
  
  // Validate and limit limit parameter with strict validation
  const rawLimit = url.searchParams.get('limit');
  const MAX_LIMIT = 50;
  const MIN_LIMIT = 1;
  // Strict validation: must be a string containing only digits
  const limit = rawLimit && /^\d+$/.test(rawLimit)
    ? Math.min(Math.max(MIN_LIMIT, parseInt(rawLimit, 10)), MAX_LIMIT)
    : 10; // Default if invalid or missing
  
  const type = 'predictive';

  // Require minimum search length to prevent excessive queries
  const MIN_SEARCH_LENGTH = 2;
  if (!term || term.length < MIN_SEARCH_LENGTH) {
    return {type, term: term || '', result: getEmptyPredictiveSearchResult()};
  }

  // Rate limiting for predictive search
  // NOTE: Current implementation uses in-memory rate limiting which won't work
  // in distributed environments (e.g., Cloudflare Workers). For production,
  // implement distributed rate limiting using Cloudflare KV or Durable Objects.
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `search-predictive:${clientIP}`, {
    maxRequests: 60, // More lenient for predictive (autocomplete)
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    return {type, term, result: getEmptyPredictiveSearchResult()};
  }

  // Get Supabase configuration from context
  const supabaseUrl = context.env?.SUPABASE_URL;
  const serviceRoleKey = context.env?.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase configuration for search');
    // Return empty results instead of throwing to prevent UI crashes
    return {type, term, result: getEmptyPredictiveSearchResult()};
  }

  try {
    // Search Supabase listings (only live products) and creators in parallel
    // Add timeout to prevent hanging requests
    // Note: Supabase doesn't support AbortSignal, so we use a flag-based approach
    const SEARCH_TIMEOUT_MS = 5000; // 5 seconds
    
    let aborted = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      aborted = true;
      controller.abort();
    }, SEARCH_TIMEOUT_MS);
    
    try {
      const [products, creators] = await Promise.all([
        searchSupabaseListings(term, supabaseUrl, serviceRoleKey, limit, controller.signal),
        searchSupabaseCreators(term, supabaseUrl, serviceRoleKey, limit, controller.signal),
      ]);
      
      clearTimeout(timeoutId);
      
      // Check if request was aborted after queries complete
      // (Supabase queries don't support cancellation, so we check after completion)
      if (aborted || controller.signal.aborted) {
        throw new Error('Search request timeout');
      }
      
      // Return results in the format expected by SearchResultsPredictive
      // We're returning products and creators, so articles, collections, pages, and queries are empty
      const items = {
        articles: [],
        collections: [],
        pages: [],
        products: products,
        creators: creators, // Add creators to results
        queries: [], // No query suggestions for now
      };

      const total = products.length + creators.length;

      return {type, term, result: {items, total}};
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Check if error was due to abort or timeout
      if (aborted || error.name === 'AbortError' || error.message === 'Request aborted' || controller.signal.aborted) {
        throw new Error('Search request timeout');
      }
      
      throw error;
    }
  } catch (error) {
    // Sanitize error logging to prevent information disclosure
    const isProduction = context.env?.NODE_ENV === 'production';
    const errorMessage = error.message || 'Unknown error';
    const sanitizedMessage = errorMessage.substring(0, 200); // Limit error message length
    
    console.error('Predictive search error:', {
      message: sanitizedMessage,
      ...(isProduction ? {} : {stack: error.stack}), // Only log stack in development
      term: term.substring(0, 50), // Limit term length in logs
      timestamp: new Date().toISOString(),
    });
    
    // Return empty results instead of throwing to prevent UI crashes
    return {type, term, result: getEmptyPredictiveSearchResult()};
  }
}

/** @typedef {import('./+types/search').Route} Route */
/** @typedef {import('~/lib/search').RegularSearchReturn} RegularSearchReturn */
/** @typedef {import('~/lib/search').PredictiveSearchReturn} PredictiveSearchReturn */
/** @typedef {import('storefrontapi.generated').RegularSearchQuery} RegularSearchQuery */
/** @typedef {import('storefrontapi.generated').PredictiveSearchQuery} PredictiveSearchQuery */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
