import {Form, useLoaderData, redirect} from 'react-router';

export const meta = ({data}) => {
  return [{title: `WornVault | Review Listing ${data?.listing.id ?? ''}`}];
};

export async function loader({params, context}) {
  const {id} = params;
  // Fetch listing data from Supabase
  // const listing = await fetchListingById(context, id);
  
  return {
    listing: {
      id,
      title: 'Listing Title',
      referencePhotos: [],
      creatorInfo: {},
    },
  };
}

export async function action({request, params, context}) {
  const formData = await request.formData();
  const action = formData.get('action'); // 'approve' or 'reject'
  const notes = formData.get('notes');
  
  // Update listing status in Supabase
  // await updateListingStatus(context, params.id, {
  //   status: action === 'approve' ? 'approved' : 'rejected',
  //   adminNotes: notes,
  // });
  
  return redirect('/admin');
}

export default function AdminListingReview() {
  const {listing} = useLoaderData();
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Review Listing</h1>
          <p className="text-lg text-gray-600">
            Review listing details, reference photos, and creator information. Approve or reject listings with internal notes.
          </p>
        </div>
        
        <div className="space-y-6">
          <section className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Listing Details</h2>
            <div className="space-y-2">
              <p className="text-gray-700"><span className="font-medium">ID:</span> {listing.id}</p>
              <p className="text-gray-700"><span className="font-medium">Title:</span> {listing.title}</p>
            </div>
          </section>
          
          <section className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Reference Photos</h2>
            {/* Display reference photos */}
          </section>
          
          <section className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Creator Info</h2>
            {/* Display creator information */}
          </section>
          
          <section className="bg-white rounded-lg shadow-sm p-6">
            <Form method="post" className="space-y-6">
              <div>
                <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
                  Internal Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              
              <div className="flex gap-4">
                <button
                  type="submit"
                  name="action"
                  value="approve"
                  className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  Approve
                </button>
                <button
                  type="submit"
                  name="action"
                  value="reject"
                  className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Reject
                </button>
              </div>
            </Form>
          </section>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/admin.listings.$id').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

