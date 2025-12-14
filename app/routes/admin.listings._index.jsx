import {useLoaderData, Link, redirect} from 'react-router';
import {checkAdminAuth} from '~/lib/supabase';

export const meta = () => {
  return [{title: 'WornVault | Admin Listings'}];
};

export async function loader({request, context}) {
  // Defense in depth: Verify admin auth even though parent route checks it
  // This ensures child routes are protected even if parent route is bypassed
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  // TODO: Fetch pending listings from Supabase
  // const pendingListings = await fetchPendingListings(context);
  
  return {
    pendingListings: [],
  };
}

export default function AdminListings() {
  const {pendingListings} = useLoaderData();
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Manage Listings</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Review and approve creator listing requests. Manage pending approvals and handle rejections with notes.
          </p>
        </div>
        
        <div className="space-y-6">
          {pendingListings.length === 0 ? (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <div className="text-center py-12">
                <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
                  No pending listings at this time.
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-500">
                  All listing requests have been processed.
                </p>
              </div>
            </section>
          ) : (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm border border-gray-200 dark:border-white/10">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10">
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                  Pending Approvals ({pendingListings.length})
                </h2>
              </div>
              <ul className="divide-y divide-gray-200 dark:divide-white/10">
                {pendingListings.map((listing) => (
                  <li key={listing.id}>
                    <Link
                      to={`/admin/listings/${listing.id}`}
                      className="block px-6 py-4 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                            {listing.title}
                          </h3>
                          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Category: {listing.category} • Created: {new Date(listing.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="ml-4">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 dark:bg-yellow-400/10 text-yellow-800 dark:text-yellow-400">
                            Pending Review
                          </span>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/admin.listings._index').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
