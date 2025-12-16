import {useLoaderData, Link, useSearchParams, useRouteError, isRouteErrorResponse} from 'react-router';
import {useState, useEffect, useMemo, useCallback, useRef} from 'react';
import {fetchAllListings} from '~/lib/supabase';
import {ALL_CATEGORIES} from '~/lib/categories';
import {ChevronDownIcon, FunnelIcon} from '@heroicons/react/20/solid';
import {Disclosure, DisclosureButton, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react';

export const meta = () => {
  return [
    {title: 'WornVault | Shop'},
    {name: 'description', content: 'Browse available inventory from verified creators. Discover unique items with authentic stories.'},
    {rel: 'canonical', href: '/shop'},
  ];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({context, request}) {
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase configuration for shop page.');
    // Return empty array instead of throwing to prevent page crash
    // In production, this should be logged to monitoring service
    return {
      products: [],
      error: null,
    };
  }
  
  try {
    // Fetch only live listings from Supabase
    const listings = await fetchAllListings(supabaseUrl, serviceRoleKey, {
      status: 'live',
    });
    
    // Map listings to product format for the template
    // Validate and sanitize data to prevent XSS and ensure data integrity
    const products = listings.map((listing) => {
      const price = parseFloat(listing.price || 0);
      const isValidPrice = !isNaN(price) && price >= 0 && price <= 1000000; // Max $1M
      
      return {
        id: listing.id,
        name: String(listing.title || 'Untitled Listing').substring(0, 200),
        href: `/listings/${listing.id}`,
        imageSrc: listing.thumbnailUrl || 'https://via.placeholder.com/400x400?text=No+Image',
        imageAlt: listing.title ? `${String(listing.title).substring(0, 100)} product image` : 'Product image',
        price: isValidPrice ? price : 0,
        priceFormatted: isValidPrice ? `$${price.toFixed(2)}` : '$0.00',
        creatorName: String(listing.creator?.display_name || 'Unknown Creator').substring(0, 100),
        creatorId: listing.creator?.id || null,
        createdAt: listing.created_at || null,
        category: listing.category ? String(listing.category).substring(0, 100) : null,
        condition: listing.condition ? String(listing.condition).substring(0, 50) : null,
      };
    });
    
    return {
      products,
      error: null,
    };
  } catch (error) {
    // Log error but don't crash the page
    console.error('Error fetching shop listings:', error);
    // In production, send to error tracking service (e.g., Sentry)
    
    return {
      products: [],
      error: 'Unable to load products. Please try again later.',
    };
  }
}

// Validate and sanitize URL parameters
function sanitizeUrlParam(value, maxLength = 200) {
  if (!value) return '';
  const sanitized = String(value).trim().substring(0, maxLength);
  // Remove potentially dangerous characters
  return sanitized.replace(/[<>\"']/g, '');
}

function validatePrice(value) {
  if (!value) return '';
  const num = parseFloat(value);
  if (isNaN(num) || num < 0 || num > 1000000) return '';
  return value;
}

/**
 * Validates image URLs to prevent XSS and ensure security
 * Only allows HTTPS URLs from trusted domains
 * @param {string} url - The image URL to validate
 * @returns {boolean} - True if URL is valid and safe
 */
function validateImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    // Only allow HTTPS protocol
    if (parsed.protocol !== 'https:') return false;
    // Allow Supabase storage URLs, Shopify CDN, and placeholder service
    const allowedDomains = [
      'supabase.co',
      'via.placeholder.com',
      'cdn.shopify.com',
    ];
    return allowedDomains.some(domain => parsed.hostname.includes(domain));
  } catch {
    // Invalid URL format
    return false;
  }
}

export default function Shop() {
  const {products: allProducts, error: loaderError} = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Filter state - initialize from URL params with validation
  const [creatorName, setCreatorName] = useState(() => sanitizeUrlParam(searchParams.get('creator') || '', 100));
  const [priceMin, setPriceMin] = useState(() => validatePrice(searchParams.get('priceMin') || ''));
  const [priceMax, setPriceMax] = useState(() => validatePrice(searchParams.get('priceMax') || ''));
  const [titleSearch, setTitleSearch] = useState(() => sanitizeUrlParam(searchParams.get('search') || '', 200));
  const [selectedCategory, setSelectedCategory] = useState(() => sanitizeUrlParam(searchParams.get('category') || '', 100));
  const [selectedCondition, setSelectedCondition] = useState(() => sanitizeUrlParam(searchParams.get('condition') || '', 50));
  
  // Sort state - initialize from URL params with validation
  const validSorts = ['newest', 'oldest', 'price_high', 'price_low', 'title', 'creator'];
  const sortParam = searchParams.get('sort') || 'newest';
  const [sortBy, setSortBy] = useState(() => validSorts.includes(sortParam) ? sortParam : 'newest');
  
  // Debounce refs for search inputs to prevent excessive URL updates
  const titleSearchTimeoutRef = useRef(null);
  const creatorNameTimeoutRef = useRef(null);
  
  // Sort options
  const sortOptions = [
    {value: 'newest', label: 'Newest First', current: sortBy === 'newest'},
    {value: 'oldest', label: 'Oldest First', current: sortBy === 'oldest'},
    {value: 'price_high', label: 'Price: High to Low', current: sortBy === 'price_high'},
    {value: 'price_low', label: 'Price: Low to High', current: sortBy === 'price_low'},
    {value: 'title', label: 'Title (A-Z)', current: sortBy === 'title'},
    {value: 'creator', label: 'Creator (A-Z)', current: sortBy === 'creator'},
  ];
  
  // Apply filters and sorting to products
  const filteredProducts = useMemo(() => {
    let filtered = [...allProducts];
    
    // Title search filter
    if (titleSearch) {
      const searchLower = titleSearch.toLowerCase();
      filtered = filtered.filter(product => 
        product.name.toLowerCase().includes(searchLower)
      );
    }
    
    // Creator name filter
    if (creatorName) {
      const creatorLower = creatorName.toLowerCase();
      filtered = filtered.filter(product => 
        product.creatorName.toLowerCase().includes(creatorLower)
      );
    }
    
    // Category filter
    if (selectedCategory) {
      filtered = filtered.filter(product => product.category === selectedCategory);
    }
    
    // Condition filter
    if (selectedCondition) {
      filtered = filtered.filter(product => product.condition === selectedCondition);
    }
    
    // Price range filter
    if (priceMin) {
      const min = parseFloat(priceMin);
      if (!isNaN(min)) {
        filtered = filtered.filter(product => product.price >= min);
      }
    }
    
    if (priceMax) {
      const max = parseFloat(priceMax);
      if (!isNaN(max)) {
        filtered = filtered.filter(product => product.price <= max);
      }
    }
    
    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case 'oldest':
          return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        case 'price_high':
          return b.price - a.price;
        case 'price_low':
          return a.price - b.price;
        case 'title':
          return a.name.localeCompare(b.name);
        case 'creator':
          return a.creatorName.localeCompare(b.creatorName);
        default:
          return 0;
      }
    });
    
    return sorted;
  }, [allProducts, titleSearch, creatorName, priceMin, priceMax, selectedCategory, selectedCondition, sortBy]);
  
  // Update URL when filters or sort change (debounced for search inputs)
  useEffect(() => {
    // Clear any pending timeouts
    if (titleSearchTimeoutRef.current) {
      clearTimeout(titleSearchTimeoutRef.current);
      titleSearchTimeoutRef.current = null;
    }
    if (creatorNameTimeoutRef.current) {
      clearTimeout(creatorNameTimeoutRef.current);
      creatorNameTimeoutRef.current = null;
    }
    
    const updateUrl = () => {
      const params = new URLSearchParams();
      if (titleSearch) params.set('search', titleSearch);
      if (creatorName) params.set('creator', creatorName);
      if (selectedCategory) params.set('category', selectedCategory);
      if (selectedCondition) params.set('condition', selectedCondition);
      if (priceMin) params.set('priceMin', priceMin);
      if (priceMax) params.set('priceMax', priceMax);
      if (sortBy && sortBy !== 'newest') {
        params.set('sort', sortBy);
      }
      
      setSearchParams(params, {replace: true});
    };
    
    // Debounce search inputs (300ms delay) to prevent excessive URL updates
    // Dropdowns and price inputs update immediately for better UX
    const isSearchInput = titleSearch || creatorName;
    const isOtherFilter = selectedCategory || selectedCondition || priceMin || priceMax || (sortBy && sortBy !== 'newest');
    
    if (isSearchInput) {
      const timeout = setTimeout(updateUrl, 300);
      if (titleSearch) titleSearchTimeoutRef.current = timeout;
      if (creatorName) creatorNameTimeoutRef.current = timeout;
    } else if (isOtherFilter) {
      // Immediate update for dropdowns and price filters
      updateUrl();
    } else {
      // No filters - clear URL params
      setSearchParams(new URLSearchParams(), {replace: true});
    }
    
    // Cleanup on unmount or dependency change
    return () => {
      if (titleSearchTimeoutRef.current) {
        clearTimeout(titleSearchTimeoutRef.current);
        titleSearchTimeoutRef.current = null;
      }
      if (creatorNameTimeoutRef.current) {
        clearTimeout(creatorNameTimeoutRef.current);
        creatorNameTimeoutRef.current = null;
      }
    };
  }, [titleSearch, creatorName, selectedCategory, selectedCondition, priceMin, priceMax, sortBy, setSearchParams]);
  
  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (titleSearch) count++;
    if (creatorName) count++;
    if (selectedCategory) count++;
    if (selectedCondition) count++;
    if (priceMin) count++;
    if (priceMax) count++;
    return count;
  }, [titleSearch, creatorName, selectedCategory, selectedCondition, priceMin, priceMax]);
  
  // Clear all filters
  const clearFilters = useCallback(() => {
    setTitleSearch('');
    setCreatorName('');
    setSelectedCategory('');
    setSelectedCondition('');
    setPriceMin('');
    setPriceMax('');
    setSortBy('newest');
  }, []);
  
  // Handle price input with validation
  const handlePriceMinChange = useCallback((e) => {
    const value = e.target.value;
    const validated = validatePrice(value);
    setPriceMin(validated);
  }, []);
  
  const handlePriceMaxChange = useCallback((e) => {
    const value = e.target.value;
    const validated = validatePrice(value);
    setPriceMax(validated);
  }, []);
  
  // Handle search input with sanitization
  const handleTitleSearchChange = useCallback((e) => {
    const value = sanitizeUrlParam(e.target.value, 200);
    setTitleSearch(value);
  }, []);
  
  const handleCreatorNameChange = useCallback((e) => {
    const value = sanitizeUrlParam(e.target.value, 100);
    setCreatorName(value);
  }, []);
  
  // Show error state if loader failed
  if (loaderError) {
    return (
      <div className="bg-white dark:bg-gray-900 min-h-screen">
        <div className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 sm:pb-24 lg:max-w-7xl lg:px-8">
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {loaderError}
            </p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-white dark:bg-gray-900">
      <div className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 sm:pb-24 lg:max-w-7xl lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Shop</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Browse available inventory from verified creators
          </p>
        </div>

        {/* Filters */}
        <Disclosure
          as="section"
          aria-labelledby="filter-heading"
          className="grid items-center border-t border-b border-gray-200 dark:border-white/10 mb-6"
        >
          <h2 id="filter-heading" className="sr-only">
            Filters
          </h2>
          <div className="relative col-start-1 row-start-1 py-4">
            <div className="mx-auto flex max-w-7xl divide-x divide-gray-200 dark:divide-white/10 px-4 text-sm sm:px-6 lg:px-8">
              <div className="pr-6">
                <DisclosureButton className="group flex items-center font-medium text-gray-700 dark:text-gray-300">
                  <FunnelIcon
                    aria-hidden="true"
                    className="mr-2 size-5 flex-none text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-400"
                  />
                  {activeFilterCount} Filter{activeFilterCount !== 1 ? 's' : ''}
                </DisclosureButton>
              </div>
              {activeFilterCount > 0 && (
                <div className="pl-6">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          </div>
          <DisclosurePanel className="border-t border-gray-200 dark:border-white/10 py-10">
            <div className="mx-auto grid max-w-7xl grid-cols-1 gap-x-4 px-4 text-sm sm:px-6 md:gap-x-6 lg:px-8">
              <div className="grid auto-rows-min grid-cols-1 gap-y-10 md:grid-cols-3 md:gap-x-6">
                {/* Search Column - Condition and Category */}
                <fieldset>
                  <legend className="block font-medium text-gray-900 dark:text-white">Search</legend>
                  <div className="pt-6 sm:pt-4 space-y-4">
                    <div>
                      <label htmlFor="condition" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        Condition
                      </label>
                      <select
                        id="condition"
                        value={selectedCondition}
                        onChange={(e) => setSelectedCondition(sanitizeUrlParam(e.target.value, 50))}
                        className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                        aria-label="Filter by condition"
                      >
                        <option value="">All Conditions</option>
                        <option value="Barely worn">Barely worn</option>
                        <option value="Lightly worn">Lightly worn</option>
                        <option value="Heavily worn">Heavily worn</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="category" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        Category
                      </label>
                      <select
                        id="category"
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                      >
                        <option value="">All Categories</option>
                        {ALL_CATEGORIES.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.value}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </fieldset>
                
                {/* Creator Column - Creator Name and Title Search */}
                <fieldset>
                  <legend className="block font-medium text-gray-900 dark:text-white">Creator</legend>
                  <div className="pt-6 sm:pt-4 space-y-4">
                    <div>
                      <label htmlFor="creatorName" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        Creator Name
                      </label>
                      <input
                        type="text"
                        id="creatorName"
                        value={creatorName}
                        onChange={handleCreatorNameChange}
                        placeholder="Filter by creator..."
                        className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                      />
                    </div>
                    <div>
                      <label htmlFor="titleSearch" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        Product Title
                      </label>
                      <input
                        type="text"
                        id="titleSearch"
                        value={titleSearch}
                        onChange={handleTitleSearchChange}
                        placeholder="Search products..."
                        maxLength={200}
                        className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                        aria-label="Search products by title"
                      />
                    </div>
                  </div>
                </fieldset>
                
                {/* Price Range Filter */}
                <fieldset>
                  <legend className="block font-medium text-gray-900 dark:text-white">Price Range</legend>
                  <div className="space-y-4 pt-6 sm:pt-4">
                    <div>
                      <label htmlFor="priceMin" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        Min Price ($)
                      </label>
                      <input
                        type="number"
                        id="priceMin"
                        value={priceMin}
                        onChange={handlePriceMinChange}
                        placeholder="0"
                        min="0"
                        step="0.01"
                        className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                      />
                    </div>
                    <div>
                      <label htmlFor="priceMax" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        Max Price ($)
                      </label>
                      <input
                        type="number"
                        id="priceMax"
                        value={priceMax}
                        onChange={handlePriceMaxChange}
                        placeholder="1000"
                        min="0"
                        max="1000000"
                        step="0.01"
                        className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                        aria-label="Maximum price filter"
                      />
                    </div>
                  </div>
                </fieldset>
              </div>
            </div>
          </DisclosurePanel>
        </Disclosure>

        {/* Sort and Results Count */}
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Showing <span className="font-medium">{filteredProducts.length}</span> product{filteredProducts.length !== 1 ? 's' : ''}
          </p>
          <Menu as="div" className="relative inline-block">
            <div className="flex">
              <MenuButton className="group inline-flex justify-center text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
                Sort
                <ChevronDownIcon
                  aria-hidden="true"
                  className="-mr-1 ml-1 size-5 shrink-0 text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-400"
                />
              </MenuButton>
            </div>
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
                          option.current
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
        </div>

        {/* Product Grid */}
        {filteredProducts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              {allProducts.length === 0 
                ? 'No live products available at the moment.'
                : 'No products match your filters. Try adjusting your search criteria.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4 xl:gap-x-8">
            {filteredProducts.map((product, index) => {
              // Validate image URL before rendering to prevent XSS
              const isValidImage = validateImageUrl(product.imageSrc);
              const imageUrl = isValidImage 
                ? product.imageSrc 
                : 'https://via.placeholder.com/400x400?text=No+Image';
              
              return (
                <div key={product.id} className="group relative">
                  <Link to={product.href} prefetch="intent" className="block">
                    <img
                      alt={product.imageAlt}
                      src={imageUrl}
                      loading={index < 8 ? 'eager' : 'lazy'}
                      decoding="async"
                      className="aspect-square w-full rounded-md bg-gray-200 dark:bg-gray-800 object-cover group-hover:opacity-75 lg:aspect-auto lg:h-80"
                      onError={(e) => {
                        // Fallback to placeholder if image fails to load
                        e.target.src = 'https://via.placeholder.com/400x400?text=No+Image';
                      }}
                    />
                  </Link>
                <div className="mt-4 flex justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm text-gray-700 dark:text-gray-300">
                      <Link to={product.href} prefetch="intent" className="hover:text-indigo-600 dark:hover:text-indigo-400">
                        <span aria-hidden="true" className="absolute inset-0" />
                        <span className="line-clamp-2">{product.name}</span>
                      </Link>
                    </h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">{product.creatorName}</p>
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white ml-2 flex-shrink-0">{product.priceFormatted}</p>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Error boundary for shop page
 * Catches errors during rendering and provides fallback UI
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
      : 'We encountered an error loading the shop page. Please try refreshing the page.';
  } else if (error instanceof Error && isDev) {
    errorMessage = error.message;
  }
  
  // Log full error server-side but don't expose to client in production
  if (!isDev) {
    console.error('ErrorBoundary caught:', error);
  }
  
  return (
    <div className="bg-white dark:bg-gray-900 min-h-screen">
      <div className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 sm:pb-24 lg:max-w-7xl lg:px-8">
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <h2 className="text-lg font-medium text-red-800 dark:text-red-200 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-red-700 dark:text-red-300">
            {errorMessage}
          </p>
          {isDev && error instanceof Error && error.stack && (
            <pre className="mt-4 text-xs overflow-auto text-red-600 dark:text-red-400">
              {error.stack}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/shop._index').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */