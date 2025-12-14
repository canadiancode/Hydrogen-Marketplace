import {useLoaderData, Outlet, useMatches} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';

export const meta = ({data}) => {
  return [{title: `WornVault | Listing ${data?.listing.id ?? ''}`}];
};

export async function loader({params, context, request}) {
  // Require authentication
  const {user} = await requireAuth(request, context.env);
  
  const {id} = params;
  // Fetch listing data from Supabase
  // const listing = await fetchCreatorListingById(context, id);
  
  return {
    user,
    listing: {id, title: 'Listing Title'}, // Replace with actual data
  };
}

export default function CreatorListingDetail() {
  const {listing} = useLoaderData();
  const matches = useMatches();
  
  // Check if we're on a child route (like edit)
  const isChildRoute = matches.some(match => 
    match.id === 'routes/creator.listings.$id.edit'
  );
  
  // If we're on a child route (like edit), render the Outlet for the child route
  if (isChildRoute) {
    return <Outlet />;
  }
  
  // Otherwise, render the detail view
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">{listing.title}</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            View listing details, status timeline, and shipping instructions. This view provides transparency without full editing control after approval.
          </p>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          {/* Listing details will go here */}
          {/* Status timeline will go here */}
          {/* Shipping instructions (only after sale) will go here */}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.listings.$id').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

