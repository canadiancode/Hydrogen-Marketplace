import {CreatorNavigation} from './CreatorNavigation';

/**
 * Creator Layout Component
 * Wraps creator pages with navigation and proper layout structure
 */
export function CreatorLayout({children}) {
  return (
    <div className="bg-white dark:bg-gray-900 min-h-screen">
      <CreatorNavigation />
      <div className="xl:pl-72 bg-white dark:bg-gray-900">
        {children}
      </div>
    </div>
  );
}
