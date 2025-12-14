import {useLoaderData, redirect} from 'react-router';
import {checkAdminAuth} from '~/lib/supabase';

export const meta = () => {
  return [{title: 'WornVault | Admin Logistics'}];
};

export async function loader({request, context}) {
  // Defense in depth: Verify admin auth even though parent route checks it
  // This ensures child routes are protected even if parent route is bypassed
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  // Fetch logistics data from Supabase
  // const logisticsData = await fetchLogisticsData(context);
  
  return {
    logisticsEvents: [],
    trackingNumbers: [],
  };
}

export default function AdminLogistics() {
  const {logisticsEvents, trackingNumbers} = useLoaderData();
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Admin Logistics</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Track physical item movement through logistics events, manage tracking numbers, and override statuses when needed.
          </p>
        </div>
        
        <div className="space-y-6">
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Logistics Events</h2>
            {/* Display logistics events */}
            {/* Track physical item movement */}
          </section>
          
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Tracking Numbers</h2>
            {/* Display tracking numbers */}
          </section>
          
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Status Overrides</h2>
            {/* Status override controls */}
          </section>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/admin.logistics').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

