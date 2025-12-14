import {useLoaderData, Link} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';

export async function loader({context, request}) {
  // Require authentication
  const {user} = await requireAuth(request, context.env);
  
  // Fetch creator's listings from Supabase
  // const listings = await fetchCreatorListings(context);
  
  return {
    user,
    listings: [],
  };
}

export default function CreatorListings() {
  const {listings} = useLoaderData();
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">My Listings</h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Manage your inventory overview. View all listings with status badges (pending, live, sold, in validation, completed).
            </p>
          </div>
          <Link
            to="/creator/listings/new"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-900"
          >
            Create New Listing
          </Link>
        </div>
        
        {/* Listings grid will go here */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Listing cards will be rendered here */}
        </div>
      </div>
    </div>
  );
}