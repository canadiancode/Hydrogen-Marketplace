import {CreatorNavigation} from './CreatorNavigation';

/**
 * Creator Layout Component
 * Wraps creator pages with navigation and proper layout structure
 */
export function CreatorLayout({children, isAdmin = false}) {
  return (
    <div className="bg-white dark:bg-gray-900 min-h-screen">
      <CreatorNavigation isAdmin={isAdmin} />
      <div className="xl:pl-72 bg-white dark:bg-gray-900">
        {children}
      </div>
    </div>
  );
}
