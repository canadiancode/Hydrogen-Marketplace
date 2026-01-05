import {useRouteError, isRouteErrorResponse, useLoaderData} from 'react-router';
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
 * Generate JSON-LD structured data for the terms of service page
 * @param {string} baseUrl - Base URL for the site (must be pre-validated)
 */
function generateStructuredData(baseUrl) {
  // Additional safety check: ensure baseUrl is a valid HTTPS URL
  // This provides defense-in-depth even if getSafeBaseUrl validation fails
  let safeBaseUrl = baseUrl;
  try {
    const url = new URL(baseUrl);
    // Only allow HTTPS in production
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      if (url.protocol !== 'https:') {
        safeBaseUrl = 'https://wornvault.com';
      }
    }
    // Ensure hostname is safe (no script injection attempts)
    if (url.hostname.includes('<') || url.hostname.includes('>') || url.hostname.includes('"')) {
      safeBaseUrl = 'https://wornvault.com';
    }
  } catch {
    // If URL parsing fails, use safe default
    safeBaseUrl = 'https://wornvault.com';
  }
  
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    headline: 'Terms of Service | WornVault',
    description: 'WornVault Terms of Service. Learn about the terms and conditions governing your use of our platform.',
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
      '@id': `${safeBaseUrl}/terms-of-service`,
    },
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
          route: 'terms-of-service',
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
            const allowedKeys = ['description', 'headline'];
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
      route: 'terms-of-service',
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
  const canonicalUrl = `${baseUrl}/terms-of-service`;
  
  return [
    {title: 'Terms of Service | WornVault'},
    {
      name: 'description',
      content: 'WornVault Terms of Service. Learn about the terms and conditions governing your use of our platform.',
    },
    {rel: 'canonical', href: canonicalUrl},
    {property: 'og:title', content: 'Terms of Service | WornVault'},
    {
      property: 'og:description',
      content: 'WornVault Terms of Service. Learn about the terms and conditions governing your use of our platform.',
    },
    {property: 'og:type', content: 'website'},
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
      console.warn(`Slow loader: terms-of-service took ${duration}ms`);
    }
    
    return {
      baseUrl,
      structuredDataJson, // Pre-validated and stringified JSON
    };
  } catch (error) {
    // Log error for monitoring (sanitized)
    const errorInfo = {
      message: error instanceof Error ? error.message : 'Unknown error',
      route: 'terms-of-service',
      timestamp: new Date().toISOString(),
    };
    console.error('Loader error:', errorInfo);
    
    // Re-throw to trigger error boundary
    throw error;
  }
}

export default function TermsOfServicePage() {
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
                Terms of Service
              </h1>
              <p className="mt-6 text-lg font-medium text-pretty text-gray-600 sm:text-xl/8 dark:text-gray-400">
                Terms and conditions governing your use of WornVault
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
                {name: 'Terms of Service', href: '/terms-of-service', current: true},
              ]}
            />
          </div>
          
          {/* Last Updated */}
          <div className="mb-8 pb-4 border-b border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          
          {/* Introduction */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              These Terms of Service ("Terms") govern your access to and use of the WornVault website, applications, and services (collectively, the "Services"). By accessing or using WornVault, you agree to be bound by these Terms.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed font-semibold">
              If you do not agree to these Terms, you may not use the Services.
            </p>
          </section>
          
          {/* Section 1: About WornVault */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              1. About WornVault
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              WornVault is an online marketplace platform that enables creators to list and sell one-of-one, creator-owned items to buyers. WornVault provides platform infrastructure, payment processing, identity verification, and managed fulfillment coordination.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              WornVault is not a buyer or seller of items listed on the platform and does not take ownership of items unless explicitly stated otherwise.
            </p>
          </section>
          
          {/* Section 2: Eligibility */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              2. Eligibility
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              You must be at least 18 years old to use the Services. By using WornVault, you represent and warrant that you meet this requirement and have the legal capacity to enter into these Terms.
            </p>
          </section>
          
          {/* Section 3: User Accounts */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              3. User Accounts
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              To access certain features, you must create an account. You agree to:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Provide accurate and complete information</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Maintain the security of your account credentials</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Notify us promptly of unauthorized access or use</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              You are responsible for all activity that occurs under your account.
            </p>
          </section>
          
          {/* Section 4: Creator Accounts and Listings */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              4. Creator Accounts and Listings
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              Creators are responsible for ensuring that:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>They own or have the legal right to sell listed items</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Listings are accurate, truthful, and not misleading</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Items comply with applicable laws and platform policies</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              WornVault reserves the right to remove listings or suspend accounts that violate these Terms or applicable laws.
            </p>
          </section>
          
          {/* Section 5: Verification and Social Account Connections */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              5. Verification and Social Account Connections
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              WornVault may offer account verification through OAuth-based connections to third-party platforms.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              By connecting a social account, you authorize WornVault to:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Verify that you control the connected account</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Display approved public verification indicators on your profile</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              WornVault does not collect or store passwords and does not gain posting access to connected accounts.
            </p>
          </section>
          
          {/* Section 6: Orders, Payments, and Payouts */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              6. Orders, Payments, and Payouts
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              All payments are processed through WornVault's platform using third-party payment providers.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              Buyers authorize payment at the time of purchase. Creators receive payouts according to WornVault's payout schedule once fulfillment requirements are met.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              WornVault may withhold or delay payouts in cases of suspected fraud, policy violations, disputes, or failure to comply with fulfillment requirements.
            </p>
          </section>
          
          {/* Section 7: Fulfillment and Shipping */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              7. Fulfillment and Shipping
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              WornVault coordinates fulfillment using a platform-controlled relay system.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              Creators agree to:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Use WornVault-provided packaging and shipping labels</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Ship items within required timelines</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Follow provided packing and shipping instructions</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              Items are shipped directly from creators to buyers using WornVault-issued labels. Personal addresses and contact details are not shared between parties.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              WornVault is not responsible for delays or failures caused by events outside its reasonable control.
            </p>
          </section>
          
          {/* Section 8: Returns, Disputes, and Chargebacks */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              8. Returns, Disputes, and Chargebacks
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              All disputes, delivery issues, and chargebacks are handled through WornVault.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              Buyers and creators agree not to initiate chargebacks or payment disputes outside the platform where possible and to cooperate with WornVault's resolution process.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              WornVault reserves the right to make final determinations regarding disputes, refunds, and payouts.
            </p>
          </section>
          
          {/* Section 9: Prohibited Conduct */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              9. Prohibited Conduct
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              You agree not to:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Violate any applicable laws or regulations</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Use the Services for fraudulent or deceptive purposes</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Attempt to bypass platform processes or fees</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Harass, threaten, or abuse other users</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Interfere with platform security or operations</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              Violation of these rules may result in suspension or termination of your account.
            </p>
          </section>
          
          {/* Section 10: Intellectual Property */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              10. Intellectual Property
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              All content, trademarks, and materials provided by WornVault are owned by or licensed to WornVault and may not be used without prior written permission.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              Users retain ownership of content they submit but grant WornVault a non-exclusive, worldwide license to use such content for operating and promoting the Services.
            </p>
          </section>
          
          {/* Section 11: Third-Party Services */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              11. Third-Party Services
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              The Services may integrate with third-party platforms, tools, or services. WornVault is not responsible for third-party content, services, or policies.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              Your use of third-party services is subject to their respective terms and policies.
            </p>
          </section>
          
          {/* Section 12: Disclaimer of Warranties */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              12. Disclaimer of Warranties
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              The Services are provided "as is" and "as available," without warranties of any kind, express or implied.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              WornVault does not guarantee uninterrupted service, error-free operation, or specific transaction outcomes.
            </p>
          </section>
          
          {/* Section 13: Limitation of Liability */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              13. Limitation of Liability
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              To the maximum extent permitted by law, WornVault shall not be liable for indirect, incidental, special, or consequential damages arising out of or related to your use of the Services.
            </p>
          </section>
          
          {/* Section 14: Indemnification */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              14. Indemnification
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              You agree to indemnify and hold harmless WornVault from any claims, damages, losses, or expenses arising from your use of the Services or violation of these Terms.
            </p>
          </section>
          
          {/* Section 15: Termination */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              15. Termination
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              WornVault may suspend or terminate your account at any time for violation of these Terms or applicable laws.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              You may terminate your account at any time by contacting us.
            </p>
          </section>
          
          {/* Section 16: Changes to These Terms */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              16. Changes to These Terms
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              We may update these Terms from time to time. Changes will be posted on this page with an updated effective date. Continued use of the Services constitutes acceptance of the revised Terms.
            </p>
          </section>
          
          {/* Section 17: Governing Law */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              17. Governing Law
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              These Terms are governed by and construed in accordance with the laws of the applicable jurisdiction, without regard to conflict of law principles.
            </p>
          </section>
          
          {/* Section 18: Contact Information */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              18. Contact Information
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              If you have questions about these Terms, please contact us at:
            </p>
            <div className="text-base text-gray-700 dark:text-gray-300 leading-relaxed space-y-2">
              <p>
                <strong className="font-semibold text-gray-900 dark:text-white">Email:</strong>{' '}
                <a 
                  href="mailto:contact@wornvault.com" 
                  className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 underline"
                >
                  contact@wornvault.com
                </a>
              </p>
              <p>
                <strong className="font-semibold text-gray-900 dark:text-white">Website:</strong>{' '}
                <a 
                  href="https://wornvault.com" 
                  className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  https://wornvault.com
                </a>
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/**
 * Error boundary for terms of service page
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
      route: 'terms-of-service',
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

/** @typedef {import('./+types/terms-of-service').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

