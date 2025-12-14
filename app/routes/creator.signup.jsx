import {useLoaderData, Link} from 'react-router';
import {checkCreatorAuth} from '~/lib/supabase';
import {redirect} from 'react-router';

export const meta = () => {
  return [{title: 'WornVault | Complete Your Creator Profile'}];
};

export async function loader({context, request}) {
  // Check if user is authenticated
  const {isAuthenticated, user} = await checkCreatorAuth(request, context.env);
  
  if (!isAuthenticated || !user) {
    return redirect('/creator/login');
  }
  
  return {
    userEmail: user.email,
    completeProfile: new URL(request.url).searchParams.get('complete_profile') === 'true',
  };
}

export default function CreatorSignup() {
  const {userEmail, completeProfile} = useLoaderData();
  
  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mx-auto h-10 w-auto flex items-center justify-center">
          <span className="text-2xl font-bold text-indigo-600">WornVault</span>
        </div>
        <h2 className="mt-6 text-center text-2xl/9 font-bold tracking-tight text-gray-900">
          Complete Your Creator Profile
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {completeProfile 
            ? 'Welcome! Let\'s set up your creator profile to get started.'
            : 'Update your creator profile information.'}
        </p>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]">
        <div className="bg-white px-6 py-12 shadow-sm sm:rounded-lg sm:px-12">
          <div className="mb-6">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Email:</span> {userEmail}
            </p>
          </div>
          
          <div className="rounded-md bg-blue-50 p-4 mb-6">
            <p className="text-sm text-blue-800">
              <strong>Profile creation form coming soon!</strong>
              <br />
              For now, you're successfully authenticated. The profile creation form will be implemented next.
            </p>
          </div>

          <div className="mt-6">
            <Link
              to="/creator/dashboard"
              className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>

        <p className="mt-10 text-center text-sm/6 text-gray-500">
          Already have a profile?{' '}
          <Link
            to="/creator/dashboard"
            className="font-semibold text-indigo-600 hover:text-indigo-500"
          >
            Go to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.signup').Route} Route */

