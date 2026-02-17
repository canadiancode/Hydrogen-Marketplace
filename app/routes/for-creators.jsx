import {useRouteError, isRouteErrorResponse, useLoaderData} from 'react-router';
import {AnimatedBlobSection} from '~/components/AnimatedBlobSection';
import {Breadcrumbs} from '~/components/Breadcrumbs';
import {LockClosedIcon, ChatBubbleLeftRightIcon, CheckCircleIcon} from '@heroicons/react/20/solid';

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
 * Generate JSON-LD structured data for the for-creators page
 * @param {string} baseUrl - Base URL for the site
 */
function generateStructuredData(baseUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'For Creators | WornVault',
    description: 'WornVault exists to remove friction — not add it. Sell personal, one-of-one items without managing logistics, buyers, or problems. Focus on creating while we handle fulfillment.',
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
      '@id': `${baseUrl}/for-creators`,
    },
    articleSection: 'Creator Information',
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
          route: 'for-creators',
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
      route: 'for-creators',
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
  const canonicalUrl = `${baseUrl}/for-creators`;
  
  return [
    {title: 'For Creators | WornVault'},
    {
      name: 'description',
      content: 'WornVault exists to remove friction — not add it. Sell personal, one-of-one items without managing logistics, buyers, or problems. Focus on creating while we handle fulfillment.',
    },
    {rel: 'canonical', href: canonicalUrl},
    {property: 'og:title', content: 'For Creators | WornVault'},
    {
      property: 'og:description',
      content: 'WornVault exists to remove friction — not add it. Sell personal, one-of-one items without managing logistics, buyers, or problems.',
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
      console.warn(`Slow loader: for-creators took ${duration}ms`);
    }
    
    return {
      baseUrl,
      structuredDataJson, // Pre-validated and stringified JSON
    };
  } catch (error) {
    // Log error for monitoring (sanitized)
    const errorInfo = {
      message: error instanceof Error ? error.message : 'Unknown error',
      route: 'for-creators',
      timestamp: new Date().toISOString(),
    };
    console.error('Loader error:', errorInfo);
    
    // Re-throw to trigger error boundary
    throw error;
  }
}

export default function ForCreatorsPage() {
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
                WornVault exists to remove friction — not add it.
              </h1>
              <p className="mt-6 text-lg font-medium text-pretty text-gray-600 sm:text-xl/8 dark:text-gray-400">
                Focus on creating — not managing logistics, buyers, or problems
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
                {name: 'For Creators', href: '/for-creators', current: true},
              ]}
            />
          </div>
          
          {/* Intro Section */}
          <div className="overflow-hidden bg-white py-12 sm:py-16 dark:bg-gray-900 mb-12 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 sm:gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-2">
                <div className="lg:pt-4 lg:pr-8">
                  <div className="lg:max-w-lg">
                    <h2 className="text-base/7 font-semibold text-indigo-600 dark:text-indigo-400">
                      Remove friction
                    </h2>
                    <p className="mt-2 text-4xl font-semibold tracking-tight text-pretty text-gray-900 sm:text-5xl dark:text-white">
                      Focus on creating, not logistics
                    </p>
                    <p className="mt-6 text-lg/8 text-gray-700 dark:text-gray-300">
                      Selling personal, one-of-one items online comes with risk, stress, and constant decision-making. WornVault was built to take that weight off your shoulders, so you can focus on creating — not managing logistics, buyers, or problems.
                    </p>
                    <dl className="mt-10 max-w-xl space-y-8 text-base/7 text-gray-600 lg:max-w-none dark:text-gray-400">
                      <div className="relative pl-9">
                        <dt className="inline font-semibold text-gray-900 dark:text-white">
                          <LockClosedIcon
                            aria-hidden="true"
                            className="absolute top-1 left-1 size-5 text-indigo-600 dark:text-indigo-400"
                          />
                          Privacy protection
                        </dt>{' '}
                        <dd className="inline">
                          Your personal address, email, and contact details are never shared with buyers. All shipping is issued and tracked through WornVault.
                        </dd>
                      </div>
                      <div className="relative pl-9">
                        <dt className="inline font-semibold text-gray-900 dark:text-white">
                          <ChatBubbleLeftRightIcon
                            aria-hidden="true"
                            className="absolute top-1 left-1 size-5 text-indigo-600 dark:text-indigo-400"
                          />
                          No buyer management
                        </dt>{' '}
                        <dd className="inline">
                          You never deal with buyers directly. No messages, bargaining, or uncomfortable conversations. WornVault handles all communication and issue resolution.
                        </dd>
                      </div>
                      <div className="relative pl-9">
                        <dt className="inline font-semibold text-gray-900 dark:text-white">
                          <CheckCircleIcon
                            aria-hidden="true"
                            className="absolute top-1 left-1 size-5 text-indigo-600 dark:text-indigo-400"
                          />
                          Managed fulfillment
                        </dt>{' '}
                        <dd className="inline">
                          We send you packaging and prepaid labels. You pack and drop off. We handle tracking, delivery confirmation, and any issues that arise.
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
                {/* Dark mode */}
                <img
                  alt="WornVault creator dashboard"
                  src="https://cdn.shopify.com/s/files/1/0024/9551/2691/files/WornVault_Creator_Dashboard_Dark.png?v=1770956868"
                  width={2432}
                  height={1442}
                  className="w-3xl max-w-none rounded-xl shadow-xl ring-1 ring-gray-400/10 not-dark:hidden sm:w-228 md:-ml-4 lg:-ml-0 dark:ring-white/10"
                />

                {/* Light mode */}
                <img
                  alt="WornVault creator dashboard"
                  src="https://cdn.shopify.com/s/files/1/0024/9551/2691/files/White_WornVault_Creator_Dashboard.png?v=1770956898"
                  width={2432}
                  height={1442}
                  className="w-3xl max-w-none rounded-xl shadow-xl ring-1 ring-gray-400/10 sm:w-228 md:-ml-4 lg:-ml-0 dark:hidden dark:ring-white/10"
                />
              </div>
            </div>
          </div>
          
          {/* How Fulfillment Works Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              How Fulfillment Works for Creators
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              When one of your items sells, WornVault handles the shipping setup for you.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              You receive:
            </p>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>A properly sized package sent directly to you</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>A prepaid shipping label addressed to the buyer</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Clear packing instructions and a ship-by deadline</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              You don't need to:
            </p>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Buy packaging</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Print labels</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Pay for shipping</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Choose a courier</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Manage tracking or delivery issues</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              You simply pack the item and drop it off.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              We manage the rest.
            </p>
          </section>
          
          {/* Your Privacy Is Protected Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Your Privacy Is Protected
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              Your personal address, email, and contact details are never shared with buyers.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              Buyers do not see:
            </p>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Your home address</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Your return address</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Your personal email</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Your phone number</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              All shipping is issued and tracked through WornVault, keeping your identity and location private at all times.
            </p>
          </section>
          
          {/* No Buyer DMs. No Negotiations Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              No Buyer DMs. No Negotiations.
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              You never deal with buyers directly.
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No messages.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No bargaining.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No uncomfortable conversations.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No follow-ups.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No pressure.</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              WornVault handles:
            </p>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Buyer communication</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Shipping updates</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Questions and concerns</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Issue resolution</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              This protects your time, boundaries, and mental energy.
            </p>
          </section>
          
          {/* We Remove the Friction Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              We Remove the Friction
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              Selling online usually means juggling platforms, payments, shipping, and disputes. WornVault replaces all of that with a single, managed flow.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              You don't have to:
            </p>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Track packages</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Prove shipment</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Respond to "where is my order?" messages</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Handle delivery delays</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Fight chargebacks</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              Because shipping is managed by WornVault, buyers can't bypass the system — and you aren't left exposed when something goes wrong.
            </p>
          </section>
          
          {/* No Chargebacks. No Guesswork Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              No Chargebacks. No Guesswork.
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              WornVault controls the transaction, the shipping label, and the delivery confirmation.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              That means:
            </p>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Chargebacks are prevented at the platform level</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Delivery is verified through WornVault-issued tracking</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Payouts are tied to confirmed shipment and receipt</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Disputes are handled by us — not you</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              You sell with confidence, not uncertainty.
            </p>
          </section>
          
          {/* Designed for One-of-One Items Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Designed for One-of-One Items
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              WornVault isn't built for bulk resellers or mass listings.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              It's built for:
            </p>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Personal items</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Limited pieces</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Creator-owned goods</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Items that can't be replaced</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              That's why we prioritize discretion, trust, and professional oversight — so you don't have to manage risk alone.
            </p>
          </section>
          
          {/* Why Creators Choose WornVault Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Why Creators Choose WornVault
            </h2>
            <ul className="list-none pl-0 space-y-3 text-base text-gray-700 dark:text-gray-300 mb-6">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No shipping costs</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No packaging stress</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No buyer negotiations</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No personal information exposure</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No fulfillment headaches</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No chargeback anxiety</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>No platform chaos</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              Just a clean, controlled way to sell unique items — with WornVault handling the hard parts.
            </p>
          </section>
          
          {/* Closing Section */}
          <section className="mb-8">
            <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed">
              WornVault isn't just a marketplace.<br />
              It's infrastructure for creators who want less friction and more peace of mind.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

/**
 * Error boundary for for-creators page
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
      route: 'for-creators',
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

/** @typedef {import('./+types/for-creators').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

