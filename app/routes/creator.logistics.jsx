import {useLoaderData, Link} from 'react-router';
import {requireAuth} from '~/lib/auth-helpers';
import {fetchCreatorProfile, fetchCreatorListings, createUserSupabaseClient} from '~/lib/supabase';

export const meta = () => {
  return [{title: 'WornVault | Logistics'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    return {
      user,
      logisticsEvents: [],
      listings: [],
    };
  }

  const supabaseUrl = context.env.SUPABASE_URL;
  const anonKey = context.env.SUPABASE_ANON_KEY;
  const accessToken = session.access_token;

  if (!supabaseUrl || !anonKey || !accessToken) {
    console.error('Loader: Missing Supabase configuration');
    return {
      user,
      logisticsEvents: [],
      listings: [],
    };
  }

  // Fetch creator profile to get creator_id
  const creatorProfile = await fetchCreatorProfile(user.email, supabaseUrl, anonKey, accessToken);
  
  if (!creatorProfile || !creatorProfile.id) {
    return {
      user,
      logisticsEvents: [],
      listings: [],
    };
  }

  // Fetch creator's listings
  const allListings = await fetchCreatorListings(creatorProfile.id, supabaseUrl, anonKey, accessToken);
  
  // Filter for listings that have logistics events (sold, shipped, etc.)
  const listingsWithLogistics = allListings.filter(listing => 
    listing.status === 'sold' || 
    listing.status === 'in_validation' ||
    listing.status === 'shipped' ||
    listing.status === 'completed'
  );

  // Fetch logistics events for these listings
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
  const listingIds = listingsWithLogistics.map(l => l.id);
  
  let logisticsEvents = [];
  if (listingIds.length > 0) {
    const {data: events, error: eventsError} = await supabase
      .from('logistics_events')
      .select('*')
      .in('listing_id', listingIds)
      .order('created_at', {ascending: false});
    
    if (!eventsError && events) {
      logisticsEvents = events;
    }
  }

  // Group events by listing
  const eventsByListing = {};
  logisticsEvents.forEach(event => {
    if (!eventsByListing[event.listing_id]) {
      eventsByListing[event.listing_id] = [];
    }
    eventsByListing[event.listing_id].push(event);
  });

  // Get public URLs for photos
  const listingsWithPhotoUrls = await Promise.all(
    listingsWithLogistics.map(async (listing) => {
      if (listing.photos && listing.photos.length > 0) {
        const {data} = supabase.storage
          .from('listing-photos')
          .getPublicUrl(listing.photos[0].storage_path);
        
        return {
          ...listing,
          thumbnailUrl: data?.publicUrl || null,
          events: eventsByListing[listing.id] || [],
        };
      }
      return {
        ...listing,
        events: eventsByListing[listing.id] || [],
      };
    })
  );

  return {
    user,
    listings: listingsWithPhotoUrls,
    totalEvents: logisticsEvents.length,
  };
}

export default function CreatorLogistics() {
  const {listings, totalEvents} = useLoaderData();
  
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatEventType = (eventType) => {
    return eventType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const StatusBadge = ({status}) => {
    if (status === 'sold') {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-400">
          Sold
        </span>
      );
    }
    
    if (status === 'in_validation') {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700 dark:bg-purple-400/10 dark:text-purple-400">
          In Validation
        </span>
      );
    }
    
    if (status === 'shipped') {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-400">
          Shipped
        </span>
      );
    }
    
    if (status === 'completed') {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400">
          Completed
        </span>
      );
    }
    
    return null;
  };
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Logistics</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Track the shipping and fulfillment status of your sold listings.
          </p>
        </div>
        
        {/* Stats Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-8">
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Active Shipments</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{listings.length}</p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Events</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{totalEvents}</p>
          </div>
        </div>
        
        {/* Logistics Listings */}
        {listings.length === 0 ? (
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <div className="text-center py-12">
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
                No active logistics tracking.
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Logistics events will appear here once your listings are sold and enter the fulfillment process.
              </p>
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            {listings.map((listing) => (
              <section key={listing.id} className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
                <div className="flex items-start gap-x-4 mb-4">
                  {/* Thumbnail */}
                  <div className="flex-shrink-0">
                    <div className="h-20 w-20 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-white/10 flex items-center justify-center">
                      {listing.thumbnailUrl ? (
                        <img
                          src={listing.thumbnailUrl}
                          alt={listing.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <svg className="h-10 w-10 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      )}
                    </div>
                  </div>
                  
                  {/* Listing Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-x-3 mb-2">
                      <Link
                        to={`/creator/listings/${listing.id}`}
                        className="text-lg font-semibold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        {listing.title}
                      </Link>
                      <StatusBadge status={listing.status} />
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {listing.category && `${listing.category} • `}${formatDate(listing.created_at)}
                    </p>
                  </div>
                </div>
                
                {/* Logistics Events Timeline */}
                {listing.events && listing.events.length > 0 ? (
                  <div className="mt-4 border-t border-gray-200 dark:border-white/10 pt-4">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Logistics Timeline</h3>
                    <div className="space-y-3">
                      {listing.events
                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                        .map((event, index) => (
                          <div key={event.id} className="flex items-start gap-x-3">
                            <div className="flex-shrink-0">
                              <div className={`h-2 w-2 rounded-full mt-2 ${
                                index === 0 
                                  ? 'bg-indigo-600 dark:bg-indigo-400' 
                                  : 'bg-gray-300 dark:bg-gray-600'
                              }`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                {formatEventType(event.event_type)}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {formatDate(event.created_at)}
                              </p>
                              {event.metadata && (
                                <pre className="text-xs text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800/50 p-2 rounded">
                                  {JSON.stringify(event.metadata, null, 2)}
                                </pre>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 border-t border-gray-200 dark:border-white/10 pt-4">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No logistics events yet. Events will appear here as your item moves through the fulfillment process.
                    </p>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.logistics').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
