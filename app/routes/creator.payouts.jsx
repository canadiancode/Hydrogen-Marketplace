import {useLoaderData} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';

export const meta = () => {
  return [{title: 'WornVault | Payouts'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user} = await requireAuth(request, context.env);
  
  // Fetch creator payouts from Supabase
  // const payouts = await fetchCreatorPayouts(context);
  
  return {
    user,
    completedPayouts: [],
    pendingPayouts: [],
  };
}

export default function CreatorPayouts() {
  const {completedPayouts, pendingPayouts} = useLoaderData();
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Payouts</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            View your financial clarity with completed payouts, pending payouts, and detailed fee breakdowns.
          </p>
        </div>
        
        <div className="space-y-6">
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Pending Payouts</h2>
            {/* Display pending payouts */}
          </section>
          
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Completed Payouts</h2>
            {/* Display completed payouts */}
          </section>
          
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Fee Breakdown</h2>
            {/* Display fee breakdown */}
          </section>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.payouts').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

