import {Outlet, NavLink} from 'react-router';

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <NavLink
              to="/admin"
              className={({isActive}) =>
                `border-b-2 py-4 px-1 text-sm font-medium ${
                  isActive
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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