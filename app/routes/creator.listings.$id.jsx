import {useLoaderData} from 'react-router';

export const meta = ({data}) => {
  return [{title: `WornVault | Listing ${data?.listing.id ?? ''}`}];
};

export async function loader({params, context}) {
  const {id} = params;
  // Fetch listing data from Supabase
  // const listing = await fetchCreatorListingById(context, id);
  
  return {
    listing: {id, title: 'Listing Title'}, // Replace with actual data
  };
}

export default function CreatorListingDetail() {
  const {listing} = useLoaderData();
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">{listing.title}</h1>
          <p className="text-lg text-gray-600">
            View listing details, status timeline, and shipping instructions. This view provides transparency without full editing control after approval.
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-6">
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

