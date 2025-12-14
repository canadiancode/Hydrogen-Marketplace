import {Outlet, NavLink, redirect} from 'react-router';
import {checkAdminAuth} from '~/lib/supabase';

/**
 * Route handle to mark admin routes that should hide header/footer
 * This can be accessed via useMatches() in parent layouts
 */
export const handle = {
  hideHeaderFooter: true,
};

export async function loader({request, context}) {
  // Require admin authentication
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    // Redirect to login if not authenticated or not admin
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  return {user};
}

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <NavLink
              to="/admin"
              end
              className={({isActive}) =>
                `border-b-2 py-4 px-1 text-sm font-medium ${
                  isActive
                    ? 'border-indigo-500 dark:border-indigo-400 text-indigo-600 dark:text-white'
                    : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white hover:border-gray-300 dark:hover:border-white/20'
                }`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/admin/listings"
              className={({isActive}) =>
                `border-b-2 py-4 px-1 text-sm font-medium ${
                  isActive
                    ? 'border-indigo-500 dark:border-indigo-400 text-indigo-600 dark:text-white'
                    : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white hover:border-gray-300 dark:hover:border-white/20'
                }`
              }
            >
              Listings
            </NavLink>
            <NavLink
              to="/admin/logistics"
              className={({isActive}) =>
                `border-b-2 py-4 px-1 text-sm font-medium ${
                  isActive
                    ? 'border-indigo-500 dark:border-indigo-400 text-indigo-600 dark:text-white'
                    : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white hover:border-gray-300 dark:hover:border-white/20'
                }`
              }
            >
              Logistics
            </NavLink>
          </div>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}