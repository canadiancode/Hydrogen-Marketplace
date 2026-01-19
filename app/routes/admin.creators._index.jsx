import {useLoaderData, useSearchParams, redirect, Link, Form, useActionData, useNavigation} from 'react-router';
import {useState, useEffect, useMemo, useRef} from 'react';
import {checkAdminAuth, fetchAllCreators, createServerSupabaseClient} from '~/lib/supabase';
import {ChevronDownIcon, FunnelIcon} from '@heroicons/react/20/solid';
import {Disclosure, DisclosureButton, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react';
import {generateCSRFToken, getClientIP, constantTimeEquals} from '~/lib/auth-helpers';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {decodeHTMLEntities} from '~/lib/html-entities';

export const meta = () => {
  return [{title: 'WornVault | Admin Creators'}];
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
    console.error('Missing Supabase configuration for admin creators. SUPABASE_SERVICE_ROLE_KEY is required for admin operations.');
    return {
      allCreators: [],
      error: 'Server configuration error. Please ensure SUPABASE_SERVICE_ROLE_KEY is set.',
      csrfToken: null,
    };
  }
  
  // Generate CSRF token for bulk actions
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  
  // Validate and sanitize URL parameters to prevent injection
  const url = new URL(request.url);
  const dateFromParam = url.searchParams.get('dateFrom');
  const dateToParam = url.searchParams.get('dateTo');
  const searchParam = url.searchParams.get('search');
  const verificationStatusParam = url.searchParams.get('verificationStatus');
  const paypalVerificationStatusParam = url.searchParams.get('paypalVerificationStatus');
  const sortParam = url.searchParams.get('sort');
  
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
  
  // Validate search parameter (max 200 chars, alphanumeric + email chars)
  let sanitizedSearch = null;
  if (searchParam) {
    const trimmed = String(searchParam).trim().substring(0, 200);
    if (/^[a-zA-Z0-9@._\s-]+$/.test(trimmed) && trimmed.length > 0) {
      sanitizedSearch = trimmed;
    }
  }
  
  // Validate verification status parameter
  const validVerificationStatuses = ['pending', 'approved', 'rejected'];
  let sanitizedVerificationStatus = null;
  if (verificationStatusParam) {
    const trimmed = String(verificationStatusParam).trim();
    if (validVerificationStatuses.includes(trimmed)) {
      sanitizedVerificationStatus = trimmed;
    }
  }
  
  // Validate PayPal verification status parameter
  const validPaypalVerificationStatuses = ['pending', 'verified'];
  let sanitizedPaypalVerificationStatus = null;
  if (paypalVerificationStatusParam) {
    const trimmed = String(paypalVerificationStatusParam).trim();
    if (validPaypalVerificationStatuses.includes(trimmed)) {
      sanitizedPaypalVerificationStatus = trimmed;
    }
  }
  
  // Validate sort parameter
  const validSorts = ['newest', 'oldest', 'name', 'email', 'handle', 'verification_status'];
  let sanitizedSort = 'newest';
  if (sortParam) {
    const trimmed = String(sortParam).trim();
    if (validSorts.includes(trimmed)) {
      sanitizedSort = trimmed;
    }
  }
  
  try {
    // Fetch all creators using service role key (bypasses RLS)
    // Filtering will be done client-side for better UX
    const allCreators = await fetchAllCreators(supabaseUrl, serviceRoleKey);
    
    return {
      allCreators,
      csrfToken,
    };
  } catch (error) {
    console.error('Error fetching admin creators:', error);
    return {
      allCreators: [],
      error: 'Failed to load creators. Please try again later.',
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
    `admin-bulk-action-creators:${user.email}:${clientIP}`,
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
  if (!constantTimeEquals(csrfToken.toString(), storedCSRFToken)) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  // Clear CSRF token after use (one-time use)
  context.session.unset('csrf_token');
  
  // Get bulk action parameters
  const actionType = formData.get('actionType');
  const newStatus = formData.get('newStatus');
  const creatorIds = formData.getAll('creatorIds').filter(Boolean);
  
  if (actionType === 'bulk_update_status') {
    if (!newStatus || creatorIds.length === 0) {
      return new Response('Missing required parameters', {status: 400});
    }
    
    // Validate and sanitize status - prevent injection
    const validStatuses = ['pending', 'approved', 'rejected'];
    
    // Ensure status is a string and matches exactly (case-sensitive)
    const sanitizedStatus = String(newStatus).trim();
    if (!validStatuses.includes(sanitizedStatus)) {
      return new Response('Invalid status', {status: 400});
    }
    
    // Validate creator IDs - prevent injection
    // UUIDs are 36 characters (with hyphens) or 32 characters (without)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const MAX_CREATOR_IDS = 100; // Prevent bulk operations on too many items
    
    if (creatorIds.length > MAX_CREATOR_IDS) {
      return new Response(`Cannot update more than ${MAX_CREATOR_IDS} creators at once`, {status: 400});
    }
    
    // Validate each creator ID format
    const sanitizedCreatorIds = creatorIds
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
    
    if (sanitizedCreatorIds.length === 0) {
      return new Response('No valid creator IDs provided', {status: 400});
    }
    
    if (sanitizedCreatorIds.length !== creatorIds.length) {
      return new Response('Invalid creator ID format detected', {status: 400});
    }
    
    const supabaseUrl = context.env.SUPABASE_URL;
    const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response('Server configuration error', {status: 500});
    }
    
    try {
      const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
      
      // Bulk update creators using parameterized query (Supabase handles SQL injection prevention)
      const {error} = await supabase
        .from('creators')
        .update({verification_status: sanitizedStatus})
        .in('id', sanitizedCreatorIds);
      
      if (error) {
        console.error('Error bulk updating creators:', error);
        return new Response(`Failed to update creators: ${error.message}`, {status: 500});
      }
      
      // Redirect back to creators page with success message
      // Preserve current filter parameters (sanitized)
      const url = new URL(request.url);
      const currentParams = new URLSearchParams();
      
      // Only preserve safe filter parameters
      const safeParams = ['verificationStatus', 'paypalVerificationStatus', 'dateFrom', 'dateTo', 'search', 'sort'];
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
      currentParams.set('updatedCount', sanitizedCreatorIds.length.toString());
      
      return redirect(`/admin/creators?${currentParams.toString()}`);
    } catch (error) {
      console.error('Error in bulk update:', error);
      return new Response('An unexpected error occurred', {status: 500});
    }
  }
  
  return new Response('Invalid action', {status: 400});
}

export default function AdminCreators() {
  const {allCreators, error, csrfToken} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Check for bulk update success
  const bulkUpdated = searchParams.get('bulkUpdated') === 'true';
  const updatedCount = searchParams.get('updatedCount');
  
  // Selection state
  const [selectedCreators, setSelectedCreators] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);
  
  // Clear selection and success message after showing
  useEffect(() => {
    if (bulkUpdated) {
      setSelectedCreators(new Set());
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
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || '');
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [verificationStatusFilters, setVerificationStatusFilters] = useState(() => {
    const statusParam = searchParams.get('verificationStatus');
    return statusParam ? [statusParam] : [];
  });
  
  const [paypalVerificationStatusFilters, setPaypalVerificationStatusFilters] = useState(() => {
    const statusParam = searchParams.get('paypalVerificationStatus');
    return statusParam ? [statusParam] : [];
  });
  
  // Sort state - initialize from URL params
  const [sortBy, setSortBy] = useState(() => searchParams.get('sort') || 'newest');
  
  // Verification status options
  const verificationStatusOptions = [
    {value: 'pending', label: 'Pending'},
    {value: 'approved', label: 'Approved'},
    {value: 'rejected', label: 'Rejected'},
  ];
  
  // PayPal verification status options
  const paypalVerificationStatusOptions = [
    {value: 'pending', label: 'Pending'},
    {value: 'verified', label: 'Verified'},
  ];
  
  // Sort options
  const sortOptions = [
    {value: 'newest', label: 'Newest to Oldest', current: sortBy === 'newest'},
    {value: 'oldest', label: 'Oldest to Newest', current: sortBy === 'oldest'},
    {value: 'name', label: 'Name (A-Z)', current: sortBy === 'name'},
    {value: 'email', label: 'Email (A-Z)', current: sortBy === 'email'},
    {value: 'handle', label: 'Handle (A-Z)', current: sortBy === 'handle'},
    {value: 'verification_status', label: 'Verification Status', current: sortBy === 'verification_status'},
  ];
  
  // Apply filters and sorting to creators
  const filteredCreators = useMemo(() => {
    let filtered = [...allCreators];
    
    // Search filter (email, handle, display_name)
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(creator => {
        return (
          creator.email?.toLowerCase().includes(searchLower) ||
          creator.handle?.toLowerCase().includes(searchLower) ||
          creator.display_name?.toLowerCase().includes(searchLower) ||
          creator.first_name?.toLowerCase().includes(searchLower) ||
          creator.last_name?.toLowerCase().includes(searchLower)
        );
      });
    }
    
    // Verification status filter
    if (verificationStatusFilters.length > 0) {
      filtered = filtered.filter(creator => 
        verificationStatusFilters.includes(creator.verification_status)
      );
    }
    
    // PayPal verification status filter
    if (paypalVerificationStatusFilters.length > 0) {
      filtered = filtered.filter(creator => {
        // Only filter if creator has a PayPal email
        if (!creator.paypal_email) {
          return false;
        }
        
        // Check if the filter matches the verification status
        if (paypalVerificationStatusFilters.includes('verified')) {
          return creator.paypal_email_verified === true;
        }
        if (paypalVerificationStatusFilters.includes('pending')) {
          return creator.paypal_email_verified === false;
        }
        
        return false;
      });
    }
    
    // Date range filter
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      filtered = filtered.filter(creator => {
        const creatorDate = new Date(creator.created_at);
        return creatorDate >= fromDate;
      });
    }
    
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(creator => {
        const creatorDate = new Date(creator.created_at);
        return creatorDate <= toDate;
      });
    }
    
    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.created_at) - new Date(a.created_at);
        case 'oldest':
          return new Date(a.created_at) - new Date(b.created_at);
        case 'name':
          const aName = a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || '';
          const bName = b.display_name || `${b.first_name || ''} ${b.last_name || ''}`.trim() || b.email || '';
          return aName.localeCompare(bName);
        case 'email':
          return (a.email || '').localeCompare(b.email || '');
        case 'handle':
          return (a.handle || '').localeCompare(b.handle || '');
        case 'verification_status':
          return (a.verification_status || '').localeCompare(b.verification_status || '');
        default:
          return 0;
      }
    });
    
    return sorted;
  }, [allCreators, search, verificationStatusFilters, paypalVerificationStatusFilters, dateFrom, dateTo, sortBy]);
  
  // Update URL when filters or sort change
  useEffect(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (search) params.set('search', search);
    if (verificationStatusFilters.length > 0) {
      params.set('verificationStatus', verificationStatusFilters[0]); // For now, use first selected status
    }
    if (paypalVerificationStatusFilters.length > 0) {
      params.set('paypalVerificationStatus', paypalVerificationStatusFilters[0]); // For now, use first selected status
    }
    if (sortBy && sortBy !== 'newest') {
      params.set('sort', sortBy);
    }
    
    setSearchParams(params, {replace: true});
  }, [search, verificationStatusFilters, paypalVerificationStatusFilters, dateFrom, dateTo, sortBy, setSearchParams]);
  
  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (verificationStatusFilters.length > 0) count++;
    if (paypalVerificationStatusFilters.length > 0) count++;
    if (dateFrom) count++;
    if (dateTo) count++;
    if (search) count++;
    return count;
  }, [verificationStatusFilters, paypalVerificationStatusFilters, dateFrom, dateTo, search]);
  
  // Clear all filters
  const clearFilters = () => {
    setVerificationStatusFilters([]);
    setPaypalVerificationStatusFilters([]);
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setSelectedCreators(new Set());
    setSelectAll(false);
  };
  
  // Handle select all
  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedCreators(new Set(filteredCreators.map(c => c.id)));
      setSelectAll(true);
    } else {
      setSelectedCreators(new Set());
      setSelectAll(false);
    }
  };
  
  // Handle individual selection
  const handleSelectCreator = (creatorId, checked) => {
    const newSelected = new Set(selectedCreators);
    if (checked) {
      newSelected.add(creatorId);
    } else {
      newSelected.delete(creatorId);
      setSelectAll(false);
    }
    setSelectedCreators(newSelected);
    
    // Update select all state
    if (newSelected.size === filteredCreators.length) {
      setSelectAll(true);
    }
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
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Manage Creators</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            View and manage all creators on the platform.
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
              Successfully updated {updatedCount} creator{updatedCount !== '1' ? 's' : ''}
            </p>
          </div>
        )}
        
        {/* Stats Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Creators</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{allCreators.length}</p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Approved Creators</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
              {allCreators.filter(c => c.verification_status === 'approved').length}
            </p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Pending Verification</p>
            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">
              {allCreators.filter(c => c.verification_status === 'pending').length}
            </p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Pending PayPal Verification</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
              {allCreators.filter(c => c.paypal_email && !c.paypal_email_verified).length}
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
              <div className="grid auto-rows-min grid-cols-1 gap-y-10 md:grid-cols-2 lg:grid-cols-4 md:gap-x-6">
                {/* Search Filter */}
                <fieldset>
                  <legend className="block font-medium text-gray-900 dark:text-white">Search</legend>
                  <div className="pt-6 sm:pt-4">
                    <label htmlFor="search" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                      Email, Handle, or Name
                    </label>
                    <input
                      type="text"
                      id="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search creators..."
                      className="block w-full rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400"
                    />
                  </div>
                </fieldset>
                
                {/* Verification Status Filter */}
                <fieldset>
                  <legend className="block font-medium text-gray-900 dark:text-white">Verification Status</legend>
                  <div className="space-y-6 pt-6 sm:space-y-4 sm:pt-4">
                    {verificationStatusOptions.map((option, optionIdx) => (
                      <div key={option.value} className="flex items-center gap-3">
                        <Checkbox
                          id={`verification-${optionIdx}`}
                          name="verificationStatus[]"
                          checked={verificationStatusFilters.includes(option.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setVerificationStatusFilters([...verificationStatusFilters, option.value]);
                            } else {
                              setVerificationStatusFilters(verificationStatusFilters.filter(s => s !== option.value));
                            }
                          }}
                          aria-labelledby={`verification-label-${optionIdx}`}
                        />
                        <label
                          id={`verification-label-${optionIdx}`}
                          htmlFor={`verification-${optionIdx}`}
                          className="text-base text-gray-600 dark:text-gray-400 sm:text-sm cursor-pointer"
                        >
                          {option.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </fieldset>
                
                {/* PayPal Verification Status Filter */}
                <fieldset>
                  <legend className="block font-medium text-gray-900 dark:text-white">PayPal Verification Status</legend>
                  <div className="space-y-6 pt-6 sm:space-y-4 sm:pt-4">
                    {paypalVerificationStatusOptions.map((option, optionIdx) => (
                      <div key={option.value} className="flex items-center gap-3">
                        <Checkbox
                          id={`paypal-verification-${optionIdx}`}
                          name="paypalVerificationStatus[]"
                          checked={paypalVerificationStatusFilters.includes(option.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPaypalVerificationStatusFilters([...paypalVerificationStatusFilters, option.value]);
                            } else {
                              setPaypalVerificationStatusFilters(paypalVerificationStatusFilters.filter(s => s !== option.value));
                            }
                          }}
                          aria-labelledby={`paypal-verification-label-${optionIdx}`}
                        />
                        <label
                          id={`paypal-verification-label-${optionIdx}`}
                          htmlFor={`paypal-verification-${optionIdx}`}
                          className="text-base text-gray-600 dark:text-gray-400 sm:text-sm cursor-pointer"
                        >
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
              </div>
            </div>
          </DisclosurePanel>
        </Disclosure>
        
        {/* Bulk Action Bar */}
        {selectedCreators.size > 0 && (
          <div className="mb-6 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <p className="text-sm font-medium text-indigo-800 dark:text-indigo-200 whitespace-nowrap flex-shrink-0">
                {selectedCreators.size} creator{selectedCreators.size !== 1 ? 's' : ''} selected
              </p>
              <Form method="post" className="flex items-center gap-3 flex-wrap sm:flex-nowrap flex-shrink-0 min-w-0">
                <input type="hidden" name="csrf_token" value={csrfToken || ''} />
                <input type="hidden" name="actionType" value="bulk_update_status" />
                {Array.from(selectedCreators).map(id => (
                  <input key={id} type="hidden" name="creatorIds" value={id} />
                ))}
                <select
                  name="newStatus"
                  required
                  className="rounded-md border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-400 flex-shrink-0"
                >
                  <option value="">Select status...</option>
                  {verificationStatusOptions.map(option => (
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
                    setSelectedCreators(new Set());
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
        
        {/* All Creators */}
        {filteredCreators.length === 0 ? (
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <div className="text-center py-12">
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
                {allCreators.length === 0 ? 'No creators found.' : 'No creators match your filters.'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                {allCreators.length === 0 
                  ? 'Creators will appear here once they sign up.'
                  : 'Try adjusting your filters.'}
              </p>
            </div>
          </section>
        ) : (
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm border border-gray-200 dark:border-white/10">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
                All Creators ({filteredCreators.length})
              </h2>
              <Menu as="div" className="relative inline-block self-start sm:self-auto">
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
              <li className="px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="select-all-checkbox"
                    checked={selectAll && filteredCreators.length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    indeterminate={!selectAll && selectedCreators.size > 0 && selectedCreators.size < filteredCreators.length}
                    aria-label={`Select all ${filteredCreators.length} creators`}
                  />
                  <label
                    htmlFor="select-all-checkbox"
                    className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
                  >
                    Select all ({filteredCreators.length})
                  </label>
                </div>
              </li>
              
              {filteredCreators.map((creator) => (
                <CreatorItem
                  key={creator.id}
                  creator={creator}
                  isSelected={selectedCreators.has(creator.id)}
                  onSelect={(checked) => handleSelectCreator(creator.id, checked)}
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
 * Reusable Checkbox Component
 */
function Checkbox({
  id,
  name,
  checked = false,
  onChange,
  disabled = false,
  indeterminate = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className = '',
}) {
  const checkboxRef = useRef(null);
  
  // Handle indeterminate state
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  
  return (
    <div className="flex shrink-0 items-center -mt-0.5">
      <div className="group grid size-5 grid-cols-1">
        <input
          ref={checkboxRef}
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={`col-start-1 row-start-1 appearance-none rounded-sm border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 checked:border-indigo-600 dark:checked:border-indigo-400 checked:bg-indigo-600 dark:checked:bg-indigo-500 indeterminate:border-indigo-600 dark:indeterminate:border-indigo-400 indeterminate:bg-indigo-600 dark:indeterminate:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-400 disabled:border-gray-300 dark:disabled:border-white/10 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:checked:bg-gray-100 dark:disabled:checked:bg-white/5 forced-colors:appearance-auto cursor-pointer disabled:cursor-not-allowed ${className}`}
        />
        <svg
          fill="none"
          viewBox="0 0 14 14"
          aria-hidden="true"
          className="pointer-events-none col-start-1 row-start-1 size-4 self-center justify-self-center stroke-white group-has-disabled:stroke-gray-950/25 dark:group-has-disabled:stroke-gray-400/25"
        >
          <path
            d="M3 8L6 11L11 3.5"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-0 group-has-checked:opacity-100"
          />
          <path
            d="M3 7H11"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-0 group-has-indeterminate:opacity-100"
          />
        </svg>
      </div>
    </div>
  );
}

/**
 * Verification status badge component
 */
function VerificationStatusBadge({status}) {
  if (status === 'approved') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-green-50 px-4 py-2 !text-[11px] font-medium text-green-700 inset-ring inset-ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:inset-ring-green-500/20">
        Approved
      </p>
    );
  }
  
  if (status === 'pending') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-yellow-50 px-4 py-2 !text-[11px] font-medium text-yellow-800 inset-ring inset-ring-yellow-600/20 dark:bg-yellow-400/10 dark:text-yellow-500 dark:inset-ring-yellow-400/20">
        Pending
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
  
  return (
    <p className="!p-1 mt-0.5 rounded-md bg-gray-50 px-4 py-2 !text-[11px] font-medium text-gray-600 inset-ring inset-ring-gray-500/10 dark:bg-gray-400/10 dark:text-gray-400 dark:inset-ring-gray-400/20">
      Unknown
    </p>
  );
}

/**
 * Creator item component
 */
function CreatorItem({creator, isSelected, onSelect}) {
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const displayName = creator.display_name || 
    `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || 
    creator.email || 
    'Unknown';

  return (
    <li className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-x-6 py-5 px-4 sm:px-6 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
      {/* Checkbox and main content */}
      <div className="flex items-start gap-3 sm:gap-x-6 min-w-0 flex-1">
        {/* Checkbox for selection */}
        <div className="flex-shrink-0 pt-0.5">
          <Checkbox
            id={`creator-checkbox-${creator.id}`}
            checked={isSelected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={`Select creator: ${displayName}`}
          />
        </div>
        
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <Link
              to={`/admin/creators/${creator.id}`}
              className="text-sm/6 font-semibold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 break-words"
            >
              {displayName}
            </Link>
            <VerificationStatusBadge status={creator.verification_status} />
          </div>
          
          {/* Metadata - responsive layout */}
          <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-y-1 sm:gap-y-0 sm:gap-x-2 text-xs/5 text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-x-2 flex-wrap">
              <p className="truncate sm:whitespace-nowrap">
                <span className="font-medium sm:font-normal">Email:</span> {creator.email || 'N/A'}
              </p>
              {creator.handle && (
                <>
                  <svg viewBox="0 0 2 2" className="size-0.5 fill-current flex-shrink-0">
                    <circle r={1} cx={1} cy={1} />
                  </svg>
                  <p className="truncate">Handle: @{creator.handle}</p>
                </>
              )}
            </div>
            
            <div className="flex items-center gap-x-2 flex-wrap">
              <svg viewBox="0 0 2 2" className="size-0.5 fill-current flex-shrink-0">
                <circle r={1} cx={1} cy={1} />
              </svg>
              <p className="truncate sm:whitespace-nowrap">
                <span className="font-medium sm:font-normal">Joined:</span> <time dateTime={creator.created_at}>{formatDate(creator.created_at)}</time>
              </p>
            </div>
            
            {(creator.totalRevenue || creator.totalRevenue === 0) && (
              <div className="flex items-center gap-x-2 flex-wrap">
                <svg viewBox="0 0 2 2" className="size-0.5 fill-current flex-shrink-0">
                  <circle r={1} cx={1} cy={1} />
                </svg>
                <p className="truncate sm:whitespace-nowrap">
                  <span className="font-medium sm:font-normal">Revenue:</span> <span className="font-semibold text-blue-600 dark:text-blue-400">${(creator.totalRevenue || 0).toFixed(2)}</span>
                </p>
              </div>
            )}
            
            {creator.paypal_email && (
              <div className="flex items-center gap-x-2 flex-wrap">
                <svg viewBox="0 0 2 2" className="size-0.5 fill-current flex-shrink-0">
                  <circle r={1} cx={1} cy={1} />
                </svg>
                <p className="truncate sm:whitespace-nowrap">
                  {creator.paypal_email_verified ? (
                    <span className="text-green-600 dark:text-green-400">PayPal verified</span>
                  ) : (
                    <span className="text-yellow-600 dark:text-yellow-400">PayPal pending</span>
                  )}
                </p>
              </div>
            )}
          </div>
          
          {creator.bio && (
            <div className="mt-2">
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                {decodeHTMLEntities(creator.bio)}
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* Action button - hidden on mobile, shown on desktop */}
      <div className="flex flex-none items-center gap-x-4 sm:ml-auto">
        <Link
          to={`/admin/creators/${creator.id}`}
          className="hidden sm:block rounded-md bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 dark:bg-white/10 dark:text-white dark:shadow-none dark:inset-ring-white/5 dark:hover:bg-white/20"
        >
          View details<span className="sr-only">, {displayName}</span>
        </Link>
      </div>
    </li>
  );
}

/** @typedef {import('./+types/admin.creators._index').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
