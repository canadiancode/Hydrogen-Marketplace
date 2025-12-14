import {useLoaderData} from 'react-router';
import CreatorDashboard from '~/components/creator/CreatorDashboard';
import {requireAuth} from '~/lib/auth-helpers';

export const meta = () => {
  return [{title: 'WornVault | Creator Dashboard'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  // Fetch creator dashboard data from Supabase
  // const dashboardData = await fetchCreatorDashboard(context);
  
  return {
    user,
    // dashboardData
  };
}

export default function CreatorDashboardPage() {
  const data = useLoaderData();
  
  return <CreatorDashboard user={data.user} />;
}