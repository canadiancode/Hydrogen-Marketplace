import {useLoaderData, Link} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';
import {fetchCreatorProfile, fetchCreatorListingById, createUserSupabaseClient} from '~/lib/supabase';
import {decodeHTMLEntities} from '~/lib/html-entities';

export const meta = ({data}) => {
  return [{title: `WornVault | Sale Details - ${data?.sale?.title ?? ''}`}];
};

export async function loader({params, context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    throw new Response('Unauthorized', {status: 401});
  }

  const {id} = params;
  if (!id) {
    throw new Response('Sale ID required', {status: 400});
  }

  const supabaseUrl = context.env.SUPABASE_URL;
  const anonKey = context.env.SUPABASE_ANON_KEY;
  const accessToken = session.access_token;

  if (!supabaseUrl || !anonKey || !accessToken) {
    console.error('Loader: Missing Supabase configuration');
    throw new Response('Server configuration error', {status: 500});
  }

  // Fetch creator profile to get creator_id
  const creatorProfile = await fetchCreatorProfile(user.email, supabaseUrl, anonKey, accessToken);
  
  if (!creatorProfile || !creatorProfile.id) {
    throw new Response('Creator profile not found', {status: 404});
  }

  // Fetch listing by ID (must be sold)
  const listing = await fetchCreatorListingById(id, creatorProfile.id, supabaseUrl, anonKey, accessToken);
  
  if (!listing) {
    throw new Response('Sale not found', {status: 404});
  }

  // Verify listing is sold
  const soldStatuses = ['sold', 'shipped', 'completed'];
  if (!soldStatuses.includes(listing.status)) {
    throw new Response('This listing is not sold', {status: 400});
  }

  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

  // Get main product image
  let productImageUrl = null;
  if (listing.photos && listing.photos.length > 0) {
    const mainPhoto = listing.photos.find(p => p.photo_type === 'reference') || listing.photos[0];
    if (mainPhoto?.storage_path) {
      const {data} = supabase.storage
        .from('listing-photos')
        .getPublicUrl(mainPhoto.storage_path);
      productImageUrl = data?.publicUrl || null;
    }
  }

  // Format dates
  const publishedDate = listing.created_at ? new Date(listing.created_at) : null;
  const soldDate = listing.sold_at ? new Date(listing.sold_at) : null;

  // Format price
  const totalPrice = listing.price_cents ? (listing.price_cents / 100).toFixed(2) : '0.00';

  return {
    sale: {
      ...listing,
      productImageUrl,
      totalPrice,
      publishedDate,
      soldDate,
    },
  };
}

export default function CreatorSaleDetail() {
  const {sale} = useLoaderData();

  const formatDate = (date) => {
    if (!date) return 'N/A';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (date) => {
    if (!date) return '';
    return date.toISOString();
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Button */}
        <div className="mb-6">
          <Link
            to="/creator/sales"
            className="inline-flex items-center text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Sales
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Sale Details</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            View detailed information about your sold listing.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Product Image */}
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm border border-gray-200 dark:border-white/10 overflow-hidden">
              <div className="aspect-square bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                {sale.productImageUrl ? (
                  <img
                    src={sale.productImageUrl}
                    alt={sale.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg className="h-24 w-24 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
              </div>
            </section>

            {/* Product Information */}
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm border border-gray-200 dark:border-white/10 p-6">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Product Information</h2>
              
              <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Product Title</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white font-semibold">{sale.title || 'N/A'}</dd>
                </div>
                
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Condition</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{sale.condition || 'N/A'}</dd>
                </div>
                
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Listing Story</dt>
                  <dd className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
                    {sale.story ? decodeHTMLEntities(sale.story) : 'No description provided.'}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Logistics Section */}
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm border border-gray-200 dark:border-white/10 p-6">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Logistics</h2>
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-gray-400">Logistics information will appear here.</p>
              </div>
            </section>

            {/* Payout Section */}
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm border border-gray-200 dark:border-white/10 p-6">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Payout</h2>
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-gray-400">Payout information will appear here.</p>
              </div>
            </section>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm border border-gray-200 dark:border-white/10 p-6 sticky top-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Sale Details</h2>
              
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Date Published</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {sale.publishedDate ? (
                      <time dateTime={formatDateTime(sale.publishedDate)}>
                        {formatDate(sale.publishedDate)}
                      </time>
                    ) : (
                      'N/A'
                    )}
                  </dd>
                </div>
                
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Date of Sale</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {sale.soldDate ? (
                      <time dateTime={formatDateTime(sale.soldDate)}>
                        {formatDate(sale.soldDate)}
                      </time>
                    ) : (
                      'N/A'
                    )}
                  </dd>
                </div>
                
                <div className="pt-4 border-t border-gray-200 dark:border-white/10">
                  <dd className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Total Price</span>
                      <span className="text-gray-900 dark:text-white font-semibold">${sale.totalPrice}</span>
                    </div>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.sales.$id').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
