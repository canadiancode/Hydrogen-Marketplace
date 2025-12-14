import {Form, redirect} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';

export const meta = () => {
  return [{title: 'WornVault | Create Listing'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user} = await requireAuth(request, context.env);
  
  return {user};
}

export async function action({request, context}) {
  // Require authentication
  const {user} = await requireAuth(request, context.env);
  
  const formData = await request.formData();
  
  // Create listing in Supabase
  // const listing = await createListing(context, {
  //   category: formData.get('category'),
  //   story: formData.get('story'),
  //   price: formData.get('price'),
  //   // reference photos
  // });
  
  // Listing status → pending_approval
  // Not publicly visible
  
  return redirect('/creator/listings');
}

export default function CreateListing() {
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Create New Listing</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Capture new inventory by providing category, story, price, and reference photos. After submission, your listing will be set to pending approval and won't be publicly visible until approved.
          </p>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <Form method="post" className="space-y-6">
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Category
              </label>
              <input
                type="text"
                id="category"
                name="category"
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400"
              />
            </div>
            <div>
              <label htmlFor="story" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Story
              </label>
              <textarea
                id="story"
                name="story"
                required
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400"
              />
            </div>
            <div>
              <label htmlFor="price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Price
              </label>
              <input
                type="number"
                id="price"
                name="price"
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400"
              />
            </div>
            <div>
              <label htmlFor="photos" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Reference Photos
              </label>
              <input
                type="file"
                id="photos"
                name="photos"
                multiple
                accept="image/*"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 dark:file:bg-indigo-900 dark:file:text-indigo-300 dark:hover:file:bg-indigo-800 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-400"
              />
            </div>
            <button
              type="submit"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-800"
            >
              Submit for Approval
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.listings.new').Route} Route */

