import {useLoaderData, useRouteError, isRouteErrorResponse} from 'react-router';
import {Breadcrumbs} from '~/components/Breadcrumbs';
import {validateAndEscapeJSONLD} from '~/lib/json-ld';

/**
 * Validates and sanitizes base URL to prevent XSS attacks
 * Only allows whitelisted domains with https protocol
 * @param {string} url - URL to validate
 * @returns {string} - Sanitized URL
 */
function validateAndSanitizeBaseUrl(url) {
  if (!url || typeof url !== 'string') {
    return 'https://wornvault.com';
  }
  
  try {
    const parsed = new URL(url);
    // Only allow https protocol
    if (parsed.protocol !== 'https:') {
      return 'https://wornvault.com';
    }
    // Whitelist allowed domains
    const allowedDomains = ['wornvault.com', 'www.wornvault.com'];
    if (!allowedDomains.includes(parsed.hostname)) {
      return 'https://wornvault.com';
    }
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return 'https://wornvault.com';
  }
}

/**
 * @type {Route.MetaFunction}
 */
export const meta = ({data, request}) => {
  // Safely construct canonical URL from data (already validated in loader)
  const canonicalUrl = data?.baseUrl 
    ? `${data.baseUrl}/creators/guidelines`
    : 'https://wornvault.com/creators/guidelines';
  
  return [
    {title: 'Creator Guidelines | WornVault'},
    {
      name: 'description',
      content: 'WornVault creator guidelines for listing items on our private, verified marketplace. Learn about eligibility, prohibited items, listing standards, and enforcement policies.',
    },
    {rel: 'canonical', href: canonicalUrl},
    {property: 'og:title', content: 'Creator Guidelines | WornVault'},
    {
      property: 'og:description',
      content: 'WornVault creator guidelines for listing items on our private, verified marketplace.',
    },
    {property: 'og:type', content: 'article'},
    {property: 'og:url', content: canonicalUrl},
  ];
};

/**
 * @type {import('react-router').HeadersFunction}
 */
export const headers = () => {
  const headers = new Headers();
  
  // Performance: Cache static content aggressively
  headers.set(
    'Cache-Control',
    'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
  );
  
  // Security headers
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  return headers;
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({request}) {
  // Use environment variable in production, fallback to request parsing
  let baseUrl = process.env.PUBLIC_SITE_URL;
  
  if (!baseUrl && request?.url) {
    try {
      const url = new URL(request.url);
      baseUrl = `${url.protocol}//${url.host}`;
    } catch (error) {
      // Only log in development to avoid exposing errors in production
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Failed to parse request URL in loader:', error);
      }
    }
  }
  
  // Get dates for structured data (server-side only)
  const datePublished = process.env.GUIDELINES_PUBLISHED_DATE || '2024-01-01';
  const dateModified = process.env.GUIDELINES_MODIFIED_DATE || new Date().toISOString().split('T')[0];
  
  return {
    baseUrl: validateAndSanitizeBaseUrl(baseUrl || 'https://wornvault.com'),
    datePublished,
    dateModified,
  };
}

/**
 * Prevent unnecessary revalidation for static content
 * This is static content that rarely changes, so we can cache aggressively
 */
export const shouldRevalidate = () => false;

/**
 * Generate JSON-LD structured data for the guidelines page
 * @param {string} baseUrl - Base URL for the site (must be validated)
 * @param {string} datePublished - Published date (from loader)
 * @param {string} dateModified - Modified date (from loader)
 */
function generateStructuredData(baseUrl, datePublished, dateModified) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'WornVault — Creator Guidelines',
    description: 'WornVault creator guidelines for listing items on our private, verified marketplace. Learn about eligibility, prohibited items, listing standards, and enforcement policies.',
    author: {
      '@type': 'Organization',
      name: 'WornVault',
    },
    publisher: {
      '@type': 'Organization',
      name: 'WornVault',
    },
    datePublished,
    dateModified,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${baseUrl}/creators/guidelines`,
    },
    articleSection: 'Guidelines',
    inLanguage: 'en-US',
  };
}

export default function CreatorGuidelinesPage() {
  const data = useLoaderData();
  // baseUrl is already validated and sanitized in loader
  const baseUrl = data?.baseUrl || 'https://wornvault.com';
  const datePublished = data?.datePublished || '2024-01-01';
  const dateModified = data?.dateModified || new Date().toISOString().split('T')[0];
  const structuredData = generateStructuredData(baseUrl, datePublished, dateModified);
  
  // Validate and safely stringify JSON-LD to prevent XSS attacks
  const structuredDataJson = validateAndEscapeJSONLD(structuredData);
  
  return (
    <>
      {/* JSON-LD Structured Data - Pre-validated and safe */}
      {structuredDataJson && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{__html: structuredDataJson}}
        />
      )}
      
      <div className="bg-white dark:bg-gray-900 min-h-screen">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          {/* Breadcrumbs */}
          <div className="mb-8">
            <Breadcrumbs 
              items={[
                {name: 'Home', href: '/', current: false},
                {name: 'Creators', href: '/creators', current: false},
                {name: 'Guidelines', href: '/creators/guidelines', current: true},
              ]}
            />
          </div>
          
          {/* Header */}
          <header className="mb-12">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-5xl mb-4">
              WornVault — Creator Guidelines
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 leading-relaxed">
              WornVault is a private, verified marketplace designed to help creators sell one-of-a-kind, personal items safely and discreetly.
            </p>
            <p className="mt-4 text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              To protect creators, buyers, and the platform, all listings must follow the guidelines below. These rules are enforced consistently and without exception.
            </p>
          </header>
          
          {/* Main Content */}
          <main className="prose prose-lg dark:prose-invert max-w-none">
            {/* General Eligibility */}
            <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 mt-0">
                General Eligibility
              </h2>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                By listing on WornVault, you confirm that:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-base text-gray-700 dark:text-gray-300">
                <li>You are at least 18 years of age</li>
                <li>You have the legal right to sell the item you list</li>
                <li>You are the rightful owner of the item</li>
                <li>All information provided is accurate and truthful</li>
              </ul>
            </section>
            
            {/* Prohibited Items */}
            <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 mt-0">
                Prohibited Items
              </h2>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                The following items are strictly prohibited and may not be listed under any circumstances:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-base text-gray-700 dark:text-gray-300">
                <li>Illegal drugs, controlled substances, or drug paraphernalia</li>
                <li>Firearms, weapon components, ammunition, or explosives</li>
                <li>Stolen goods or items you do not legally own</li>
                <li>Counterfeit or replica items presented as authentic</li>
                <li>Items that violate local, national, or international laws</li>
                <li>Items involving minors or any content related to minors</li>
                <li>Medical devices, prescription medications, or biological samples</li>
                <li>Items intended to cause harm or facilitate illegal activity</li>
              </ul>
              <p className="mt-6 text-base text-gray-700 dark:text-gray-300 font-medium leading-relaxed">
                Listings that violate these rules will be removed immediately.
              </p>
            </section>
            
            {/* Adult Content Guidelines */}
            <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 mt-0">
                Adult Content Guidelines
              </h2>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                WornVault allows the sale of adult-oriented personal items, provided that:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
                <li>All parties involved are consenting adults (18+)</li>
                <li>The item is a physical product, not a digital service</li>
                <li>The listing does not promote illegal activity</li>
                <li>Descriptions remain factual and non-exploitative</li>
              </ul>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed font-medium">
                WornVault does not allow:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-base text-gray-700 dark:text-gray-300">
                <li>Explicit sexual services</li>
                <li>Prostitution or escorting</li>
                <li>Digital-only content or access passes</li>
                <li>Anything that violates payment processor policies</li>
              </ul>
            </section>
            
            {/* Listing Standards */}
            <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 mt-0">
                Listing Standards
              </h2>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                All listings must:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-base text-gray-700 dark:text-gray-300">
                <li>Have a minimum price of <strong className="font-semibold text-gray-900 dark:text-white">$100 USD</strong></li>
                <li>Accurately describe the item and its condition</li>
                <li>Use original photos that represent the actual item</li>
                <li>Avoid misleading or deceptive language</li>
                <li>Comply with category-specific requirements</li>
                <li>Match the item sent to WornVault after sale</li>
              </ul>
              <p className="mt-6 text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                Failure to send the correct item after a sale may result in penalties or account suspension.
              </p>
            </section>
            
            {/* Privacy & Communication */}
            <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 mt-0">
                Privacy & Communication
              </h2>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                To protect all parties:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-base text-gray-700 dark:text-gray-300">
                <li>Direct buyer–seller communication is not permitted</li>
                <li>Do not attempt to contact buyers outside the platform</li>
                <li>Do not include personal contact information in listings or packaging</li>
                <li>All fulfillment is handled by WornVault</li>
              </ul>
              <p className="mt-6 text-base text-gray-700 dark:text-gray-300 leading-relaxed font-medium">
                Any attempt to bypass platform systems may result in account termination.
              </p>
            </section>
            
            {/* Enforcement & Three-Strike Policy */}
            <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 mt-0">
                Enforcement & Three-Strike Policy
              </h2>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                WornVault enforces a three-strike policy for guideline violations.
              </p>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed font-medium">
                Strike examples include:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
                <li>Attempting to list prohibited items</li>
                <li>Misrepresenting items or identity</li>
                <li>Repeated guideline violations</li>
                <li>Circumventing platform protections</li>
              </ul>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed font-medium">
                Strike policy:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-base text-gray-700 dark:text-gray-300">
                <li><strong>First strike:</strong> Listing removal and warning</li>
                <li><strong>Second strike:</strong> Temporary suspension</li>
                <li><strong>Third strike:</strong> Permanent account removal</li>
              </ul>
              <p className="mt-6 text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                Severe violations (illegal activity, fraud, or harm) may result in immediate account termination without warning.
              </p>
            </section>
            
            {/* WornVault's Role */}
            <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 mt-0">
                WornVault's Role
              </h2>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                WornVault is an intermediary platform.
              </p>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed font-medium">
                We reserve the right to:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-base text-gray-700 dark:text-gray-300">
                <li>Review, approve, or remove listings</li>
                <li>Request additional verification</li>
                <li>Delay or withhold payouts during investigations</li>
                <li>Update guidelines as laws or platform requirements evolve</li>
              </ul>
              <p className="mt-6 text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                These measures exist to protect creators, buyers, and the integrity of the marketplace.
              </p>
            </section>
            
            {/* Agreement */}
            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 mt-0">
                Agreement
              </h2>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                By using WornVault, you agree to comply with these guidelines.
              </p>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                Failure to do so may result in listing removal, account suspension, or permanent removal from the platform.
              </p>
              <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                If you have questions about what is allowed, contact WornVault support before listing.
              </p>
            </section>
          </main>
        </div>
      </div>
    </>
  );
}

/**
 * Error boundary for creator guidelines page
 * Catches errors during rendering and provides fallback UI
 */
export function ErrorBoundary() {
  const error = useRouteError();
  // Safely check for development mode (process may not exist in browser)
  const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
  
  let errorMessage = 'Something went wrong';
  let errorStatus = 500;
  
  if (isRouteErrorResponse(error)) {
    errorStatus = error.status;
    errorMessage = isDev 
      ? (error?.data?.message ?? error.data ?? 'An error occurred')
      : 'We encountered an error loading the guidelines page. Please try again later.';
  } else if (error instanceof Error && isDev) {
    errorMessage = error.message;
  }
  
  // Log full error server-side but don't expose to client in production
  if (!isDev) {
    console.error('Guidelines page ErrorBoundary caught:', error);
  }
  
  return (
    <div className="bg-white dark:bg-gray-900 min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <h2 className="text-lg font-medium text-red-800 dark:text-red-200 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-red-700 dark:text-red-300 mb-4">
            {errorMessage}
          </p>
          <a
            href="/creators/guidelines"
            className="text-sm font-medium text-red-800 dark:text-red-200 hover:underline"
          >
            Try again
          </a>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creators.guidelines').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

