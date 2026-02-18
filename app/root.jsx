import {Analytics, getShopAnalytics, useNonce} from '@shopify/hydrogen';
import {
  Link,
  Outlet,
  useRouteError,
  isRouteErrorResponse,
  Links,
  Meta,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
  useRevalidator,
} from 'react-router';
import {useEffect} from 'react';
import favicon from '~/assets/wornvault-favicon.svg';
import {FOOTER_QUERY, HEADER_QUERY} from '~/lib/fragments';
import resetStyles from '~/styles/reset.css?url';
import appStyles from '~/styles/app.css?url';
import tailwindCss from './styles/tailwind.css?url';
import {PageLayout} from './components/PageLayout';
import {checkAdminAuth, checkCreatorAuth} from '~/lib/supabase';

/**
 * Detects if the user is returning from Shopify checkout
 * @param {URL} url - Current or next URL
 * @param {Request | undefined} request - Optional request object (may not be available)
 * @returns {boolean}
 */
function isReturningFromCheckout(url, request) {
  // Check for return_from_checkout query parameter (can be set by checkout redirect)
  const returnFromCheckout = url.searchParams.has('return_from_checkout');
  
  // Check referrer header for Shopify checkout domains (if request is available)
  if (request) {
    try {
      const referer = request.headers.get('referer') || request.headers.get('referrer') || '';
      const checkoutDomains = [
        'checkout.shopify.com',
        'checkout.shopifycs.com',
        'checkout.shopifycdn.com',
      ];
      
      const isCheckoutReferer = checkoutDomains.some(domain => 
        referer.includes(domain)
      );
      
      if (isCheckoutReferer) {
        return true;
      }
    } catch (e) {
      // Request headers might not be accessible, continue with other checks
    }
  }
  
  return returnFromCheckout;
}

/**
 * Minimal header shape used when root loader data is unavailable (e.g. during
 * client-side navigation before cached data is ready). Prevents layout switch
 * from "Outlet only" to "full shell" which causes insertBefore DOM errors.
 * PageLayout/MobileMenuAside guard with header?.menu && header?.shop?.primaryDomain?.url.
 */
const EMPTY_HEADER = Object.freeze({
  menu: null,
  shop: Object.freeze({ primaryDomain: Object.freeze({ url: '' }) }),
});

/**
 * Placeholder data used when useRouteLoaderData('root') is undefined.
 * Keeps the DOM structure stable (Analytics.Provider + PageLayout + Outlet)
 * so React never swaps between different top-level trees during client navigation.
 */
const ROOT_PLACEHOLDER_DATA = Object.freeze({
  header: EMPTY_HEADER,
  cart: Promise.resolve(null),
  footer: Promise.resolve(null),
  isLoggedIn: Promise.resolve(false),
  isAdmin: Promise.resolve(false),
  isCreator: Promise.resolve(false),
  publicStoreDomain: '',
  shop: null,
  consent: Object.freeze({
    checkoutDomain: '',
    storefrontAccessToken: '',
    withPrivacyBanner: false,
  }),
});

/**
 * This is important to avoid re-fetching root queries on sub-navigations
 * @type {ShouldRevalidateFunction}
 */
export const shouldRevalidate = ({formMethod, currentUrl, nextUrl, request}) => {
  // revalidate when a mutation is performed e.g add to cart, login...
  if (formMethod && formMethod !== 'GET') return true;

  // revalidate when manually revalidating via useRevalidator
  if (currentUrl.toString() === nextUrl.toString()) return true;

  // CRITICAL: Always revalidate cart when returning from checkout
  // This ensures cart state is fresh after checkout navigation
  // Users may abandon checkout and return, and we need to preserve their cart
  // Check both currentUrl and nextUrl to catch navigation from checkout
  if (isReturningFromCheckout(nextUrl, request) || isReturningFromCheckout(currentUrl, request)) {
    return true;
  }

  // Defaulting to no revalidation for root loader data to improve performance.
  // When using this feature, you risk your UI getting out of sync with your server.
  // Use with caution. If you are uncomfortable with this optimization, update the
  // line below to `return defaultShouldRevalidate` instead.
  // For more details see: https://remix.run/docs/en/main/route/should-revalidate
  return false;
};

/**
 * Stable stylesheet paths used for both SSR and client to avoid hydration mismatch.
 * Vite SSR resolves ?url imports to /app/... paths; we use the same literals
 * so server and client render identical <link> hrefs.
 */
const STYLESHEET_HREFS = {
  tailwind: '/app/styles/tailwind.css',
  reset: '/app/styles/reset.css',
  app: '/app/styles/app.css',
};

/**
 * The main and reset stylesheets are added via links() to prevent a bug in
 * development HMR updates and to avoid hydration mismatch (same hrefs both sides).
 * https://github.com/remix-run/remix/issues/9242
 */
export function links() {
  return [
    { rel: 'stylesheet', href: STYLESHEET_HREFS.tailwind },
    { rel: 'stylesheet', href: STYLESHEET_HREFS.reset },
    { rel: 'stylesheet', href: STYLESHEET_HREFS.app },
    {
      rel: 'preconnect',
      href: 'https://cdn.shopify.com',
    },
    {
      rel: 'preconnect',
      href: 'https://shop.app',
    },
    {rel: 'icon', type: 'image/svg+xml', href: favicon},
  ];
}

/**
 * Root loader: must return enough data to render the shell (header, cart, footer,
 * auth flags, etc.). When data is briefly unavailable during client navigation,
 * the App component uses ROOT_PLACEHOLDER_DATA so the shell stays stable.
 * @param {Route.LoaderArgs} args
 */
export async function loader(args) {
  // Start fetching non-critical data without blocking time to first byte
  const deferredData = loadDeferredData(args);

  // Await the critical data required to render initial state of the page
  const criticalData = await loadCriticalData(args);

  const {storefront, env} = args.context;

  return {
    ...deferredData,
    ...criticalData,
    publicStoreDomain: env.PUBLIC_STORE_DOMAIN,
    shop: getShopAnalytics({
      storefront,
      publicStorefrontId: env.PUBLIC_STOREFRONT_ID,
    }),
    consent: {
      checkoutDomain: env.PUBLIC_CHECKOUT_DOMAIN,
      storefrontAccessToken: env.PUBLIC_STOREFRONT_API_TOKEN,
      withPrivacyBanner: false,
      // localize the privacy banner
      country: args.context.storefront.i18n.country,
      language: args.context.storefront.i18n.language,
    },
  };
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 * @param {Route.LoaderArgs}
 */
async function loadCriticalData({context}) {
  const {storefront} = context;

  const [header] = await Promise.all([
    storefront.query(HEADER_QUERY, {
      cache: storefront.CacheLong(),
      variables: {
        headerMenuHandle: 'main-menu', // Adjust to your header menu handle
      },
    }),
    // Add other queries here, so that they are loaded in parallel
  ]);

  return {header};
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 * @param {Route.LoaderArgs}
 */
function loadDeferredData({context, request}) {
  const {storefront, customerAccount, cart} = context;

  // defer the footer query (below the fold)
  const footer = storefront
    .query(FOOTER_QUERY, {
      cache: storefront.CacheLong(),
      variables: {
        footerMenuHandle: 'footer', // Adjust to your footer menu handle
      },
    })
    .catch((error) => {
      // Log query errors, but don't throw them so the page can still render
      console.error(error);
      return null;
    });
  
  // Check admin status (non-blocking, deferred)
  // This won't block page load if admin check fails
  const isAdmin = checkAdminAuth(request, context.env)
    .then(({isAdmin}) => isAdmin)
    .catch(() => false);
  
  // Check creator status (non-blocking, deferred)
  const isCreator = checkCreatorAuth(request, context.env)
    .then(({isAuthenticated}) => isAuthenticated)
    .catch(() => false);
  
  return {
    cart: cart.get(),
    isLoggedIn: customerAccount.isLoggedIn(),
    isAdmin,
    isCreator,
    footer,
  };
}

/**
 * @param {{children?: React.ReactNode}}
 */
export function Layout({children}) {
  const nonce = useNonce();

  return (
    <html lang="en" className="bg-gray-50 dark:bg-gray-900" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-gray-50 dark:bg-gray-900 min-h-screen">
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

/**
 * Client-side component to detect returns from checkout and trigger cart revalidation
 * This is a fallback for cases where server-side detection might not work
 */
function CheckoutReturnHandler() {
  const revalidator = useRevalidator();

  useEffect(() => {
    // Check if we're returning from Shopify checkout
    const referrer = document.referrer || '';
    const checkoutDomains = [
      'checkout.shopify.com',
      'checkout.shopifycs.com',
      'checkout.shopifycdn.com',
    ];
    
    const isFromCheckout = checkoutDomains.some(domain => referrer.includes(domain));
    
    // Also check URL params
    const urlParams = new URLSearchParams(window.location.search);
    const returnFromCheckout = urlParams.has('return_from_checkout');
    
    if (isFromCheckout || returnFromCheckout) {
      // Trigger revalidation to ensure cart data is fresh
      // Use a small delay to ensure the page has fully loaded
      const timeoutId = setTimeout(() => {
        revalidator.revalidate();
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [revalidator]);

  return null;
}

/**
 * ROOT LAYOUT CONTRACT: The root layout must never switch between two different
 * top-level structures (e.g. Outlet-only vs full PageLayout tree). Always
 * render the same shell (Analytics.Provider + PageLayout + Outlet) so React's
 * DOM reconciliation never hits a stale/moved node (insertBefore error).
 * When root loader data is unavailable (e.g. during client-side navigation),
 * use ROOT_PLACEHOLDER_DATA to keep the shell stable. The root loader should
 * return enough to render the shell; if not, placeholders are used briefly.
 */
export default function App() {
  /** @type {RootLoader} */
  const data = useRouteLoaderData('root');
  const resolved = data ?? ROOT_PLACEHOLDER_DATA;

  return (
    <Analytics.Provider
      cart={resolved.cart}
      shop={resolved.shop}
      consent={resolved.consent}
      disableThrowOnError={!data}
    >
      <CheckoutReturnHandler />
      <PageLayout {...resolved} isCreator={resolved.isCreator}>
        <Outlet />
      </PageLayout>
    </Analytics.Provider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isDev = process.env.NODE_ENV === 'development';

  let errorMessage = 'An unexpected error occurred';
  let errorStatus = 500;

  if (isRouteErrorResponse(error)) {
    errorStatus = error.status;
    // Only show detailed errors in development
    if (isDev) {
      errorMessage = error?.data?.message ?? error.data ?? 'An error occurred';
    } else {
      // User-friendly messages for production
      if (error.status === 404) {
        errorMessage = 'Page not found';
      } else if (error.status === 401) {
        errorMessage = 'Unauthorized';
      } else if (error.status === 403) {
        errorMessage = 'Forbidden';
      } else {
        errorMessage = 'An error occurred. Please try again later.';
      }
    }
  } else if (error instanceof Error && isDev) {
    errorMessage = error.message;
  }

  // Detect recoverable DOM/navigation errors (e.g. insertBefore) where refresh helps
  const rawMessage =
    (error instanceof Error && error.message) ||
    (isRouteErrorResponse(error) && error?.data?.message) ||
    '';
  const isRecoverableDomError =
    typeof rawMessage === 'string' && rawMessage.includes('insertBefore');
  if (isRecoverableDomError && !isDev) {
    errorMessage =
      'Something went wrong while loading this page. Refreshing the page or returning home usually fixes it.';
  }

  // Log full error server-side but don't expose to client in production
  if (!isDev) {
    console.error('ErrorBoundary caught:', error);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          Oops
        </h1>
        <p className="mt-2 text-lg font-medium text-gray-600 dark:text-gray-400">
          {errorStatus}
        </p>
        <p className="mt-4 text-base text-gray-600 dark:text-gray-400">
          {errorMessage}
        </p>
        {isDev && errorMessage && (
          <fieldset className="mt-6 text-left">
            <pre className="p-4 overflow-auto text-xs bg-gray-100 dark:bg-gray-800 rounded-md text-gray-800 dark:text-gray-200">
              {errorMessage}
            </pre>
          </fieldset>
        )}
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Back to homepage
          </Link>
          {(errorStatus === 500 || isRecoverableDomError) && (
            <button
              type="button"
              onClick={() => typeof window !== 'undefined' && window.location.reload()}
              className="inline-flex items-center justify-center rounded-md bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-white shadow-xs ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Refresh page
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** @typedef {LoaderReturnData} RootLoader */

/** @typedef {import('react-router').ShouldRevalidateFunction} ShouldRevalidateFunction */
/** @typedef {import('./+types/root').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
