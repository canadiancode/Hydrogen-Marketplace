import {useLoaderData, redirect, Link} from 'react-router';
import {checkAdminAuth, fetchAllListings, fetchAdminRecentActivity} from '~/lib/supabase';

export const meta = () => {
  return [{title: 'WornVault | Admin Dashboard'}];
};

export async function loader({request, context}) {
  // Defense in depth: Verify admin auth even though parent route checks it
  // This ensures child routes are protected even if parent route is bypassed
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Initialize counts
  let pendingApprovals = 0;
  let liveListings = 0;
  let soldListings = 0;
  let completedListings = 0;
  let recentActivity = [];
  
  if (supabaseUrl && serviceRoleKey) {
    try {
      // Fetch all listings and recent activity in parallel
      const [allListings, activity] = await Promise.all([
        fetchAllListings(supabaseUrl, serviceRoleKey),
        fetchAdminRecentActivity(supabaseUrl, serviceRoleKey, {limit: 50}),
      ]);
      
      // Count listings by status
      pendingApprovals = allListings.filter(l => l.status === 'pending_approval').length;
      liveListings = allListings.filter(l => l.status === 'live').length;
      soldListings = allListings.filter(l => l.status === 'sold').length;
      completedListings = allListings.filter(l => l.status === 'completed').length;
      
      recentActivity = activity || [];
    } catch (error) {
      console.error('Error fetching admin dashboard data:', error);
      // Continue with zero counts if there's an error
    }
  }
  
  return {
    pendingApprovals,
    liveListings,
    soldListings,
    completedListings,
    recentActivity,
  };
}

/**
 * Formats a timestamp to a human-readable relative time
 * @param {string} timestamp - ISO timestamp string
 * @returns {string} Formatted time string
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Just now';
  
  const now = new Date();
  const time = new Date(timestamp);
  const diffInSeconds = Math.floor((now - time) / 1000);
  
  if (diffInSeconds < 60) {
    return 'Just now';
  }
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  }
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  }
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  }
  
  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInWeeks < 4) {
    return `${diffInWeeks} week${diffInWeeks > 1 ? 's' : ''} ago`;
  }
  
  // For older dates, show formatted date
  return time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: time.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

/**
 * Gets the icon and color for an admin activity type
 * @param {string} activityType - Type of activity
 * @returns {{icon: JSX.Element, bgColor: string, iconColor: string}}
 */
function getAdminActivityIcon(activityType) {
  const baseClasses = "h-5 w-5";
  
  // Creator activities
  if (activityType === 'creator_joined' || activityType === 'creator_created') {
    return {
      icon: (
        <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
      bgColor: 'bg-green-100 dark:bg-green-900/30',
      iconColor: 'text-green-600 dark:text-green-400',
    };
  }
  
  if (activityType === 'creator_status_changed' || activityType === 'creator_verification_status_changed') {
    return {
      icon: (
        <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'text-blue-600 dark:text-blue-400',
    };
  }
  
  // Listing activities
  if (activityType === 'listing_created' || activityType === 'listing_submitted') {
    return {
      icon: (
        <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
      iconColor: 'text-yellow-600 dark:text-yellow-400',
    };
  }
  
  if (activityType === 'listing_status_changed' || activityType === 'listing_approved' || activityType === 'listing_rejected') {
    return {
      icon: (
        <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
      bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
      iconColor: 'text-indigo-600 dark:text-indigo-400',
    };
  }
  
  if (activityType === 'listing_published' || activityType === 'listing_goes_live') {
    return {
      icon: (
        <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      bgColor: 'bg-green-100 dark:bg-green-900/30',
      iconColor: 'text-green-600 dark:text-green-400',
    };
  }
  
  // Default icon
  return {
    icon: (
      <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    bgColor: 'bg-gray-100 dark:bg-gray-700',
    iconColor: 'text-gray-600 dark:text-gray-400',
  };
}

/**
 * Admin Activity Item Component
 * Displays a single activity in the feed with creator/listing context
 * 
 * SECURITY: React automatically escapes text content in JSX, providing XSS protection.
 * Descriptions are also sanitized at insert time (see logActivity/logActivityAdmin).
 */
function AdminActivityItem({activity, isLast}) {
  const {icon, bgColor, iconColor} = getAdminActivityIcon(activity.type);
  
  return (
    <li>
      <div className="relative pb-8">
        {!isLast && (
          <span className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
        )}
        <div className="relative flex items-start space-x-3">
          <div className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${bgColor}`}>
            <div className={iconColor}>
              {icon}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div>
              <div className="text-sm">
                {/* SECURITY: React automatically escapes text content - safe from XSS */}
                <p className="text-gray-900 dark:text-white font-medium">{activity.description}</p>
                {activity.creator && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Creator: {activity.creator.displayName || activity.creator.handle || activity.creator.email}
                  </p>
                )}
                {activity.listing && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Listing: <Link to={`/admin/listings/${activity.listing.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                      {activity.listing.title}
                    </Link>
                  </p>
                )}
              </div>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {formatRelativeTime(activity.timestamp)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function AdminDashboard() {
  const {
    pendingApprovals,
    liveListings,
    soldListings,
    completedListings,
    recentActivity,
  } = useLoaderData();
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Admin Dashboard</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Welcome back! Here's an overview of platform operations and pending tasks.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <Link
            to="/admin/listings?status=pending_approval"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-yellow-500 text-white">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Pending Approval</dt>
                  <dd className="text-2xl font-semibold text-gray-900 dark:text-white">{pendingApprovals}</dd>
                </dl>
              </div>
            </div>
          </Link>

          <Link
            to="/admin/listings?status=live"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-green-500 text-white">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Live</dt>
                  <dd className="text-2xl font-semibold text-gray-900 dark:text-white">{liveListings}</dd>
                </dl>
              </div>
            </div>
          </Link>

          <Link
            to="/admin/listings?status=sold"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-blue-500 text-white">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Sold</dt>
                  <dd className="text-2xl font-semibold text-gray-900 dark:text-white">{soldListings}</dd>
                </dl>
              </div>
            </div>
          </Link>

          <Link
            to="/admin/listings?status=completed"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-purple-500 text-white">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Completed</dt>
                  <dd className="text-2xl font-semibold text-gray-900 dark:text-white">{completedListings}</dd>
                </dl>
              </div>
            </div>
          </Link>
        </div>

        {/* Quick Actions */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              to="/admin/listings"
              className="flex items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">Review Listings</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Approve or reject listing requests</p>
              </div>
            </Link>

            <Link
              to="/admin/logistics"
              className="flex items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">Manage Logistics</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Track shipments and deliveries</p>
              </div>
            </Link>

            <Link
              to="/admin"
              className="flex items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">View Reports</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Platform analytics and insights</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Recent Activity</h2>
          {recentActivity && recentActivity.length > 0 ? (
            <div className="flow-root">
              <ul className="-mb-8">
                {recentActivity.map((activity, index) => (
                  <AdminActivityItem key={activity.id || index} activity={activity} isLast={index === recentActivity.length - 1} />
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No recent activity</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Activity will appear here as operations are performed.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/admin._index').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

