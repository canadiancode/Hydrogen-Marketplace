import {Outlet, useLocation} from 'react-router';
import {CreatorLayout} from '~/components/creator/CreatorLayout';

/**
 * Route handle to mark creator routes that should hide header/footer
 * This can be accessed via useMatches() in parent layouts
 */
export const handle = {
  hideHeaderFooter: true,
};

export default function CreatorRoute() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/creator/login';
  
  // Login page should not have CreatorLayout (no navigation)
  if (isLoginPage) {
    return <Outlet />;
  }
  
  // All other creator routes get the full layout with navigation
  return (
    <CreatorLayout>
      <Outlet />
    </CreatorLayout>
  );
}