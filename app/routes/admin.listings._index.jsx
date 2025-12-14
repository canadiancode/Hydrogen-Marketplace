import {useLoaderData, Link, redirect, Form, useActionData, useNavigation, useSearchParams} from 'react-router';
import {useState, useEffect, useMemo} from 'react';
import {checkAdminAuth, fetchAllListings, createServerSupabaseClient} from '~/lib/supabase';
import {PhotoIcon} from '@heroicons/react/24/outline';
import {ChevronDownIcon, FunnelIcon} from '@heroicons/react/20/solid';
import {Disclosure, DisclosureButton, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react';
import {generateCSRFToken, getClientIP} from '~/lib/auth-helpers';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {sanitizeHTML} from '~/lib/sanitize';

export const meta = () => {
  return [{title: 'WornVault | Admin Listings'}];
};

export async function loader({request, context}) {
  // Defense in depth: Verify admin auth even though parent route checks it
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase configuration for admin listings. SUPABASE_SERVICE_ROLE_KEY is required for admin operations.');
    return {
      allListings: [],
      pendingListings: [],
      error: 'Server configuration error. Please ensure SUPABASE_SERVICE_ROLE_KEY is set.',
      csrfToken: null,
    };
  }
  
  // Generate CSRF token for bulk actions
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  
  // Validate and sanitize URL parameters to prevent injection
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const dateFromParam = url.searchParams.get('dateFrom');
  const dateToParam = url.searchParams.get('dateTo');
  const sellerIdParam = url.searchParams.get('sellerId');
  const sortParam = url.searchParams.get('sort');
  
  // Validate status parameter
  const validStatuses = ['draft', 'pending_approval', 'live', 'sold', 'in_validation', 'shipped', 'completed', 'rejected'];
  let sanitizedStatus = null;
  if (statusParam) {
    const trimmed = String(statusParam).trim();
    if (validStatuses.includes(trimmed)) {
      sanitizedStatus = trimmed;
    }
  }
  
  // Validate date parameters (ISO date format: YYYY-MM-DD)
  const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  let sanitizedDateFrom = null;
  let sanitizedDateTo = null;
  
  if (dateFromParam && DATE_REGEX.test(String(dateFromParam).trim())) {
    sanitizedDateFrom = String(dateFromParam).trim();
  }
  if (dateToParam && DATE_REGEX.test(String(dateToParam).trim())) {
    sanitizedDateTo = String(dateToParam).trim();
  }
  
  // Validate seller ID parameter (max 200 chars, alphanumeric + email chars)
  let sanitizedSellerId = null;
  if (sellerIdParam) {
    const trimmed = String(sellerIdParam).trim().substring(0, 200);
    // Allow UUIDs, emails, and handles (alphanumeric + @._-)
    if (/^[a-zA-Z0-9@._-]+$/.test(trimmed) && trimmed.length > 0) {
      sanitizedSellerId = trimmed;
    }
  }
  
  // Validate sort parameter
  const validSorts = ['newest', 'oldest', 'price_high', 'price_low', 'status', 'title', 'creator'];
  let sanitizedSort = 'newest';
  if (sortParam) {
    const trimmed = String(sortParam).trim();
    if (validSorts.includes(trimmed)) {
      sanitizedSort = trimmed;
    }
  }
  
  try {
    // Fetch all listings using service role key (bypasses RLS)
    // Filtering will be done client-side for better UX
    const allListings = await fetchAllListings(supabaseUrl, serviceRoleKey);
    
    // Filter pending approvals for stats
    const pendingListings = allListings.filter(listing => listing.status === 'pending_approval');
    
    return {
      allListings,
      pendingListings,
      csrfToken,
    };
  } catch (error) {
    console.error('Error fetching admin listings:', error);
    return {
      allListings: [],
      pendingListings: [],
      error: 'Failed to load listings. Please try again later.',
      csrfToken,
    };
  }
}

export async function action({request, context}) {
  // Require admin authentication
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    return new Response('Unauthorized', {status: 403});
  }
  
  // Rate limiting: max 20 bulk actions per minute
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(
    request,
    `admin-bulk-action:${user.email}:${clientIP}`,
    {
      maxRequests: 20,
      windowMs: 60000, // 1 minute
    },
  );
  
  if (!rateLimit.allowed) {
    return new Response('Too many requests. Please wait a moment before trying again.', {
      status: 429,
    });
  }
  
  const formData = await request.formData();
  
  // Validate CSRF token using constant-time comparison to prevent timing attacks
  const csrfToken = formData.get('csrf_token');
  const storedCSRFToken = context.session.get('csrf_token');
  
  if (!csrfToken || !storedCSRFToken) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  // Constant-time comparison to prevent timing attacks
  // Simple implementation: ensure tokens match exactly
  if (csrfToken.length !== storedCSRFToken.length) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  let result = 0;
  for (let i = 0; i < csrfToken.length; i++) {
    result |= csrfToken.charCodeAt(i) ^ storedCSRFToken.charCodeAt(i);
  }
  
  if (result !== 0) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  // Clear CSRF token after use (one-time use)
  context.session.unset('csrf_token');
  
  // Get bulk action parameters
  const actionType = formData.get('actionType');
  const newStatus = formData.get('newStatus');
  const listingIds = formData.getAll('listingIds').filter(Boolean);
  
  if (actionType === 'bulk_update_status') {
    if (!newStatus || listingIds.length === 0) {
      return new Response('Missing required parameters', {status: 400});
    }
    
    // Validate and sanitize status - prevent injection
    const validStatuses = [
      'draft',
      'pending_approval',
      'live',
      'sold',
      'in_validation',
      'shipped',
      'completed',
      'rejected',
    ];
    
    // Ensure status is a string and matches exactly (case-sensitive)
    const sanitizedStatus = String(newStatus).trim();
    if (!validStatuses.includes(sanitizedStatus)) {
      return new Response('Invalid status', {status: 400});
    }
    
    // Validate listing IDs - prevent injection
    // UUIDs are 36 characters (with hyphens) or 32 characters (without)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const MAX_LISTING_IDS = 100; // Prevent bulk operations on too many items
    
    if (listingIds.length > MAX_LISTING_IDS) {
      return new Response(`Cannot update more than ${MAX_LISTING_IDS} listings at once`, {status: 400});
    }
    
    // Validate each listing ID format
    const sanitizedListingIds = listingIds
      .map(id => String(id).trim())
      .filter(id => {
        // Check if it's a valid UUID format
        if (!UUID_REGEX.test(id)) {
          return false;
        }
        // Additional length check
        if (id.length < 32 || id.length > 36) {
          return false;
        }
        return true;
      });
    
    if (sanitizedListingIds.length === 0) {
      return new Response('No valid listing IDs provided', {status: 400});
    }
    
    if (sanitizedListingIds.length !== listingIds.length) {
      return new Response('Invalid listing ID format detected', {status: 400});
    }
    
    const supabaseUrl = context.env.SUPABASE_URL;
    const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response('Server configuration error', {status: 500});
    }
    
    try {
      const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
      
      // Bulk update listings using parameterized query (Supabase handles SQL injection prevention)
      const {error} = await supabase
        .from('listings')
        .update({status: sanitizedStatus})
        .in('id', sanitizedListingIds);
      
      if (error) {
        console.error('Error bulk updating listings:', error);
        return new Response(`Failed to update listings: ${error.message}`, {status: 500});
      }
      
      // Redirect back to listings page with success message
      // Preserve current filter parameters (sanitized)
      const url = new URL(request.url);
      const currentParams = new URLSearchParams();
      
      // Only preserve safe filter parameters
      const safeParams = ['status', 'dateFrom', 'dateTo', 'sellerId', 'sort'];
      safeParams.forEach(param => {
        const value = url.searchParams.get(param);
        if (value) {
          // Validate and sanitize parameter values
          const sanitized = String(value).trim().substring(0, 200); // Max length
          if (sanitized && sanitized.length > 0) {
            currentParams.set(param, sanitized);
          }
        }
      });
      
      currentParams.set('bulkUpdated', 'true');
      currentParams.set('updatedCount', sanitizedListingIds.length.toString());
      
      return redirect(`/admin/listings?${currentParams.toString()}`);
    } catch (error) {
      console.error('Error in bulk update:', error);
      return new Response('An unexpected error occurred', {status: 500});
    }
  }
  
  return new Response('Invalid action', {status: 400});
}

export default function AdminListings() {
  const {allListings, pendingListings, error, csrfToken} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Check for bulk update success
  const bulkUpdated = searchParams.get('bulkUpdated') === 'true';
  const updatedCount = searchParams.get('updatedCount');
  
  // Selection state
  const [selectedListings, setSelectedListings] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);
  
  // Clear selection and success message after showing
  useEffect(() => {
    if (bulkUpdated) {
      setSelectedListings(new Set());
      setSelectAll(false);
      // Remove success params from URL after 5 seconds
      const timer = setTimeout(() => {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('bulkUpdated');
        newParams.delete('updatedCount');
        setSearchParams(newParams, {replace: true});
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [bulkUpdated, searchParams, setSearchParams]);
  
  // Filter state - initialize from URL params
  const [statusFilters, setStatusFilters] = useState(() => {
    const statusParam = searchParams.get('status');
    return statusParam ? [statusParam] : [];
  });
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || '');
  const [sellerId, setSellerId] = useState(() => searchParams.get('sellerId') || '');
  
  // Sort state - initialize from URL params
  const [sortBy, setSortBy] = useState(() => searchParams.get('sort') || 'newest');
  
  // Status options
  const statusOptions = [
    {value: 'draft', label: 'Draft'},
    {value: 'pending_approval', label: 'Pending Approval'},
    {value: 'live', label: 'Live'},
    {value: 'sold', label: 'Sold'},
    {value: 'in_validation', label: 'In Validation'},
    {value: 'shipped', label: 'Shipped'},
    {value: 'completed', label: 'Completed'},
    {value: 'rejected', label: 'Rejected'},
  ];
  
  // Sort options
  const sortOptions = [
    {value: 'newest', label: 'Newest to Oldest', current: sortBy === 'newest'},
    {value: 'oldest', label: 'Oldest to Newest', current: sortBy === 'oldest'},
    {value: 'price_high', label: 'Price: High to Low', current: sortBy === 'price_high'},
    {value: 'price_low', label: 'Price: Low to High', current: sortBy === 'price_low'},
    {value: 'status', label: 'Status (A-Z)', current: sortBy === 'status'},
    {value: 'title', label: 'Title (A-Z)', current: sortBy === 'title'},
    {value: 'creator', label: 'Creator (A-Z)', current: sortBy === 'creator'},
  ];
  
  // Apply filters and sorting to listings
  const filteredListings = useMemo(() => {
    let filtered = [...allListings];
    
    // Status filter
    if (statusFilters.length > 0) {
      filtered = filtered.filter(listing => statusFilters.includes(listing.status));
    }
    
    // Date range filter
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      filtered = filtered.filter(listing => {
        const listingDate = new Date(listing.created_at);
        return listingDate >= fromDate;
      });
    }
    
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(listing => {
        const listingDate = new Date(listing.created_at);
        return listingDate <= toDate;
      });
    }
    
    // Seller ID filter
    if (sellerId) {
      filtered = filtered.filter(listing => {
        return listing.creator_id === sellerId || 
               (listing.creator && (
                 listing.creator.id === sellerId ||
                 listing.creator.email?.toLowerCase().includes(sellerId.toLowerCase()) ||
                 listing.creator.handle?.toLowerCase().includes(sellerId.toLowerCase())
               ));
      });
    }
    
    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.created_at) - new Date(a.created_at);
        case 'oldest':
          return new Date(a.created_at) - new Date(b.created_at);
        case 'price_high':
          return parseFloat(b.price || 0) - parseFloat(a.price || 0);
        case 'price_low':
          return parseFloat(a.price || 0) - parseFloat(b.price || 0);
        case 'status':
          return (a.status || '').localeCompare(b.status || '');
        case 'title':
          return (a.title || '').localeCompare(b.title || '');
        case 'creator':
          const aCreator = a.creator?.display_name || a.creator?.email || '';
          const bCreator = b.creator?.display_name || b.creator?.email || '';
          return aCreator.localeCompare(bCreator);
        default:
          return 0;
      }
    });
    
    return sorted;
  }, [allListings, statusFilters, dateFrom, dateTo, sellerId, sortBy]);
  
  // Update URL when filters or sort change
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilters.length > 0) {
      params.set('status', statusFilters[0]); // For now, use first selected status
    }
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (sellerId) params.set('sellerId', sellerId);
    if (sortBy && sortBy !== 'newest') {
      params.set('sort', sortBy);
    }
    
    setSearchParams(params, {replace: true});
  }, [statusFilters, dateFrom, dateTo, sellerId, sortBy, setSearchParams]);
  
  // Handle select all
  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedListings(new Set(filteredListings.map(l => l.id)));
      setSelectAll(true);
    } else {
      setSelectedListings(new Set());
      setSelectAll(false);
    }
  };
  
  // Handle individual selection
  const handleSelectListing = (listingId, checked) => {
    const newSelected = new Set(selectedListings);
    if (checked) {
      newSelected.add(listingId);
    } else {
      newSelected.delete(listingId);
      setSelectAll(false);
    }
    setSelectedListings(newSelected);
    
    // Update select all state
    if (newSelected.size === filteredListings.length) {
      setSelectAll(true);
    }
  };
  
  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statusFilters.length > 0) count++;
    if (dateFrom) count++;
    if (dateTo) count++;
    if (sellerId) count++;
    return count;
  }, [statusFilters, dateFrom, dateTo, sellerId]);
  
  // Clear all filters
  const clearFilters = () => {
    setStatusFilters([]);
    setDateFrom('');
    setDateTo('');
    setSellerId('');
    setSelectedListings(new Set());
    setSelectAll(false);
  };
  
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
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Manage Listings</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Review and approve creator listing requests. Manage all listings across the platform.
          </p>
        </div>
        
        {error && (
          <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {error}
            </p>
          </div>
        )}
        
        {bulkUpdated && updatedCount && (
          <div className="mb-6 rounded-md bg-green-50 dark:bg-green-900/20 p-4 border border-green-200 dark:border-green-800">
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              Successfully updated {updatedCount} listing{updatedCount !== '1' ? 's' : ''}
            </p>
          </div>
        )}
        
        {/* Stats Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Listings</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{allListings.length}</p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Pending Approval</p>
            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">{pendingListings.length}</p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Live Listings</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
              {allListings.filter(l => l.status === 'live').length}
            </p>
          </div>
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
                {/* Status Filter */}
                <fieldset>
                  <legend className="block font-medium text-gray-900 dark:text-white">Status</legend>
                  <div className="space-y-6 pt-6 sm:space-y-4 sm:pt-4">
                    {statusOptions.map((option, optionIdx) => (
                      <div key={option.value} className="flex gap-3">
                        <div className="flex h-5 shrink-0 items-center">
                          <div className="group grid size-4 grid-cols-1">
                            <input
                              id={`status-${optionIdx}`}
                              name="status[]"
                              type="checkbox"
                              checked={statusFilters.includes(option.value)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setStatusFilters([...statusFilters, option.value]);
                                } else {
                                  setStatusFilters(statusFilters.filter(s => s !== option.value));
                                }
                              }}
                              className="col-start-1 row-start-1 appearance-none rounded-sm border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 checked:border-indigo-600 dark:checked:border-indigo-400 checked:bg-indigo-600 dark:checked:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-400"
                            />
                            <svg
                              fill="none"
                              viewBox="0 0 14 14"
                              className="pointer-events-none col-start-1 row-start-1 size-3.5 self-center justify-self-center stroke-white"
                            >
                              <path
                                d="M3 8L6 11L11 3.5"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={statusFilters.includes(option.value) ? 'opacity-100' : 'opacity-0'}
                              />
                            </svg>
                          </div>
                        </div>
                        <label htmlFor={`status-${optionIdx}`} className="text-base text-gray-600 dark:text-gray-400 sm:text-sm">
                          {option.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </fieldset>
                
                {/* Date Range Filter */}
                <fieldset>
                  <legend className="block font-medium text-gray-900 dark:text-white">Date Range</legend>
                  <div className="space-y-4 pt-6 sm:pt-4">
                    <div>
                      <label htmlFor="dateFrom" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        From
                      </label>
                      <input
                        type="date"
                        id="dateFrom"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                      />
                    </div>
                    <div>
                      <label htmlFor="dateTo" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        To
                      </label>
                      <input
                        type="date"
                        id="dateTo"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                      />
                    </div>
                  </div>
                </fieldset>
                
                {/* Seller ID Filter */}
                <fieldset>
                  <legend className="block font-medium text-gray-900 dark:text-white">Seller</legend>
                  <div className="pt-6 sm:pt-4">
                    <label htmlFor="sellerId" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                      Seller ID, Email, or Handle
                    </label>
                    <input
                      type="text"
                      id="sellerId"
                      value={sellerId}
                      onChange={(e) => setSellerId(e.target.value)}
                      placeholder="Search by seller..."
                      className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                    />
                  </div>
                </fieldset>
              </div>
            </div>
          </DisclosurePanel>
        </Disclosure>
        
        {/* Bulk Action Bar */}
        {selectedListings.size > 0 && (
          <div className="mb-6 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <p className="text-sm font-medium text-indigo-800 dark:text-indigo-200 whitespace-nowrap flex-shrink-0">
                {selectedListings.size} listing{selectedListings.size !== 1 ? 's' : ''} selected
              </p>
              <Form method="post" className="flex items-center gap-3 flex-wrap sm:flex-nowrap flex-shrink-0 min-w-0">
                <input type="hidden" name="csrf_token" value={csrfToken || ''} />
                <input type="hidden" name="actionType" value="bulk_update_status" />
                {Array.from(selectedListings).map(id => (
                  <input key={id} type="hidden" name="listingIds" value={id} />
                ))}
                <select
                  name="newStatus"
                  required
                  className="rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400 flex-shrink-0"
                >
                  <option value="">Select status...</option>
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={navigation.state === 'submitting'}
                  className="rounded-md bg-indigo-600 dark:bg-indigo-500 px-6 py-2.5 text-base font-medium text-white hover:bg-indigo-700 dark:hover:bg-indigo-600 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
                >
                  {navigation.state === 'submitting' ? 'Updating...' : 'Update Status'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedListings(new Set());
                    setSelectAll(false);
                  }}
                  className="text-base font-medium text-indigo-800 dark:text-indigo-200 hover:text-indigo-900 dark:hover:text-indigo-100 whitespace-nowrap flex-shrink-0"
                >
                  Clear selection
                </button>
              </Form>
            </div>
          </div>
        )}
        
        {/* All Listings */}
        {filteredListings.length === 0 ? (
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <div className="text-center py-12">
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
                {allListings.length === 0 ? 'No listings found.' : 'No listings match your filters.'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                {allListings.length === 0 
                  ? 'Listings will appear here once creators submit them.'
                  : 'Try adjusting your filters.'}
              </p>
            </div>
          </section>
        ) : (
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm border border-gray-200 dark:border-white/10">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                All Listings ({filteredListings.length})
              </h2>
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
            <ul role="list" className="divide-y divide-gray-200 dark:divide-white/10">
              {/* Select All Checkbox */}
              <li className="px-6 py-3 border-b border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <div className="flex h-5 shrink-0 items-center">
                    <div className="group grid size-4 grid-cols-1">
                      <input
                        type="checkbox"
                        checked={selectAll && filteredListings.length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="col-start-1 row-start-1 appearance-none rounded-sm border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 checked:border-indigo-600 dark:checked:border-indigo-400 checked:bg-indigo-600 dark:checked:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-400"
                      />
                      <svg
                        fill="none"
                        viewBox="0 0 14 14"
                        className="pointer-events-none col-start-1 row-start-1 size-3.5 self-center justify-self-center stroke-white"
                      >
                        <path
                          d="M3 8L6 11L11 3.5"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={selectAll && filteredListings.length > 0 ? 'opacity-100' : 'opacity-0'}
                        />
                      </svg>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Select all ({filteredListings.length})
                  </span>
                </div>
              </li>
              
              {filteredListings.map((listing) => (
                <ListingItem
                  key={listing.id}
                  listing={listing}
                  isSelected={selectedListings.has(listing.id)}
                  onSelect={(checked) => handleSelectListing(listing.id, checked)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Status badge component - matches creator listings style
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
  
  if (status === 'test') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-orange-50 px-4 py-2 !text-[11px] font-medium text-orange-700 inset-ring inset-ring-orange-600/20 dark:bg-orange-400/10 dark:text-orange-400 dark:inset-ring-orange-500/20">
        Test
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
 * Listing item component - matches creator listings style with selection
 */
function ListingItem({listing, isSelected, onSelect}) {
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

  return (
    <li className="flex items-center justify-between gap-x-6 py-5 px-6 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
      {/* Checkbox for selection */}
      <div className="flex-shrink-0">
        <div className="flex h-5 shrink-0 items-center">
          <div className="group grid size-4 grid-cols-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => onSelect(e.target.checked)}
              className="col-start-1 row-start-1 appearance-none rounded-sm border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 checked:border-indigo-600 dark:checked:border-indigo-400 checked:bg-indigo-600 dark:checked:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-400"
            />
            <svg
              fill="none"
              viewBox="0 0 14 14"
              className="pointer-events-none col-start-1 row-start-1 size-3.5 self-center justify-self-center stroke-white"
            >
              <path
                d="M3 8L6 11L11 3.5"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isSelected ? 'opacity-100' : 'opacity-0'}
              />
            </svg>
          </div>
        </div>
      </div>
      
      {/* Photo thumbnail */}
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
          <Link
            to={`/admin/listings/${listing.id}`}
            className="text-sm/6 font-semibold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            {listing.title}
          </Link>
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
          {listing.creator && (
            <>
              <svg viewBox="0 0 2 2" className="size-0.5 fill-current">
                <circle r={1} cx={1} cy={1} />
              </svg>
              <p className="truncate">Creator: {listing.creator.display_name || listing.creator.email}</p>
            </>
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
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            ${listing.price}
          </p>
        </div>
      </div>
      <div className="flex flex-none items-center gap-x-4">
        <Link
          to={`/admin/listings/${listing.id}`}
          className="hidden rounded-md bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 sm:block dark:bg-white/10 dark:text-white dark:shadow-none dark:inset-ring-white/5 dark:hover:bg-white/20"
        >
          Review listing<span className="sr-only">, {listing.title}</span>
        </Link>
      </div>
    </li>
  );
}

/** @typedef {import('./+types/admin.listings._index').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
