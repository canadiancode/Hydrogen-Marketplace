import {Form, useLoaderData, useActionData, useNavigation} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';
import {fetchCreatorProfile, updateCreatorProfile} from '~/lib/supabase';

export const meta = () => {
  return [{title: 'WornVault | Account Settings'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  // Fetch creator profile from Supabase
  let profile = null;
  if (user?.email && session?.access_token) {
    try {
      profile = await fetchCreatorProfile(
        user.email,
        context.env.SUPABASE_URL,
        context.env.SUPABASE_ANON_KEY,
        session.access_token,
      );
    } catch (error) {
      console.error('Error fetching creator profile:', error);
      // Continue with null profile - will use defaults
    }
  }
  
  // Map database fields to form field names
  return {
    user,
    profile: profile
      ? {
          firstName: profile.first_name || '',
          lastName: profile.last_name || '',
          email: profile.email || user.email || '',
          username: profile.handle || '',
          displayName: profile.display_name || '',
          bio: profile.bio || '',
          payoutMethod: profile.payout_method || '',
        }
      : {
          firstName: '',
          lastName: '',
          email: user.email || '',
          username: '',
          displayName: '',
          bio: '',
          payoutMethod: '',
        },
  };
}

export async function action({request, context}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    return {
      success: false,
      error: 'Authentication required',
    };
  }
  
  const formData = await request.formData();
  
  try {
    // Extract form fields with explicit empty string handling
    const fieldErrors = {};
    const rawUpdates = {
      firstName: formData.get('first-name')?.toString().trim(),
      lastName: formData.get('last-name')?.toString().trim(),
      username: formData.get('username')?.toString().trim(),
      displayName: formData.get('displayName')?.toString().trim(),
      bio: formData.get('bio')?.toString().trim(),
      payoutMethod: formData.get('payoutMethod')?.toString().trim(),
      // Note: email is intentionally excluded - it's read-only and tied to auth
    };
    
    // Convert empty strings to undefined and validate required fields
    const updates = {};
    Object.keys(rawUpdates).forEach((key) => {
      const value = rawUpdates[key];
      if (value === '' || value === null) {
        // Skip empty values unless they're required fields
        if (key === 'displayName' || key === 'username') {
          fieldErrors[key] = `${key === 'displayName' ? 'Display name' : 'Username'} is required`;
        }
      } else {
        updates[key] = value;
      }
    });
    
    // Validate required fields
    if (!updates.displayName) {
      fieldErrors.displayName = 'Display name is required';
    }
    
    if (!updates.username) {
      fieldErrors.username = 'Username is required';
    }
    
    // Return field-level errors if any
    if (Object.keys(fieldErrors).length > 0) {
      return {
        success: false,
        error: 'Please fix the errors below',
        fieldErrors,
      };
    }
    
    // Update creator profile in Supabase
    await updateCreatorProfile(
      user.email,
      updates,
      context.env.SUPABASE_URL,
      context.env.SUPABASE_ANON_KEY,
      session.access_token,
    );
    
    return {
      success: true,
      message: 'Profile updated successfully',
    };
  } catch (error) {
    console.error('Error updating creator profile:', {
      error,
      userEmail: user.email,
      timestamp: new Date().toISOString(),
    });
    
    // Check if error is a unique constraint violation for username
    const errorMessage = error.message || 'Failed to update profile. Please try again.';
    const fieldErrors = {};
    
    if (errorMessage.includes('Username is already taken')) {
      fieldErrors.username = 'Username is already taken. Please choose a different username.';
    }
    
    return {
      success: false,
      error: fieldErrors.username ? 'Please fix the errors below' : errorMessage,
      fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
    };
  }
}

export default function CreatorSettings() {
  const {profile, user} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  
  return (
    <main className="bg-white dark:bg-gray-900">
      <h1 className="sr-only">Account Settings</h1>

      {/* Settings forms */}
      <div className="divide-y divide-gray-200 dark:divide-white/10 bg-white dark:bg-gray-900">
        {/* Personal Information Section */}
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8 bg-white dark:bg-gray-900">
          <div>
            <h2 className="text-base/7 font-semibold text-gray-900 dark:text-white">Personal Information</h2>
            <p className="mt-1 text-sm/6 text-gray-500 dark:text-gray-300">
              Update your profile information and preferences.
            </p>
          </div>

          <Form method="post" className="md:col-span-2">
            {/* Success/Error Messages */}
            {actionData?.success && (
              <div className="mb-6 rounded-md bg-green-50 p-4 dark:bg-green-900/20">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  {actionData.message || 'Profile updated successfully'}
                </p>
              </div>
            )}
            
            {actionData?.error && (
              <div className="mb-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {actionData.error}
                </p>
              </div>
            )}
            
            {/* Field-level error messages */}
            {actionData?.fieldErrors && Object.keys(actionData.fieldErrors).length > 0 && (
              <div className="mb-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                <ul className="list-disc list-inside space-y-1 text-sm text-red-800 dark:text-red-200">
                  {Object.entries(actionData.fieldErrors).map(([field, message]) => (
                    <li key={field}>{message}</li>
                  ))}
                </ul>
              </div>
            )}
            
            <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:max-w-xl sm:grid-cols-6">
              <div className="col-span-full flex items-center gap-x-8">
                <img
                  alt=""
                  src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                  className="size-24 flex-none rounded-lg bg-gray-100 object-cover outline -outline-offset-1 outline-black/5 dark:bg-gray-800 dark:outline-white/10"
                />
                <div>
                  <button
                    type="button"
                    className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring-1 inset-ring-gray-300 hover:bg-gray-100 dark:bg-white/10 dark:text-white dark:shadow-none dark:inset-ring-white/5 dark:hover:bg-white/20"
                  >
                    Change avatar
                  </button>
                  <p className="mt-2 text-xs/5 text-gray-500 dark:text-gray-300">JPG, GIF or PNG. 1MB max.</p>
                </div>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="first-name" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  First name
                </label>
                <div className="mt-2">
                  <input
                    id="first-name"
                    name="first-name"
                    type="text"
                    autoComplete="given-name"
                    defaultValue={profile.firstName}
                    className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                  />
                </div>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="last-name" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Last name
                </label>
                <div className="mt-2">
                  <input
                    id="last-name"
                    name="last-name"
                    type="text"
                    autoComplete="family-name"
                    defaultValue={profile.lastName}
                    className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                  />
                </div>
              </div>

              <div className="col-span-full">
                <label htmlFor="email" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Email address
                </label>
                <div className="mt-2">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    defaultValue={profile.email}
                    readOnly
                    className="block w-full rounded-md bg-gray-50 px-3 py-1.5 text-base text-gray-500 outline-1 -outline-offset-1 outline-gray-300 cursor-not-allowed sm:text-sm/6 dark:bg-gray-800 dark:text-gray-400 dark:outline-white/10"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Email cannot be changed as it's tied to your account authentication.
                  </p>
                </div>
              </div>

              <div className="col-span-full">
                <label htmlFor="username" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Username
                </label>
                <div className="mt-2">
                  <div className="flex items-center rounded-md bg-white pl-3 outline-1 -outline-offset-1 outline-gray-300 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:outline-white/10 dark:focus-within:outline-indigo-500">
                    <div className="shrink-0 text-base text-gray-500 select-none sm:text-sm/6 dark:text-gray-300">
                      example.com/
                    </div>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      placeholder="janesmith"
                      defaultValue={profile.username}
                      required
                      aria-invalid={actionData?.fieldErrors?.username ? 'true' : 'false'}
                      aria-describedby={actionData?.fieldErrors?.username ? 'username-error' : undefined}
                      className={`block min-w-0 grow bg-transparent py-1.5 pr-3 pl-1 text-base placeholder:text-gray-400 focus:outline-none sm:text-sm/6 dark:placeholder:text-gray-500 ${
                        actionData?.fieldErrors?.username
                          ? 'text-red-900 dark:text-red-200'
                          : 'text-gray-900 dark:text-white'
                      }`}
                    />
                  </div>
                  {actionData?.fieldErrors?.username && (
                    <p id="username-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {actionData.fieldErrors.username}
                    </p>
                  )}
                </div>
              </div>

              <div className="col-span-full">
                <label htmlFor="displayName" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Display Name
                </label>
                <div className="mt-2">
                  <input
                    id="displayName"
                    name="displayName"
                    type="text"
                    defaultValue={profile.displayName}
                    required
                    aria-invalid={actionData?.fieldErrors?.displayName ? 'true' : 'false'}
                    aria-describedby={actionData?.fieldErrors?.displayName ? 'displayName-error' : undefined}
                    className={`block w-full rounded-md bg-white px-3 py-1.5 text-base outline-1 -outline-offset-1 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 sm:text-sm/6 dark:bg-white/5 dark:outline-white/10 dark:placeholder:text-gray-500 ${
                      actionData?.fieldErrors?.displayName
                        ? 'text-red-900 outline-red-300 focus:outline-red-600 dark:text-red-200 dark:outline-red-500 dark:focus:outline-red-400'
                        : 'text-gray-900 outline-gray-300 focus:outline-indigo-600 dark:text-white dark:focus:outline-indigo-500'
                    }`}
                  />
                  {actionData?.fieldErrors?.displayName && (
                    <p id="displayName-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {actionData.fieldErrors.displayName}
                    </p>
                  )}
                </div>
              </div>

              <div className="col-span-full">
                <label htmlFor="bio" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Bio
                </label>
                <div className="mt-2">
                  <textarea
                    id="bio"
                    name="bio"
                    rows={4}
                    defaultValue={profile.bio}
                    className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                  />
                </div>
              </div>

              <div className="col-span-full">
                <label htmlFor="payoutMethod" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Payout Method
                </label>
                <div className="mt-2">
                  <input
                    id="payoutMethod"
                    name="payoutMethod"
                    type="text"
                    defaultValue={profile.payoutMethod}
                    className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div className="mt-8 flex">
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:shadow-none dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </Form>
        </div>

        {/* Delete Account Section */}
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8 bg-white dark:bg-gray-900">
          <div>
            <h2 className="text-base/7 font-semibold text-gray-900 dark:text-white">Delete account</h2>
            <p className="mt-1 text-sm/6 text-gray-500 dark:text-gray-300">
              No longer want to use our service? You can delete your account here. This action is not reversible.
              All information related to this account will be deleted permanently.
            </p>
          </div>

          <form className="flex items-start md:col-span-2">
            <button
              type="submit"
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-red-500 dark:bg-red-500 dark:shadow-none dark:hover:bg-red-400"
            >
              Yes, delete my account
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

/** @typedef {import('./+types/creator.settings').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

