import {useRouteError, isRouteErrorResponse, useLocation} from 'react-router';
import {useEffect} from 'react';
import {HeroSection} from '~/components/HeroSection';
import {WhatIsWornVault} from '~/components/WhatIsWornVault';
import {HowMarketplaceWorks} from '~/components/HowMarketplaceWorks';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'WornVault | Home'}];
};

/**
 * @param {Route.LoaderArgs} args
 */
export async function loader() {
  // Homepage doesn't require any data fetching currently
  // All components are static or fetch their own data
  return {};
}

export default function Homepage() {
  const location = useLocation();

  // Handle smooth scrolling to hash anchors on mount and navigation
  useEffect(() => {
    if (location.hash) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        const element = document.querySelector(location.hash);
        if (element) {
          element.scrollIntoView({behavior: 'smooth', block: 'start'});
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [location.hash]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <HeroSection />
      <WhatIsWornVault />
      <HowMarketplaceWorks />
    </div>
  );
}

/**
 * Error boundary for homepage
 * Catches errors during rendering and provides fallback UI
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isDev = process.env.NODE_ENV === 'development';
  
  let errorMessage = 'Something went wrong';
  let errorStatus = 500;
  
  if (isRouteErrorResponse(error)) {
    errorStatus = error.status;
    errorMessage = isDev 
      ? (error?.data?.message ?? error.data ?? 'An error occurred')
      : 'We encountered an error loading the homepage. Please try refreshing the page.';
  } else if (error instanceof Error && isDev) {
    errorMessage = error.message;
  }
  
  // Log full error server-side but don't expose to client in production
  if (!isDev) {
    console.error('ErrorBoundary caught:', error);
  }
  
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
            Something went wrong
          </h1>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
            {errorMessage}
          </p>
          {isDev && error instanceof Error && error.stack && (
            <pre className="mt-8 text-xs overflow-auto text-left max-w-2xl mx-auto bg-gray-100 dark:bg-gray-800 p-4 rounded">
              {error.stack}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/_index').Route} Route */
