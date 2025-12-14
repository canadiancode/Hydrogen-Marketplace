import {useLoaderData, redirect} from 'react-router';
import {checkAdminAuth} from '~/lib/supabase';

export const meta = () => {
  return [{title: 'WornVault | Admin Dashboard'}];
};

export async function loader({request, context}) {
  // Defense in depth: Verify admin auth even though parent route checks it
  // This ensures child routes are protected even if parent route is bypassed
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  // Fetch admin dashboard data from Supabase
  // const dashboardData = await fetchAdminDashboard(context);
  
  return {
    pendingApprovals: [],
    soldItemsAwaitingShipment: [],
    itemsInValidation: [],
    pendingPayouts: [],
  };
}

export default function AdminDashboard() {
  const {
    pendingApprovals,
    soldItemsAwaitingShipment,
    itemsInValidation,
    pendingPayouts,
  } = useLoaderData();
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
          <p className="text-lg text-gray-600">
            Operations overview for managing listings, shipments, validations, and payouts. Prioritizes operational control over polish.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Listings Pending Approval</h2>
            <p className="text-3xl font-bold text-indigo-600 mb-4">{pendingApprovals.length}</p>
            {/* Display pending approvals */}
          </section>
          
          <section className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Sold Items Awaiting Shipment</h2>
            <p className="text-3xl font-bold text-yellow-600 mb-4">{soldItemsAwaitingShipment.length}</p>
            {/* Display items awaiting shipment */}
          </section>
          
          <section className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Items in Validation</h2>
            <p className="text-3xl font-bold text-blue-600 mb-4">{itemsInValidation.length}</p>
            {/* Display items in validation */}
          </section>
          
          <section className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Pending Payouts</h2>
            <p className="text-3xl font-bold text-green-600 mb-4">{pendingPayouts.length}</p>
            {/* Display pending payouts */}
          </section>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/admin._index').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

