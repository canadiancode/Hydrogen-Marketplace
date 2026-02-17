import {useLoaderData, useRouteError, isRouteErrorResponse} from 'react-router';
import {AnimatedBlobSection} from '~/components/AnimatedBlobSection';
import {Breadcrumbs} from '~/components/Breadcrumbs';
import {validateAndEscapeJSONLD} from '~/lib/json-ld';

/**
 * Safely extracts base URL from request with security validation
 * Prevents SSRF attacks and protocol-based vulnerabilities
 * @param {Request} request
 * @returns {string}
 */
function getSafeBaseUrl(request) {
  // Use environment variable if available, otherwise fallback
  const defaultUrl = typeof process !== 'undefined' && process.env?.PUBLIC_STORE_DOMAIN 
    ? `https://${process.env.PUBLIC_STORE_DOMAIN}`
    : 'https://wornvault.com';
  
  if (!request?.url) {
    return defaultUrl;
  }
  
  try {
    const url = new URL(request.url);
    
    // Security: Only allow http/https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return defaultUrl;
    }
    
    // In production, validate hostname to prevent SSRF
    const isProduction = typeof process !== 'undefined' && 
      process.env?.NODE_ENV === 'production';
    
    if (isProduction) {
      const hostname = url.hostname.toLowerCase();
      const allowedDomains = ['wornvault.com', 'www.wornvault.com'];
      const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname);
      
      // Reject non-whitelisted domains in production
      if (!isLocalhost && !allowedDomains.some(domain => 
        hostname === domain || hostname.endsWith(`.${domain}`)
      )) {
        return defaultUrl;
      }
    }
    
    return `${url.protocol}//${url.host}`;
  } catch {
    // Silently fail and return default URL
    return defaultUrl;
  }
}

/**
 * Generate JSON-LD structured data for the creator guidelines page
 * @param {string} baseUrl - Base URL for the site
 */
function generateStructuredData(baseUrl) {
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
    datePublished: typeof process !== 'undefined' && process.env?.GUIDELINES_PUBLISHED_DATE 
      ? process.env.GUIDELINES_PUBLISHED_DATE 
      : '2024-01-01',
    dateModified: typeof process !== 'undefined' && process.env?.GUIDELINES_MODIFIED_DATE
      ? process.env.GUIDELINES_MODIFIED_DATE
      : new Date().toISOString().split('T')[0],
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${baseUrl}/guidelines`,
    },
    articleSection: 'Guidelines',
    inLanguage: 'en-US',
  };
}

/**
 * @type {Route.MetaFunction}
 */
export const meta = ({request}) => {
  const baseUrl = getSafeBaseUrl(request);
  const canonicalUrl = `${baseUrl}/guidelines`;
  
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
  
  return headers;
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({request}) {
  const startTime = Date.now();
  
  try {
    const baseUrl = getSafeBaseUrl(request);
    const structuredData = generateStructuredData(baseUrl);
    
    // Validate and stringify JSON-LD in loader (security + performance)
    // This prevents XSS attacks and avoids re-stringifying on every render
    const structuredDataJson = validateAndEscapeJSONLD(structuredData);
    
    if (!structuredDataJson) {
      // If validation fails, log error but don't crash the page
      // The page will render without structured data
      console.error('Failed to generate valid JSON-LD structured data');
    }
    
    // Performance monitoring: Log slow requests
    const duration = Date.now() - startTime;
    if (duration > 100) {
      console.warn(`Slow loader: guidelines took ${duration}ms`);
    }
    
    return {
      baseUrl,
      structuredDataJson, // Pre-validated and stringified JSON
    };
  } catch (error) {
    // Log error for monitoring (sanitized)
    const errorInfo = {
      message: error instanceof Error ? error.message : 'Unknown error',
      route: 'guidelines',
      timestamp: new Date().toISOString(),
    };
    console.error('Loader error:', errorInfo);
    
    // Re-throw to trigger error boundary
    throw error;
  }
}


export default function CreatorGuidelinesPage() {
  const {baseUrl, structuredDataJson} = useLoaderData();
  
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
        {/* Hero Section */}
        <AnimatedBlobSection>
          <div className="relative z-0 mx-auto max-w-4xl py-24 sm:py-32">
            <div className="text-center">
              <h1 className="text-5xl font-semibold tracking-tight text-balance text-gray-900 sm:text-6xl dark:text-white">
                Creator Guidelines
              </h1>
              <p className="mt-6 text-lg font-medium text-pretty text-gray-600 sm:text-xl/8 dark:text-gray-400">
                Rules & Standards
              </p>
            </div>
          </div>
        </AnimatedBlobSection>

        {/* Main Content */}
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          {/* Breadcrumbs */}
          <div className="mb-8">
            <Breadcrumbs 
              items={[
                {name: 'Home', href: '/', current: false},
                {name: 'Guidelines', href: '/guidelines', current: true},
              ]}
            />
          </div>
          
          {/* Intro Section */}
          <div className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              WornVault is a private, verified marketplace designed to help creators sell one-of-a-kind, personal items safely and discreetly.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              To protect creators, buyers, and the platform, all listings must follow the guidelines below. These rules are enforced consistently and without exception.
            </p>
          </div>
          
          {/* Main Content */}
          <main>
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
 * Production-safe error logging to prevent information leakage
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isDev = typeof process !== 'undefined' && 
    process.env?.NODE_ENV === 'development';
  
  let errorMessage = 'Something went wrong';
  let errorStatus = 500;
  
  if (isRouteErrorResponse(error)) {
    errorStatus = error.status;
    errorMessage = isDev 
      ? (error?.data?.message ?? error.data ?? 'An error occurred')
      : 'We encountered an error loading this page. Please try again later.';
  } else if (error instanceof Error && isDev) {
    errorMessage = error.message;
  }
  
  // Production-safe error logging
  if (!isDev) {
    const errorInfo = {
      message: error instanceof Error ? error.message : 'Unknown error',
      status: isRouteErrorResponse(error) ? error.status : undefined,
      route: 'guidelines',
      timestamp: new Date().toISOString(),
    };
    
    // Log sanitized error info (don't log full error object)
    console.error('ErrorBoundary:', errorInfo);
    
    // TODO: Send to error tracking service (Sentry, LogRocket, etc.)
    // Example: trackError(errorInfo);
  }
  
  return (
    <div className="bg-white dark:bg-gray-900 min-h-screen">
      <div className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 sm:pb-24 lg:px-8">
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <h2 className="text-lg font-medium text-red-800 dark:text-red-200 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-red-700 dark:text-red-300">
            {errorMessage}
          </p>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/guidelines').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

