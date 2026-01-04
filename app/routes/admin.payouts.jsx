import {useLoaderData, redirect} from 'react-router';
import {checkAdminAuth} from '~/lib/supabase';

export const meta = () => {
  return [{title: 'WornVault | Admin Payouts'}];
};

export async function loader({request, context}) {
  // Defense in depth: Verify admin auth even though parent route checks it
  // This ensures child routes are protected even if parent route is bypassed
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  // Fetch payout data from Supabase
  // const payoutData = await fetchPayoutData(context);
  
  return {
    payouts: [],
    pendingPayouts: [],
    completedPayouts: [],
  };
}

export default function AdminPayouts() {
  const {payouts, pendingPayouts, completedPayouts} = useLoaderData();
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Admin Payouts</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Manage creator payouts, track payment status, and process payments to PayPal accounts.
          </p>
        </div>
        
        <div className="space-y-6">
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Pending Payouts</h2>
            {/* Display pending payouts */}
            {/* Process payments to creators */}
          </section>
          
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Completed Payouts</h2>
            {/* Display completed payouts */}
          </section>
          
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Payout History</h2>
            {/* Payout history and analytics */}
          </section>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/admin.payouts').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

