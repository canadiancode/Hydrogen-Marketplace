import {useLoaderData, Link, redirect} from 'react-router';
import {checkAdminAuth, fetchAdminCreatorById} from '~/lib/supabase';
import {decodeHTMLEntities} from '~/lib/html-entities';

export const meta = ({data}) => {
  return [{title: `WornVault | Creator ${data?.creator?.display_name ?? data?.creator?.email ?? data?.creator?.id ?? ''}`}];
};

export async function loader({params, request, context}) {
  // Require admin authentication
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  const {id} = params;
  
  // Validate UUID format
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_REGEX.test(id)) {
    throw new Response('Invalid creator ID', {status: 400});
  }
  
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase configuration for admin creator detail');
    return {
      creator: null,
      error: 'Server configuration error. Please ensure SUPABASE_SERVICE_ROLE_KEY is set.',
    };
  }
  
  // Fetch creator data from Supabase
  const creator = await fetchAdminCreatorById(id, supabaseUrl, serviceRoleKey);
  
  if (!creator) {
    throw new Response('Creator not found', {status: 404});
  }
  
  return {
    creator,
  };
}

export default function AdminCreatorDetail() {
  const {creator, error} = useLoaderData();
  
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      </div>
    );
  }
  
  if (!creator) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg p-6">
            <p className="text-gray-700 dark:text-gray-300">Creator not found.</p>
          </div>
        </div>
      </div>
    );
  }
  
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  const formatCurrency = (dollars) => {
    return `$${dollars.toFixed(2)}`;
  };
  
  const StatusBadge = ({status}) => {
    const statusConfig = {
      pending: {bg: 'bg-yellow-50', text: 'text-yellow-800', label: 'Pending'},
      approved: {bg: 'bg-green-50', text: 'text-green-700', label: 'Approved'},
      rejected: {bg: 'bg-red-50', text: 'text-red-700', label: 'Rejected'},
    };
    
    const config = statusConfig[status] || statusConfig.pending;
    
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };
  
  const VerificationStatusBadge = ({status}) => {
    if (status === 'approved' || status === 'verified') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400">
          Verified
        </span>
      );
    }
    
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-50 text-yellow-800 dark:bg-yellow-400/10 dark:text-yellow-500">
          Pending
        </span>
      );
    }
    
    if (status === 'rejected') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-400">
          Rejected
        </span>
      );
    }
    
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-50 text-gray-600 dark:bg-gray-400/10 dark:text-gray-400">
        Unknown
      </span>
    );
  };
  
  const ListingStatusBadge = ({status}) => {
    const statusConfig = {
      draft: {bg: 'bg-gray-50', text: 'text-gray-600', label: 'Draft'},
      pending_approval: {bg: 'bg-yellow-50', text: 'text-yellow-800', label: 'Pending Approval'},
      live: {bg: 'bg-green-50', text: 'text-green-700', label: 'Live'},
      sold: {bg: 'bg-blue-50', text: 'text-blue-700', label: 'Sold'},
      in_validation: {bg: 'bg-purple-50', text: 'text-purple-700', label: 'In Validation'},
      shipped: {bg: 'bg-indigo-50', text: 'text-indigo-700', label: 'Shipped'},
      completed: {bg: 'bg-green-50', text: 'text-green-700', label: 'Completed'},
      rejected: {bg: 'bg-red-50', text: 'text-red-700', label: 'Rejected'},
    };
    
    const config = statusConfig[status] || statusConfig.draft;
    
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };
  
  const PayoutStatusBadge = ({status}) => {
    const statusConfig = {
      pending: {bg: 'bg-yellow-50', text: 'text-yellow-800', label: 'Pending'},
      processing: {bg: 'bg-blue-50', text: 'text-blue-700', label: 'Processing'},
      paid: {bg: 'bg-green-50', text: 'text-green-700', label: 'Paid'},
    };
    
    const config = statusConfig[status] || statusConfig.pending;
    
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };
  
  const displayName = creator.display_name || 
    `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || 
    creator.email || 
    'Unknown';
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">{displayName}</h1>
              <VerificationStatusBadge status={creator.verification_status} />
            </div>
            <Link
              to="/admin/creators"
              className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
            >
              ← Back to Creators
            </Link>
          </div>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            View creator details, listings, payouts, and verification information.
          </p>
        </div>
        
        <div className="space-y-6">
          {/* Creator Details */}
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Creator Details</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Creator ID</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{creator.id}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Verification Status</dt>
                <dd className="mt-1">
                  <VerificationStatusBadge status={creator.verification_status} />
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Email</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.email}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Handle</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">@{creator.handle || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Display Name</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.display_name || 'N/A'}</dd>
              </div>
              {creator.first_name && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">First Name</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.first_name}</dd>
                </div>
              )}
              {creator.last_name && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Last Name</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.last_name}</dd>
                </div>
              )}
              {creator.primary_platform && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Primary Platform</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.primary_platform}</dd>
                </div>
              )}
              {creator.payout_method && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Payout Method</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.payout_method}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created At</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatDate(creator.created_at)}</dd>
              </div>
              {creator.profile_image_url && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Profile Image</dt>
                  <dd className="mt-1">
                    <img
                      src={creator.profile_image_url}
                      alt={displayName}
                      className="h-24 w-24 rounded-full object-cover"
                    />
                  </dd>
                </div>
              )}
              {creator.bio && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Bio</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{decodeHTMLEntities(creator.bio)}</dd>
                </div>
              )}
            </dl>
          </section>
          
          {/* Verification Information */}
          {creator.verification && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Verification Information</h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Verification ID</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{creator.verification.id}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</dt>
                  <dd className="mt-1">
                    <StatusBadge status={creator.verification.status} />
                  </dd>
                </div>
                {creator.verification.reviewed_by && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Reviewed By</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.verification.reviewed_by}</dd>
                  </div>
                )}
                {creator.verification.internal_notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Internal Notes</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{creator.verification.internal_notes}</dd>
                  </div>
                )}
                {creator.verification.submitted_links && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Submitted Links</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(creator.verification.submitted_links, null, 2)}</pre>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created At</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatDate(creator.verification.created_at)}</dd>
                </div>
              </dl>
            </section>
          )}
          
          {/* Stats Summary */}
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Statistics</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Listings</dt>
                <dd className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{creator.totalListings || 0}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Payouts</dt>
                <dd className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{creator.totalPayouts || 0}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Earnings</dt>
                <dd className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(creator.totalEarnings || 0)}
                </dd>
              </div>
            </dl>
          </section>
          
          {/* Listings */}
          {creator.listings && creator.listings.length > 0 && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Listings ({creator.listings.length})</h2>
              <div className="space-y-3">
                {creator.listings.map((listing) => (
                  <div key={listing.id} className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Link
                            to={`/admin/listings/${listing.id}`}
                            className="text-sm font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
                          >
                            {listing.title}
                          </Link>
                          <ListingStatusBadge status={listing.status} />
                        </div>
                        <div className="flex items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>Price: {formatCurrency(listing.priceDollars)}</span>
                          {listing.category && (
                            <>
                              <span>•</span>
                              <span>{listing.category}</span>
                            </>
                          )}
                          <span>•</span>
                          <span>Created: {formatDate(listing.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          
          {/* Payouts */}
          {creator.payouts && creator.payouts.length > 0 && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Payouts ({creator.payouts.length})</h2>
              <div className="space-y-3">
                {creator.payouts.map((payout) => (
                  <div key={payout.id} className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Payout ID</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{payout.id}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Status</dt>
                        <dd className="mt-1">
                          <PayoutStatusBadge status={payout.payout_status} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Gross Amount</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white font-semibold">{formatCurrency(payout.grossAmountDollars)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Platform Fee</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatCurrency(payout.platformFeeDollars)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Net Amount</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white font-semibold">{formatCurrency(payout.netAmountDollars)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Created At</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatDate(payout.created_at)}</dd>
                      </div>
                      {payout.payout_reference && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Reference</dt>
                          <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{payout.payout_reference}</dd>
                        </div>
                      )}
                      {payout.listing_id && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Listing</dt>
                          <dd className="mt-1">
                            <Link
                              to={`/admin/listings/${payout.listing_id}`}
                              className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                            >
                              View Listing
                            </Link>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/admin.creators.$id').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
