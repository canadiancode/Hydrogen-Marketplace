import {Form, useLoaderData, redirect, Link} from 'react-router';
import {checkAdminAuth, fetchAdminListingById} from '~/lib/supabase';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {generateCSRFToken, getClientIP} from '~/lib/auth-helpers';
import {PhotoIcon} from '@heroicons/react/24/outline';

export const meta = ({data}) => {
  return [{title: `WornVault | Review Listing ${data?.listing?.title ?? data?.listing?.id ?? ''}`}];
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
    throw new Response('Invalid listing ID', {status: 400});
  }
  
  // Generate CSRF token for form protection
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase configuration for admin listing detail');
    return {
      listing: null,
      error: 'Server configuration error. Please ensure SUPABASE_SERVICE_ROLE_KEY is set.',
      csrfToken,
    };
  }
  
  // Fetch listing data from Supabase
  const listing = await fetchAdminListingById(id, supabaseUrl, serviceRoleKey);
  
  if (!listing) {
    throw new Response('Listing not found', {status: 404});
  }
  
  return {
    listing,
    csrfToken,
  };
}

export async function action({request, params, context}) {
  // Require admin authentication
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    return new Response('Unauthorized', {status: 403});
  }
  
  // Rate limiting: max 20 admin actions per minute
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(
    request,
    `admin-action:${user.email}:${clientIP}`,
    {
      maxRequests: 20,
      windowMs: 60000, // 1 minute
    },
  );
  
  if (!rateLimit.allowed) {
    return new Response('Rate limit exceeded. Please wait a moment before trying again.', {
      status: 429,
      headers: {
        'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
      },
    });
  }
  
  // CSRF protection with constant-time validation to prevent timing attacks
  const formData = await request.formData();
  const csrfToken = formData.get('csrf_token');
  const storedToken = context.session.get('csrf_token');
  
  if (!csrfToken || !storedToken) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  // Constant-time comparison to prevent timing attacks
  const {constantTimeEquals} = await import('~/lib/auth-helpers');
  if (!constantTimeEquals(csrfToken.toString(), storedToken)) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  // Clear CSRF token after use (one-time use)
  context.session.unset('csrf_token');
  
  // Validate and sanitize action parameter
  const actionValue = formData.get('action');
  const validActions = ['approve', 'reject'];
  const sanitizedAction = String(actionValue || '').trim().toLowerCase();
  
  if (!validActions.includes(sanitizedAction)) {
    return new Response('Invalid action. Must be "approve" or "reject".', {status: 400});
  }
  
  // Validate listing ID parameter - prevent injection
  const {id} = params;
  if (!id || typeof id !== 'string') {
    return new Response('Invalid listing ID', {status: 400});
  }
  
  // Validate UUID format (36 chars with hyphens or 32 without)
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const sanitizedId = id.trim();
  
  if (sanitizedId.length < 32 || sanitizedId.length > 36 || !UUID_REGEX.test(sanitizedId)) {
    return new Response('Invalid listing ID format', {status: 400});
  }
  
  // Update listing status in Supabase
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Server configuration error', {status: 500});
  }
  
  try {
    const {createServerSupabaseClient} = await import('~/lib/supabase');
    const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
    
    // Determine new status based on action
    const newStatus = sanitizedAction === 'approve' ? 'live' : 'rejected';
    
    // Update listing status
    const {error: updateError} = await supabase
      .from('listings')
      .update({status: newStatus})
      .eq('id', sanitizedId);
    
    if (updateError) {
      console.error('Error updating listing status:', updateError);
      return new Response(`Failed to update listing: ${updateError.message}`, {status: 500});
    }
    
    return redirect(`/admin/listings/${sanitizedId}?updated=true`);
  } catch (error) {
    console.error('Error in action:', error);
    return new Response('An unexpected error occurred', {status: 500});
  }
}

export default function AdminListingReview() {
  const {listing, csrfToken, error} = useLoaderData();
  
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
  
  if (!listing) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg p-6">
            <p className="text-gray-700 dark:text-gray-300">Listing not found.</p>
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
  
  const formatCurrency = (cents) => {
    return `$${(cents / 100).toFixed(2)}`;
  };
  
  const StatusBadge = ({status}) => {
    const statusConfig = {
      draft: {bg: 'bg-gray-50', text: 'text-gray-700', label: 'Draft'},
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
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">{listing.title}</h1>
              <StatusBadge status={listing.status} />
            </div>
            <Link
              to="/admin/listings"
              className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
            >
              ← Back to Listings
            </Link>
          </div>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Review listing details, photos, creator information, logistics events, and payouts.
          </p>
        </div>
        
        <div className="space-y-6">
          {/* Listing Details */}
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Listing Details</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Listing ID</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{listing.id}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</dt>
                <dd className="mt-1">
                  <StatusBadge status={listing.status} />
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Title</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{listing.title}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Category</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{listing.category || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Condition</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{listing.condition || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Price</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white font-semibold">
                  {formatCurrency(listing.price_cents)} {listing.currency || 'USD'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created At</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatDate(listing.created_at)}</dd>
              </div>
              {listing.shopify_product_id && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Shopify Product ID</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{listing.shopify_product_id}</dd>
                </div>
              )}
              {listing.shopify_order_id && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Shopify Order ID</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{listing.shopify_order_id}</dd>
                </div>
              )}
              {listing.story && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Story</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{listing.story}</dd>
                </div>
              )}
            </dl>
          </section>
          
          {/* Creator Information */}
          {listing.creator && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Creator Information</h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Creator ID</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{listing.creator.id}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Display Name</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{listing.creator.display_name}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Email</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{listing.creator.email}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Handle</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">@{listing.creator.handle}</dd>
                </div>
                {listing.creator.first_name && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">First Name</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">{listing.creator.first_name}</dd>
                  </div>
                )}
                {listing.creator.last_name && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Last Name</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">{listing.creator.last_name}</dd>
                  </div>
                )}
                {listing.creator.bio && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Bio</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">{listing.creator.bio}</dd>
                  </div>
                )}
                {listing.creator.primary_platform && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Primary Platform</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">{listing.creator.primary_platform}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Verification Status</dt>
                  <dd className="mt-1">
                    <StatusBadge status={listing.creator.verification_status || 'pending'} />
                  </dd>
                </div>
              </dl>
            </section>
          )}
          
          {/* Photos */}
          {listing.photos && listing.photos.length > 0 && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Photos</h2>
              
              {listing.photosByType.reference && listing.photosByType.reference.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Reference Photos ({listing.photosByType.reference.length})</h3>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {listing.photosByType.reference.map((photo) => (
                      <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-white/10">
                        {photo.publicUrl ? (
                          <img
                            src={photo.publicUrl}
                            alt={`Reference photo ${photo.id}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <PhotoIcon className="h-12 w-12 text-gray-400 dark:text-gray-500" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {listing.photosByType.intake && listing.photosByType.intake.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Intake Photos ({listing.photosByType.intake.length})</h3>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {listing.photosByType.intake.map((photo) => (
                      <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-white/10">
                        {photo.publicUrl ? (
                          <img
                            src={photo.publicUrl}
                            alt={`Intake photo ${photo.id}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <PhotoIcon className="h-12 w-12 text-gray-400 dark:text-gray-500" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {listing.photosByType.internal && listing.photosByType.internal.length > 0 && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Internal Photos ({listing.photosByType.internal.length})</h3>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {listing.photosByType.internal.map((photo) => (
                      <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-white/10">
                        {photo.publicUrl ? (
                          <img
                            src={photo.publicUrl}
                            alt={`Internal photo ${photo.id}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <PhotoIcon className="h-12 w-12 text-gray-400 dark:text-gray-500" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
          
          {/* Logistics Events */}
          {listing.logisticsEvents && listing.logisticsEvents.length > 0 && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Logistics Events ({listing.logisticsEvents.length})</h2>
              <div className="space-y-3">
                {listing.logisticsEvents.map((event) => (
                  <div key={event.id} className="flex items-start justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white capitalize">{event.event_type.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatDate(event.created_at)}</p>
                      {event.metadata && (
                        <pre className="text-xs text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-wrap">
                          {JSON.stringify(event.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          
          {/* Payouts */}
          {listing.payouts && listing.payouts.length > 0 && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Payouts ({listing.payouts.length})</h2>
              <div className="space-y-3">
                {listing.payouts.map((payout) => (
                  <div key={payout.id} className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Payout ID</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{payout.id}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Status</dt>
                        <dd className="mt-1">
                          <StatusBadge status={payout.payout_status} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Gross Amount</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white font-semibold">{formatCurrency(payout.gross_amount_cents)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Platform Fee</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatCurrency(payout.platform_fee_cents)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Net Amount</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white font-semibold">{formatCurrency(payout.net_amount_cents)}</dd>
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

/** @typedef {import('./+types/admin.listings.$id').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

