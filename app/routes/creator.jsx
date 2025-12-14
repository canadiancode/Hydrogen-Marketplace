import {Outlet, NavLink} from 'react-router';

export default function CreatorLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Outlet />
    </div>
  );
}