import {Outlet, NavLink} from 'react-router';

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <NavLink
              to="/admin"
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