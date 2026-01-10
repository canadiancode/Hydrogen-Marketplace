import {useLoaderData} from 'react-router';
import CreatorDashboard from '~/components/creator/CreatorDashboard';
import {WelcomeModal} from '~/components/creator/WelcomeModal';
import {requireAuth} from '~/lib/auth-helpers';
import {fetchCreatorProfile, fetchCreatorDashboardStats, fetchCreatorRecentActivity} from '~/lib/supabase';

export const meta = () => {
  return [{title: 'WornVault | Creator Dashboard'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    return {
      user,
      stats: {
        totalListings: 0,
        activeListings: 0,
        pendingApproval: 0,
        totalEarnings: '0.00',
      },
      recentActivity: [],
    };
  }

  const supabaseUrl = context.env.SUPABASE_URL;
  const anonKey = context.env.SUPABASE_ANON_KEY;
  const accessToken = session.access_token;

  if (!supabaseUrl || !anonKey || !accessToken) {
    console.error('Loader: Missing Supabase configuration');
    return {
      user,
      stats: {
        totalListings: 0,
        activeListings: 0,
        pendingApproval: 0,
        totalEarnings: '0.00',
      },
      recentActivity: [],
    };
  }

  // Fetch creator profile to get creator_id
  const creatorProfile = await fetchCreatorProfile(user.email, supabaseUrl, anonKey, accessToken);
  
  if (!creatorProfile || !creatorProfile.id) {
    // Creator profile doesn't exist yet - return zero stats
    return {
      user,
      stats: {
        totalListings: 0,
        activeListings: 0,
        pendingApproval: 0,
        totalEarnings: '0.00',
      },
      recentActivity: [],
    };
  }

  // Fetch dashboard statistics and recent activity
  const [stats, recentActivity] = await Promise.all([
    fetchCreatorDashboardStats(creatorProfile.id, supabaseUrl, anonKey, accessToken),
    fetchCreatorRecentActivity(creatorProfile.id, supabaseUrl, anonKey, accessToken, {limit: 20}),
  ]);
  
  return {
    user,
    stats,
    recentActivity: recentActivity || [],
  };
}

export default function CreatorDashboardPage() {
  const data = useLoaderData();
  
  return (
    <>
      <WelcomeModal />
      <CreatorDashboard user={data.user} stats={data.stats} recentActivity={data.recentActivity || []} />
    </>
  );
}