import {useLoaderData} from 'react-router';
import {getPaginationVariables, Analytics} from '@shopify/hydrogen';
import {SearchForm} from '~/components/SearchForm';
import {SearchResults} from '~/components/SearchResults';
import {getEmptyPredictiveSearchResult} from '~/lib/search';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';
import {createServerSupabaseClient} from '~/lib/supabase';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: `Hydrogen | Search`}];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({request, context}) {
  const url = new URL(request.url);
  const isPredictive = url.searchParams.has('predictive');
  const searchPromise = isPredictive
    ? predictiveSearch({request, context})
    : regularSearch({request, context});

  searchPromise.catch((error) => {
    console.error(error);
    return {term: '', result: null, error: error.message};
  });

  return await searchPromise;
}

/**
 * Renders the /search route
 */
export default function SearchPage() {
  /** @type {LoaderReturnData} */
  const {type, term, result, error} = useLoaderData();
  if (type === 'predictive') return null;

  return (
    <div className="search">
      <h1>Search</h1>
      <SearchForm>
        {({inputRef}) => (
          <>
            <input
              defaultValue={term}
              name="q"
              placeholder="Search…"
              ref={inputRef}
              type="search"
            />
            &nbsp;
            <button type="submit">Search</button>
          </>
        )}
      </SearchForm>
      {error && <p style={{color: 'red'}}>{error}</p>}
      {!term || !result?.total ? (
        <SearchResults.Empty />
      ) : (
        <SearchResults result={result} term={term}>
          {({articles, pages, products, term}) => (
            <div>
              <SearchResults.Products products={products} term={term} />
              <SearchResults.Pages pages={pages} term={term} />
              <SearchResults.Articles articles={articles} term={term} />
            </div>
          )}
        </SearchResults>
      )}
      <Analytics.SearchView data={{searchTerm: term, searchResults: result}} />
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
  const term = rawTerm.trim().substring(0, MAX_SEARCH_LENGTH);
  
  // Sanitize search term (remove control characters)
  const sanitizedTerm = term.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Rate limiting for search
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
 * Searches Supabase listings for predictive search
 * Only returns live listings that match the search term
 * 
 * @param {string} searchTerm - The search query term
 * @param {string} supabaseUrl - Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key
 * @param {number} limit - Maximum number of results to return
 * @returns {Promise<Array>} Array of formatted product objects
 */
async function searchSupabaseListings(searchTerm, supabaseUrl, serviceRoleKey, limit = 10) {
  if (!supabaseUrl || !serviceRoleKey) {
    return [];
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Search listings by title and story (case-insensitive)
  // Using ilike for case-insensitive pattern matching
  // Filter by status = 'live' to only show active products
  const searchPattern = `%${searchTerm}%`;
  
  // Supabase .or() format: "column1.ilike.value1,column2.ilike.value2"
  // Note: The pattern needs to be properly escaped for SQL LIKE
  // Using 'story' column instead of 'description' (per schema)
  const {data: listings, error: listingsError} = await supabase
    .from('listings')
    .select('id, title, story, price_cents, shopify_product_id, created_at')
    .eq('status', 'live') // Only return live listings
    .or(`title.ilike.${searchPattern},story.ilike.${searchPattern}`)
    .limit(limit)
    .order('created_at', {ascending: false});

  if (listingsError) {
    console.error('Error searching Supabase listings:', listingsError);
    return [];
  }

  if (!listings || listings.length === 0) {
    return [];
  }

  // Fetch photos for all listings
  const listingIds = listings.map(l => l.id);
  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('listing_id, storage_path')
    .in('listing_id', listingIds)
    .eq('photo_type', 'reference')
    .order('created_at', {ascending: true});

  if (photosError) {
    console.error('Error fetching listing photos:', photosError);
  }

  // Group photos by listing_id (get first photo as thumbnail)
  const photosByListing = {};
  if (photos) {
    photos.forEach(photo => {
      if (!photosByListing[photo.listing_id]) {
        photosByListing[photo.listing_id] = [];
      }
      photosByListing[photo.listing_id].push(photo);
    });
  }

  // Transform listings to match Shopify product format expected by SearchResultsPredictive
  const products = listings.map(listing => {
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
    
    return {
      __typename: 'Product',
      id: listing.id,
      title: listing.title || 'Untitled Listing',
      handle: handle,
      trackingParameters: null, // Not used for Supabase listings
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
  const term = rawTerm.substring(0, MAX_SEARCH_LENGTH).replace(/[\x00-\x1F\x7F]/g, '');
  
  // Validate and limit limit parameter
  const rawLimit = Number(url.searchParams.get('limit') || 10);
  const MAX_LIMIT = 50;
  const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
  
  const type = 'predictive';

  if (!term) return {type, term, result: getEmptyPredictiveSearchResult()};

  // Rate limiting for predictive search
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
    // Search Supabase listings (only live products)
    const products = await searchSupabaseListings(term, supabaseUrl, serviceRoleKey, limit);

    // Return results in the format expected by SearchResultsPredictive
    // We're only returning products, so articles, collections, pages, and queries are empty
    const items = {
      articles: [],
      collections: [],
      pages: [],
      products: products,
      queries: [], // No query suggestions for now
    };

    const total = products.length;

    return {type, term, result: {items, total}};
  } catch (error) {
    // Log error but don't expose full details
    console.error('Predictive search error:', {
      message: error.message,
      term,
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
