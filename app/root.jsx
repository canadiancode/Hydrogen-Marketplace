import {Analytics, getShopAnalytics, useNonce} from '@shopify/hydrogen';
import {
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
 * The main and reset stylesheets are added in the Layout component
 * to prevent a bug in development HMR updates.
 *
 * This avoids the "failed to execute 'insertBefore' on 'Node'" error
 * that occurs after editing and navigating to another page.
 *
 * It's a temporary fix until the issue is resolved.
 * https://github.com/remix-run/remix/issues/9242
 */
export function links() {
  return [
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
    <html lang="en" className="bg-gray-50 dark:bg-gray-900">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="stylesheet" href={tailwindCss}></link>
        <link rel="stylesheet" href={resetStyles}></link>
        <link rel="stylesheet" href={appStyles}></link>
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

export default function App() {
  /** @type {RootLoader} */
  const data = useRouteLoaderData('root');

  if (!data) {
    return <Outlet />;
  }

  return (
    <Analytics.Provider
      cart={data.cart}
      shop={data.shop}
      consent={data.consent}
    >
      <CheckoutReturnHandler />
      <PageLayout {...data} isCreator={data.isCreator}>
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

  // Log full error server-side but don't expose to client in production
  if (!isDev) {
    console.error('ErrorBoundary caught:', error);
  }

  return (
    <div className="route-error">
      <h1>Oops</h1>
      <h2>{errorStatus}</h2>
      {isDev && errorMessage && (
        <fieldset>
          <pre>{errorMessage}</pre>
        </fieldset>
      )}
      {!isDev && (
        <p>{errorMessage}</p>
      )}
    </div>
  );
}

/** @typedef {LoaderReturnData} RootLoader */

/** @typedef {import('react-router').ShouldRevalidateFunction} ShouldRevalidateFunction */
/** @typedef {import('./+types/root').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
