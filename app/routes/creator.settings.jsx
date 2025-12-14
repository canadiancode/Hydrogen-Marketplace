import {Form, useLoaderData} from 'react-router';

export const meta = () => {
  return [{title: 'WornVault | Account Settings'}];
};

export async function loader({context}) {
  // Fetch creator profile from Supabase
  // const profile = await fetchCreatorProfile(context);
  
  return {
    profile: {
      displayName: '',
      bio: '',
      payoutMethod: '',
      notificationEmail: '',
    },
  };
}

export async function action({request, context}) {
  const formData = await request.formData();
  
  // Update creator profile in Supabase
  // await updateCreatorProfile(context, {
  //   displayName: formData.get('displayName'),
  //   bio: formData.get('bio'),
  //   payoutMethod: formData.get('payoutMethod'),
  //   notificationEmail: formData.get('notificationEmail'),
  // });
  
  return {success: true};
}

export default function CreatorSettings() {
  const {profile} = useLoaderData();
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Account Settings</h1>
          <p className="text-lg text-gray-600">
            Manage your profile and payout settings. Update your display name, bio, payout method, and notification email.
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-6">
          <Form method="post" className="space-y-6">
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
                Display Name
              </label>
              <input
                type="text"
                id="displayName"
                name="displayName"
                defaultValue={profile.displayName}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            <div>
              <label htmlFor="bio" className="block text-sm font-medium text-gray-700 mb-2">
                Bio
              </label>
              <textarea
                id="bio"
                name="bio"
                rows={4}
                defaultValue={profile.bio}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            <div>
              <label htmlFor="payoutMethod" className="block text-sm font-medium text-gray-700 mb-2">
                Payout Method
              </label>
              <input
                type="text"
                id="payoutMethod"
                name="payoutMethod"
                defaultValue={profile.payoutMethod}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            <div>
              <label htmlFor="notificationEmail" className="block text-sm font-medium text-gray-700 mb-2">
                Notification Email
              </label>
              <input
                type="email"
                id="notificationEmail"
                name="notificationEmail"
                defaultValue={profile.notificationEmail}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            <button
              type="submit"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Save Changes
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.settings').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

