import {Outlet, useLocation, useLoaderData} from 'react-router';
import {CreatorLayout} from '~/components/creator/CreatorLayout';
import {checkAdminAuth} from '~/lib/supabase';

/**
 * Route handle to mark creator routes that should hide header/footer
 * This can be accessed via useMatches() in parent layouts
 */
export const handle = {
  hideHeaderFooter: true,
};

export async function loader({request, context}) {
  // Check admin status for navigation
  try {
    const {isAdmin} = await checkAdminAuth(request, context.env);
    return {
      isAdmin: isAdmin || false,
    };
  } catch (error) {
    console.error('[Creator Route] Admin check error:', error);
    return {
      isAdmin: false,
    };
  }
}

export default function CreatorRoute() {
  const location = useLocation();
  const {isAdmin} = useLoaderData();
  const isLoginPage = location.pathname === '/creator/login';
  
  // Login page should not have CreatorLayout (no navigation)
  if (isLoginPage) {
    return <Outlet />;
  }
  
  // All other creator routes get the full layout with navigation
  return (
    <CreatorLayout isAdmin={isAdmin}>
      <Outlet />
    </CreatorLayout>
  );
}