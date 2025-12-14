import {useLoaderData} from 'react-router';
import CreatorDashboard from '~/components/creator/CreatorDashboard';

export const meta = () => {
  return [{title: 'WornVault | Creator Dashboard'}];
};

export async function loader({context}) {
  // Fetch creator dashboard data from Supabase
  // const dashboardData = await fetchCreatorDashboard(context);
  
  return {
    // dashboardData
  };
}

export default function CreatorDashboardPage() {
  const data = useLoaderData();
  
  return <CreatorDashboard />;
}