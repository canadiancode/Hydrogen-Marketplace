import {useRouteError, isRouteErrorResponse, useLoaderData} from 'react-router';
import {AnimatedBlobSection} from '~/components/AnimatedBlobSection';
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
 * Generate JSON-LD structured data for the privacy policy page
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
    headline: 'Privacy Policy | WornVault',
    description: 'WornVault Privacy Policy. Learn how we collect, use, and protect your personal information.',
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
      '@id': `${safeBaseUrl}/privacy-policy`,
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
          route: 'privacy-policy',
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
      route: 'general-privacy-policy',
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
  const canonicalUrl = `${baseUrl}/privacy-policy`;
  
  return [
    {title: 'Privacy Policy | WornVault'},
    {
      name: 'description',
      content: 'WornVault Privacy Policy. Learn how we collect, use, and protect your personal information.',
    },
    {rel: 'canonical', href: canonicalUrl},
    {property: 'og:title', content: 'Privacy Policy | WornVault'},
    {
      property: 'og:description',
      content: 'WornVault Privacy Policy. Learn how we collect, use, and protect your personal information.',
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
      console.warn(`Slow loader: privacy-policy took ${duration}ms`);
    }
    
    return {
      baseUrl,
      structuredDataJson, // Pre-validated and stringified JSON
    };
  } catch (error) {
    // Log error for monitoring (sanitized)
    const errorInfo = {
      message: error instanceof Error ? error.message : 'Unknown error',
      route: 'general-privacy-policy',
      timestamp: new Date().toISOString(),
    };
    console.error('Loader error:', errorInfo);
    
    // Re-throw to trigger error boundary
    throw error;
  }
}

export default function GeneralPrivacyPolicyPage() {
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
                Privacy Policy
              </h1>
              <p className="mt-6 text-lg font-medium text-pretty text-gray-600 sm:text-xl/8 dark:text-gray-400">
                How we collect, use, disclose, and safeguard your information
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
                {name: 'Privacy Policy', href: '/privacy-policy', current: true},
              ]}
            />
          </div>
          
          {/* Last Updated */}
          <div className="mb-8 pb-4 border-b border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          
          {/* Introduction Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              WornVault ("WornVault," "we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit or use our website, applications, and services (collectively, the "Services").
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              By accessing or using WornVault, you agree to the terms of this Privacy Policy.
            </p>
          </section>
          
          {/* Information We Collect Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Information We Collect
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              We may collect the following types of information:
            </p>
            
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Personal Information
              </h3>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
                Information that identifies you as an individual, such as:
              </p>
              <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Name</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Email address</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Account credentials</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Payment and payout information</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Shipping-related information (managed through platform-controlled processes)</span>
                </li>
              </ul>
            </div>
            
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Social Account Information
              </h3>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
                If you choose to connect a social media account for verification purposes, we may collect:
              </p>
              <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Public profile information</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Confirmation that you control the connected account</span>
                </li>
              </ul>
              <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                We do not collect or store social media passwords.
              </p>
            </div>
            
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Usage Information
              </h3>
              <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
                We may collect information about how you access and use the Services, including:
              </p>
              <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>IP address</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Device type</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Browser type</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Pages viewed</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-gray-900 dark:text-white">•</span>
                  <span>Dates and times of access</span>
                </li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                Cookies and Tracking Technologies
              </h3>
              <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                We may use cookies and similar technologies to improve functionality, analyze usage, and maintain security.
              </p>
            </div>
          </section>
          
          {/* How We Use Your Information Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              How We Use Your Information
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              We use collected information to:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Provide, operate, and maintain the Services</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Create and manage user accounts</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Facilitate transactions and fulfillment</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Verify identity and prevent fraud</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Communicate with users regarding accounts or transactions</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Improve platform performance and security</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Comply with legal obligations</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed font-semibold">
              We do not sell your personal information.
            </p>
          </section>
          
          {/* Social Login and OAuth Access Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Social Login and OAuth Access
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              WornVault may use OAuth-based authentication services (such as Google login) to allow users to securely sign in or connect accounts.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              When you use OAuth:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>We receive basic account information necessary for authentication</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>We do not receive or store passwords</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>We do not gain posting access to connected social accounts</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              OAuth data is used solely for authentication and verification purposes.
            </p>
          </section>
          
          {/* How We Share Information Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              How We Share Information
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              We may share information only in the following circumstances:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>With service providers who assist in operating the Services (e.g., payment processors, hosting providers)</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>To comply with legal requirements or lawful requests</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>To enforce our terms, policies, or protect the rights and safety of users or the platform</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed font-semibold">
              Personal contact information is never shared between buyers and creators.
            </p>
          </section>
          
          {/* Data Security Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Data Security
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              We implement reasonable administrative, technical, and physical safeguards to protect your information. While no system is completely secure, we strive to use commercially acceptable means to protect personal data.
            </p>
          </section>
          
          {/* Data Retention Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Data Retention
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              We retain personal information only as long as necessary to:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Provide the Services</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Fulfill legal and regulatory requirements</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Resolve disputes</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Enforce agreements</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              You may request deletion of your account or personal data, subject to legal and operational requirements.
            </p>
          </section>
          
          {/* Your Privacy Rights Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Your Privacy Rights
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">
              Depending on your location, you may have rights under applicable privacy laws, including:
            </p>
            <ul className="list-none pl-0 space-y-2 text-base text-gray-700 dark:text-gray-300 mb-4">
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Access to your personal data</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Correction of inaccurate data</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Deletion of personal data</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-gray-900 dark:text-white">•</span>
                <span>Restriction or objection to processing</span>
              </li>
            </ul>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              Requests can be made by contacting us using the information below.
            </p>
          </section>
          
          {/* Children's Privacy Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Children's Privacy
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              WornVault does not knowingly collect personal information from individuals under the age of 18. If we become aware that such information has been collected, we will take steps to delete it.
            </p>
          </section>
          
          {/* Third-Party Links Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Third-Party Links
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              Our Services may contain links to third-party websites. We are not responsible for the privacy practices or content of those third parties.
            </p>
          </section>
          
          {/* Changes to This Privacy Policy Section */}
          <section className="mb-12 pb-8 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Changes to This Privacy Policy
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated effective date.
            </p>
          </section>
          
          {/* Contact Us Section */}
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-0">
              Contact Us
            </h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
              If you have questions or concerns about this Privacy Policy or our data practices, you may contact us at:
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
 * Error boundary for privacy policy page
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
      route: 'general-privacy-policy',
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

/** @typedef {import('./+types/privacy-policy').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

