import {Link, useLocation, useMatches} from 'react-router';
import {ChevronRightIcon, HomeIcon} from '@heroicons/react/20/solid';
import {useMemo} from 'react';

/**
 * Generates breadcrumb items based on the current route
 * @param {string} pathname - Current pathname
 * @param {Object} data - Optional route data (e.g., product, creator)
 * @returns {Array<{name: string, href: string, current: boolean}>}
 */
function generateBreadcrumbs(pathname, data = {}) {
  const segments = pathname.split('/').filter(Boolean);
  const breadcrumbs = [
    {name: 'Home', href: '/', current: false},
  ];

  // Skip breadcrumbs for dashboard/admin routes
  if (segments[0] === 'creator' || segments[0] === 'admin') {
    return [];
  }

  let currentPath = '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    currentPath += `/${segment}`;

    // Skip dynamic segments (they'll be handled with data)
    if (segment.startsWith('$') || segment.includes('[')) {
      continue;
    }

    let name = segment;

    // Customize names based on route
    if (segment === 'shop') {
      name = 'Shop';
      breadcrumbs.push({
        name,
        href: currentPath,
        current: isLast,
      });
    } else if (segment === 'products') {
      name = 'Products';
      breadcrumbs.push({
        name,
        href: currentPath,
        current: false,
      });
      // If we have product data, add product name as next breadcrumb
      if (data.product) {
        breadcrumbs.push({
          name: data.product.title || 'Product',
          href: currentPath,
          current: true,
        });
        break;
      }
    } else if (segment === 'creators') {
      name = 'Creators';
      breadcrumbs.push({
        name,
        href: currentPath,
        current: false,
      });
      // If we have creator data and this is the last segment, add creator name
      if (data.creator && isLast) {
        const creatorName = data.creator.display_name || data.creator.handle || 'Creator';
        breadcrumbs.push({
          name: creatorName,
          href: currentPath,
          current: true,
        });
        break;
      }
    } else if (segment === 'listings') {
      // For listing pages, show Shop as the parent breadcrumb
      name = 'Shop';
      breadcrumbs.push({
        name,
        href: '/shop',
        current: false,
      });
      // If we have listing data and this is the last segment, add listing title as product name
      if (data.listing && isLast) {
        breadcrumbs.push({
          name: data.listing.title || 'Product',
          href: currentPath,
          current: true,
        });
        break;
      }
    } else {
      // Capitalize first letter and replace hyphens with spaces
      name = segment
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      breadcrumbs.push({
        name,
        href: currentPath,
        current: isLast,
      });
    }
  }

  return breadcrumbs;
}

/**
 * Breadcrumbs component for navigation
 * Automatically generates breadcrumbs based on current route
 * @param {Object} props
 * @param {Array<{name: string, href: string, current: boolean}>} [props.items] - Optional custom breadcrumb items
 * @param {Object} [props.data] - Optional route data (product, creator, etc.) for dynamic breadcrumbs
 */
export function Breadcrumbs({items, data}) {
  const location = useLocation();
  const matches = useMatches();

  // Check if we're on a dashboard/admin route - don't show breadcrumbs
  const shouldHide = useMemo(() => {
    const pathname = location.pathname;
    return pathname.startsWith('/creator/') || pathname.startsWith('/admin/');
  }, [location.pathname]);

  // Generate breadcrumbs from route or use provided items
  const breadcrumbs = useMemo(() => {
    if (shouldHide) {
      return [];
    }

    if (items && items.length > 0) {
      return items;
    }

    // Extract data from route matches
    const routeData = data || {};
    if (!routeData.product && !routeData.creator && !routeData.listing) {
      // Try to get data from route matches
      for (const match of matches) {
        if (match.data) {
          if (match.data.product) {
            routeData.product = match.data.product;
          }
          if (match.data.creator) {
            routeData.creator = match.data.creator;
          }
          if (match.data.listing) {
            routeData.listing = match.data.listing;
          }
        }
      }
    }

    return generateBreadcrumbs(location.pathname, routeData);
  }, [location.pathname, items, data, matches, shouldHide]);

  // Don't render if no breadcrumbs or on dashboard routes
  if (shouldHide || breadcrumbs.length === 0) {
    return null;
  }

  // Don't show breadcrumbs if we're just on the home page
  if (breadcrumbs.length === 1 && breadcrumbs[0].href === '/') {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="flex">
      <ol role="list" className="flex items-center space-x-4">
        <li>
          <div>
            <Link
              to="/"
              className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <HomeIcon aria-hidden="true" className="size-5 shrink-0" />
              <span className="sr-only">Home</span>
            </Link>
          </div>
        </li>
        {breadcrumbs.slice(1).map((page) => (
          <li key={page.name}>
            <div className="flex items-center">
              <ChevronRightIcon
                aria-hidden="true"
                className="size-5 shrink-0 text-gray-400 dark:text-gray-500"
              />
              {page.current ? (
                <span
                  aria-current="page"
                  className="ml-4 text-sm font-medium text-gray-500 dark:text-gray-400"
                >
                  {page.name}
                </span>
              ) : (
                <Link
                  to={page.href}
                  className="ml-4 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {page.name}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </nav>
  );
}

