import {useLoaderData, useSearchParams, redirect, Link} from 'react-router';
import {useState, useEffect, useMemo, useRef} from 'react';
import {checkAdminAuth, fetchAllCreators, createServerSupabaseClient} from '~/lib/supabase';
import {ChevronDownIcon, FunnelIcon} from '@heroicons/react/20/solid';
import {Disclosure, DisclosureButton, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react';

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
    };
  }
  
  // Validate and sanitize URL parameters to prevent injection
  const url = new URL(request.url);
  const dateFromParam = url.searchParams.get('dateFrom');
  const dateToParam = url.searchParams.get('dateTo');
  const searchParam = url.searchParams.get('search');
  const verificationStatusParam = url.searchParams.get('verificationStatus');
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
  const validVerificationStatuses = ['pending', 'verified', 'rejected'];
  let sanitizedVerificationStatus = null;
  if (verificationStatusParam) {
    const trimmed = String(verificationStatusParam).trim();
    if (validVerificationStatuses.includes(trimmed)) {
      sanitizedVerificationStatus = trimmed;
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
    };
  } catch (error) {
    console.error('Error fetching admin creators:', error);
    return {
      allCreators: [],
      error: 'Failed to load creators. Please try again later.',
    };
  }
}

export default function AdminCreators() {
  const {allCreators, error} = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Filter state - initialize from URL params
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || '');
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [verificationStatusFilters, setVerificationStatusFilters] = useState(() => {
    const statusParam = searchParams.get('verificationStatus');
    return statusParam ? [statusParam] : [];
  });
  
  // Sort state - initialize from URL params
  const [sortBy, setSortBy] = useState(() => searchParams.get('sort') || 'newest');
  
  // Verification status options
  const verificationStatusOptions = [
    {value: 'pending', label: 'Pending'},
    {value: 'verified', label: 'Verified'},
    {value: 'rejected', label: 'Rejected'},
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
  }, [allCreators, search, verificationStatusFilters, dateFrom, dateTo, sortBy]);
  
  // Update URL when filters or sort change
  useEffect(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (search) params.set('search', search);
    if (verificationStatusFilters.length > 0) {
      params.set('verificationStatus', verificationStatusFilters[0]); // For now, use first selected status
    }
    if (sortBy && sortBy !== 'newest') {
      params.set('sort', sortBy);
    }
    
    setSearchParams(params, {replace: true});
  }, [search, verificationStatusFilters, dateFrom, dateTo, sortBy, setSearchParams]);
  
  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (verificationStatusFilters.length > 0) count++;
    if (dateFrom) count++;
    if (dateTo) count++;
    if (search) count++;
    return count;
  }, [verificationStatusFilters, dateFrom, dateTo, search]);
  
  // Clear all filters
  const clearFilters = () => {
    setVerificationStatusFilters([]);
    setDateFrom('');
    setDateTo('');
    setSearch('');
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
        
        {/* Stats Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Creators</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{allCreators.length}</p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Verified Creators</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
              {allCreators.filter(c => c.verification_status === 'verified').length}
            </p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Pending Verification</p>
            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">
              {allCreators.filter(c => c.verification_status === 'pending').length}
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
            <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                All Creators ({filteredCreators.length})
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
              {filteredCreators.map((creator) => (
                <CreatorItem key={creator.id} creator={creator} />
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
  if (status === 'verified') {
    return (
      <p className="!p-1 mt-0.5 rounded-md bg-green-50 px-4 py-2 !text-[11px] font-medium text-green-700 inset-ring inset-ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:inset-ring-green-500/20">
        Verified
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
function CreatorItem({creator}) {
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
    <li className="flex items-center justify-between gap-x-6 py-5 px-6 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-x-3">
          <Link
            to={`/admin/creators/${creator.id}`}
            className="text-sm/6 font-semibold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            {displayName}
          </Link>
          <VerificationStatusBadge status={creator.verification_status} />
        </div>
        <div className="mt-1 flex items-center gap-x-2 text-xs/5 text-gray-500 dark:text-gray-400">
          <p className="whitespace-nowrap">
            Email: {creator.email || 'N/A'}
          </p>
          {creator.handle && (
            <>
              <svg viewBox="0 0 2 2" className="size-0.5 fill-current">
                <circle r={1} cx={1} cy={1} />
              </svg>
              <p className="truncate">Handle: @{creator.handle}</p>
            </>
          )}
          <svg viewBox="0 0 2 2" className="size-0.5 fill-current">
            <circle r={1} cx={1} cy={1} />
          </svg>
          <p className="whitespace-nowrap">
            Joined <time dateTime={creator.created_at}>{formatDate(creator.created_at)}</time>
          </p>
        </div>
        {creator.bio && (
          <div className="mt-2">
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
              {creator.bio}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-none items-center gap-x-4">
        <Link
          to={`/admin/creators/${creator.id}`}
          className="hidden rounded-md bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 sm:block dark:bg-white/10 dark:text-white dark:shadow-none dark:inset-ring-white/5 dark:hover:bg-white/20"
        >
          View details<span className="sr-only">, {displayName}</span>
        </Link>
      </div>
    </li>
  );
}

/** @typedef {import('./+types/admin.creators._index').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
