import {useLoaderData, Link} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';
import {fetchCreatorProfile, fetchCreatorListings, createUserSupabaseClient} from '~/lib/supabase';

export const meta = () => {
  return [{title: 'WornVault | Payouts'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    return {
      user,
      payouts: [],
      totalPayouts: 0,
      totalAmount: 0,
    };
  }

  const supabaseUrl = context.env.SUPABASE_URL;
  const anonKey = context.env.SUPABASE_ANON_KEY;
  const accessToken = session.access_token;

  if (!supabaseUrl || !anonKey || !accessToken) {
    console.error('Loader: Missing Supabase configuration');
    return {
      user,
      payouts: [],
      totalPayouts: 0,
      totalAmount: 0,
    };
  }

  // Fetch creator profile to get creator_id
  const creatorProfile = await fetchCreatorProfile(user.email, supabaseUrl, anonKey, accessToken, request.fetch || fetch);
  
  if (!creatorProfile || !creatorProfile.id) {
    return {
      user,
      payouts: [],
      totalPayouts: 0,
      totalAmount: 0,
    };
  }

  // Fetch creator's listings
  const allListings = await fetchCreatorListings(creatorProfile.id, supabaseUrl, anonKey, accessToken, request.fetch || fetch);
  
  // Filter for completed listings (these would have payouts)
  const completedListings = allListings.filter(listing => 
    listing.status === 'completed'
  );

  // Get public URLs for photos
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
  const payoutsWithPhotoUrls = await Promise.all(
    completedListings.map(async (listing) => {
      if (listing.photos && listing.photos.length > 0) {
        const {data} = supabase.storage
          .from('listing-photos')
          .getPublicUrl(listing.photos[0].storage_path);
        
        return {
          ...listing,
          thumbnailUrl: data?.publicUrl || null,
        };
      }
      return listing;
    })
  );

  // Calculate totals
  const totalPayouts = payoutsWithPhotoUrls.length;
  const totalAmount = payoutsWithPhotoUrls.reduce((sum, listing) => {
    return sum + (parseFloat(listing.price) || 0);
  }, 0);

  return {
    user,
    payouts: payoutsWithPhotoUrls,
    totalPayouts,
    totalAmount,
  };
}

export default function CreatorPayouts() {
  const {payouts, totalPayouts, totalAmount} = useLoaderData();
  
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toISOString();
  };

  const StatusBadge = ({status}) => {
    if (status === 'completed') {
      return (
        <p className="!p-1 mt-0.5 rounded-md bg-green-50 px-4 py-2 !text-[11px] font-medium text-green-700 inset-ring inset-ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:inset-ring-green-500/20">
          Completed
        </p>
      );
    }
    
    return null;
  };
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Payouts</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            View your completed sales and payout information.
          </p>
        </div>
        
        {/* Stats Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-8">
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Payouts</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{totalPayouts}</p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Amount</p>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-2">
              ${totalAmount.toFixed(2)}
            </p>
          </div>
        </div>
        
        {/* Payouts List */}
        {payouts.length === 0 ? (
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <div className="text-center py-12">
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
                No payouts yet.
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Payouts will appear here once your completed listings are processed.
              </p>
            </div>
          </section>
        ) : (
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm border border-gray-200 dark:border-white/10">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                Completed Sales ({payouts.length})
              </h2>
            </div>
            <ul role="list" className="divide-y divide-gray-200 dark:divide-white/10">
              {payouts.map((payout) => (
                <li key={payout.id} className="flex items-center justify-between gap-x-6 py-5 px-6 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-x-4 flex-1 min-w-0">
                    {/* Thumbnail */}
                    <div className="flex-shrink-0">
                      <div className="h-16 w-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-white/10 flex items-center justify-center">
                        {payout.thumbnailUrl ? (
                          <img
                            src={payout.thumbnailUrl}
                            alt={payout.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <svg className="h-8 w-8 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                    </div>
                    
                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-x-3">
                        <Link
                          to={`/creator/listings/${payout.id}`}
                          className="text-sm/6 font-semibold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {payout.title}
                        </Link>
                        <StatusBadge status={payout.status} />
                      </div>
                      <div className="mt-1 flex items-center gap-x-2 text-xs/5 text-gray-500 dark:text-gray-400">
                        <p className="whitespace-nowrap">
                          Completed on <time dateTime={formatDateTime(payout.created_at)}>{formatDate(payout.created_at)}</time>
                        </p>
                        {payout.category && (
                          <>
                            <svg viewBox="0 0 2 2" className="size-0.5 fill-current">
                              <circle r={1} cx={1} cy={1} />
                            </svg>
                            <p className="truncate">{payout.category}</p>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/* Amount */}
                    <div className="flex-shrink-0">
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">
                        ${payout.price}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.payouts').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
