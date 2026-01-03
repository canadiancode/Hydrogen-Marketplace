import {useRouteError, isRouteErrorResponse, useLoaderData} from 'react-router';
import {Link} from 'react-router';
import {Breadcrumbs} from '~/components/Breadcrumbs';

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
 * Generate JSON-LD structured data for the for-buyers page
 * @param {string} baseUrl - Base URL for the site
 */
function generateStructuredData(baseUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'For Buyers | WornVault',
    description: 'Buying on WornVault is different — by design. Learn how our fulfillment system protects trust, discretion, and delivery for every one-of-one, creator-owned item.',
    author: {
      '@type': 'Organization',
      name: 'WornVault',
    },
    publisher: {
      '@type': 'Organization',
      name: 'WornVault',
    },
    datePublished: typeof process !== 'undefined' && process.env?.SITE_LAUNCH_DATE 
      ? process.env.SITE_LAUNCH_DATE 
      : '2024-01-01',
    dateModified: new Date().toISOString().split('T')[0],
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${baseUrl}/for-buyers`,
    },
    articleSection: 'Buyer Information',
    inLanguage: 'en-US',
  };
}

/**
 * Validates and safely stringifies JSON-LD structured data
 * Prevents XSS attacks through comprehensive script injection detection
 * @param {object} data - Structured data object to validate
 * @returns {string|null} - Validated JSON string or null if validation fails
 */
function validateAndEscapeJSONLD(data) {
  try {
    // Validate it's actually valid JSON by stringifying
    const jsonString = JSON.stringify(data);
    
    // Comprehensive script injection detection
    // Check for various encoding and obfuscation attempts
    const dangerousPatterns = [
      /<\/script>/gi,                    // Closing script tag
      /<script/gi,                       // Opening script tag
      /javascript:/gi,                   // JavaScript protocol
      /on\w+\s*=/gi,                     // Event handlers (onclick, onerror, etc.)
      /&#x?[0-9a-f]+;/gi,                // HTML entities that could hide scripts
      /&#\d+;/gi,                        // Numeric HTML entities
      /\\x[0-9a-f]{2}/gi,                // Hex escape sequences
      /\\u[0-9a-f]{4}/gi,                // Unicode escape sequences
      /data:text\/html/gi,               // Data URLs with HTML
      /vbscript:/gi,                     // VBScript protocol
      /expression\s*\(/gi,               // CSS expressions (IE)
      /@import/gi,                       // CSS imports that could load scripts
    ];
    
    // Check for dangerous patterns
    for (const pattern of dangerousPatterns) {
      if (pattern.test(jsonString)) {
        console.error('JSON-LD validation failed: dangerous pattern detected', {
          pattern: pattern.toString(),
          route: 'for-buyers',
        });
        return null;
      }
    }
    
    // Validate schema.org structure
    if (data['@context'] !== 'https://schema.org') {
      console.error('JSON-LD validation failed: invalid schema.org context');
      return null;
    }
    
    // Additional validation: ensure no nested objects contain script-like content
    // This is a recursive check for deeply nested malicious content
    const checkNestedValues = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          // Check string values for script patterns
          const lowerValue = obj[key].toLowerCase();
          if (lowerValue.includes('script') || 
              lowerValue.includes('javascript') ||
              lowerValue.includes('onerror') ||
              lowerValue.includes('onclick')) {
            // Allow legitimate schema.org properties that contain these words
            const allowedKeys = ['description', 'headline', 'articleSection'];
            if (!allowedKeys.includes(key)) {
              console.error('JSON-LD validation failed: suspicious content in nested value');
              return false;
            }
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          if (!checkNestedValues(obj[key])) {
            return false;
          }
        }
      }
      return true;
    };
    
    if (!checkNestedValues(data)) {
      return null;
    }
    
    return jsonString;
  } catch (error) {
    console.error('JSON-LD validation failed: JSON stringification error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      route: 'for-buyers',
    });
    return null;
  }
}

/**
 * Cache headers for static content with security headers
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
 * @type {Route.MetaFunction}
 */
export const meta = ({request}) => {
  const baseUrl = getSafeBaseUrl(request);
  const canonicalUrl = `${baseUrl}/for-buyers`;
  
  return [
    {title: 'For Buyers | WornVault'},
    {
      name: 'description',
      content: 'Buying on WornVault is different — by design. Learn how our fulfillment system protects trust, discretion, and delivery for every one-of-one, creator-owned item.',
    },
    {rel: 'canonical', href: canonicalUrl},
    {property: 'og:title', content: 'For Buyers | WornVault'},
    {
      property: 'og:description',
      content: 'Buying on WornVault is different — by design. Learn how our fulfillment system protects trust, discretion, and delivery.',
    },
    {property: 'og:type', content: 'article'},
    {property: 'og:url', content: canonicalUrl},
  ];
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
      console.warn(`Slow loader: for-buyers took ${duration}ms`);
    }
    
    return {
      baseUrl,
      structuredDataJson, // Pre-validated and stringified JSON
    };
  } catch (error) {
    // Log error for monitoring (sanitized)
    const errorInfo = {
      message: error instanceof Error ? error.message : 'Unknown error',
      route: 'for-buyers',
      timestamp: new Date().toISOString(),
    };
    console.error('Loader error:', errorInfo);
    
    // Re-throw to trigger error boundary
    throw error;
  }
}

export default function ForBuyersPage() {
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
        <div className="relative isolate z-0 px-6 pt-14 lg:px-8">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80"
          >
            <div
              style={{
                clipPath:
                  'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
              }}
              className="relative left-[calc(50%-11rem)] aspect-1155/678 w-144.5 -translate-x-1/2 rotate-30 bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-30 sm:left-[calc(50%-30rem)] sm:w-288.75"
            />
          </div>
          <div className="relative z-0 mx-auto max-w-4xl py-24 sm:py-32">
            <div className="text-center">
              <h1 className="text-5xl font-semibold tracking-tight text-balance text-gray-900 sm:text-6xl dark:text-white">
                Buying on WornVault is different — by design.
              </h1>
              <p className="mt-6 text-lg font-medium text-pretty text-gray-600 sm:text-xl/8 dark:text-gray-400">
                Trust, discretion, and delivery matter just as much as the item itself
              </p>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-[calc(100%-13rem)] -z-10 transform-gpu overflow-hidden blur-3xl sm:top-[calc(100%-30rem)]"
          >
            <div
              style={{
                clipPath:
                  'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
              }}
              className="relative left-[calc(50%+3rem)] aspect-1155/678 w-144.5 -translate-x-1/2 bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-30 sm:left-[calc(50%+36rem)] sm:w-288.75"
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          {/* Breadcrumbs */}
          <div className="mb-8">
            <Breadcrumbs 
              items={[
                {name: 'Home', href: '/', current: false},
                {name: 'For Buyers', href: '/for-buyers', current: true},
              ]}
            />
          </div>
          
          {/* Intro Section */}
          <div className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              Every item on WornVault is one-of-one, creator-owned, and deeply personal. That means trust, discretion, and delivery matter just as much as the item itself. Our fulfillment system is built to protect all three.
            </p>
          </div>
          
          {/* How Shipping Works Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              How Shipping Works on WornVault
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              When you purchase an item, WornVault manages the shipping process from start to finish — even though the item ships directly from the creator.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              Here's what that means for you:
            </p>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Shipping is prepaid and arranged by WornVault</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Tracking is monitored by WornVault</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Delivery timelines are enforced by WornVault</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Support and resolution are handled by WornVault</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              Creators don't choose how to ship your item. We do.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              Items ship directly to you using WornVault-issued labels and packaging standards, ensuring speed, discretion, and consistency — without unnecessary handling or delays.
            </p>
          </section>
          
          {/* Why This Matters Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Why This Matters for Buyers
            </h2>
            
            <div className="space-y-6">
              {/* Faster Delivery */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                  Faster Delivery
                </h3>
                <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                  Your item ships directly to you, avoiding unnecessary transfers or holding facilities. Fewer steps means faster delivery and fewer things that can go wrong.
                </p>
              </div>

              {/* Discretion by Default */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                  Discretion by Default
                </h3>
                <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                  All shipments follow strict packaging and privacy standards. No branding, no creator identifiers, no unnecessary information — just discreet delivery to your door.
                </p>
              </div>

              {/* Accountability, Not Guesswork */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                  Accountability, Not Guesswork
                </h3>
                <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                  You're not relying on individual creators to manage logistics. WornVault oversees tracking, enforces ship-by deadlines, and steps in immediately if something goes wrong.
                </p>
              </div>

              {/* Single Point of Support */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                  Single Point of Support
                </h3>
                <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                  If you have a question, concern, or issue, you contact WornVault — not the creator. We take responsibility for resolving problems so you don't have to negotiate or chase anyone.
                </p>
              </div>

              {/* Reduced Risk */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                  Reduced Risk
                </h3>
                <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                  Because WornVault controls shipping, timelines, and delivery confirmation, buyers experience fewer delays, fewer disputes, and a smoother overall transaction.
                </p>
              </div>
            </div>
          </section>
          
          {/* One-of-One Section */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              One-of-One, Without the Stress
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              WornVault was built for items that can't be replaced — and buyers who expect more than a typical resale experience.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              You get:
            </p>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Unique items you can't find anywhere else</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Direct-to-you delivery without added risk</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Professional oversight without warehouse delays</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>A trusted platform standing behind every order</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              This isn't peer-to-peer shipping.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              It's WornVault-managed fulfillment — designed for trust, privacy, and peace of mind.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

/**
 * Error boundary for for-buyers page
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
      route: 'for-buyers',
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

/** @typedef {import('./+types/for-buyers').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

