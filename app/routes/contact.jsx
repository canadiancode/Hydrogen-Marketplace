import {
  useRouteError,
  isRouteErrorResponse,
  useLoaderData,
  Form,
  useActionData,
  useNavigation,
  data,
} from 'react-router';
import {AnimatedBlobSection} from '~/components/AnimatedBlobSection';
import {Breadcrumbs} from '~/components/Breadcrumbs';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP, generateCSRFToken, validateCSRFToken} from '~/lib/auth-helpers';
import {validateEmail, sanitizeString} from '~/lib/validation';
import {ExclamationCircleIcon} from '@heroicons/react/16/solid';

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
 * Generate JSON-LD structured data for the contact page
 * @param {string} baseUrl - Base URL for the site
 */
function generateStructuredData(baseUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    headline: 'Contact & Support | WornVault',
    description: 'Have a question, need support, or want to get in touch? Contact WornVault for assistance with your account, orders, or general inquiries.',
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
      '@id': `${baseUrl}/contact`,
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
          route: 'contact',
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
      route: 'contact',
    });
    return null;
  }
}

/**
 * Cache headers for static content with security headers
 * Enhanced with Permissions-Policy for additional security
 * Note: Form pages should not be cached to ensure fresh CSRF tokens
 * @type {import('react-router').HeadersFunction}
 */
export const headers = ({actionHeaders}) => {
  const headers = new Headers(actionHeaders);
  
  // Don't cache form pages - we need fresh CSRF tokens
  // Only cache GET requests (not POST submissions)
  headers.set(
    'Cache-Control',
    'no-cache, no-store, must-revalidate, max-age=0'
  );
  
  // Security headers
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Enhanced security: Permissions-Policy (formerly Feature-Policy)
  // Restricts browser features that could be exploited
  headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), speaker=()'
  );
  
  return headers;
};

/**
 * @type {Route.MetaFunction}
 */
export const meta = ({request}) => {
  const baseUrl = getSafeBaseUrl(request);
  const canonicalUrl = `${baseUrl}/contact`;
  
  return [
    {title: 'Contact & Support | WornVault'},
    {
      name: 'description',
      content: 'Have a question, need support, or want to get in touch? Contact WornVault for assistance with your account, orders, or general inquiries.',
    },
    {rel: 'canonical', href: canonicalUrl},
    {property: 'og:title', content: 'Contact & Support | WornVault'},
    {
      property: 'og:description',
      content: 'Have a question, need support, or want to get in touch? Contact WornVault for assistance.',
    },
    {property: 'og:type', content: 'website'},
    {property: 'og:url', content: canonicalUrl},
  ];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({request, context}) {
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
    
    // Generate CSRF token for form protection
    // Use session secret if available, otherwise generate unsigned token
    const sessionSecret = context.env?.SESSION_SECRET || null;
    const csrfToken = await generateCSRFToken(request, sessionSecret);
    
    // Performance monitoring: Log slow requests
    const duration = Date.now() - startTime;
    if (duration > 100) {
      console.warn(`Slow loader: contact took ${duration}ms`);
    }
    
    return {
      baseUrl,
      structuredDataJson, // Pre-validated and stringified JSON
      csrfToken,
    };
  } catch (error) {
    // Log error for monitoring (sanitized)
    const errorInfo = {
      message: error instanceof Error ? error.message : 'Unknown error',
      route: 'contact',
      timestamp: new Date().toISOString(),
    };
    console.error('Loader error:', errorInfo);
    
    // Re-throw to trigger error boundary
    throw error;
  }
}

/**
 * @param {Route.ActionArgs}
 */
export async function action({request, context}) {
  // Only allow POST requests
  if (request.method !== 'POST') {
    return data({error: 'Method not allowed'}, {status: 405});
  }

  // Rate limiting: max 5 submissions per 15 minutes per IP
  // Stricter than other endpoints since this sends emails
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `contact-form:${clientIP}`, {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
  });

  if (!rateLimit.allowed) {
    return data(
      {
        success: false,
        error: 'Too many requests. Please wait before submitting another message.',
        fieldErrors: {},
      },
      {status: 429},
    );
  }

  try {
    const formData = await request.formData();

    // CSRF protection
    const sessionSecret = context.env?.SESSION_SECRET || null;
    const csrfToken = formData.get('csrf_token');
    if (!csrfToken) {
      return data(
        {
          success: false,
          error: 'Security token missing. Please refresh the page and try again.',
          fieldErrors: {},
        },
        {status: 400},
      );
    }

    // Validate CSRF token if session secret is available
    if (sessionSecret) {
      // Note: We'd need to store the token in session to validate it properly
      // For now, we'll validate the token format
      if (typeof csrfToken !== 'string' || csrfToken.length < 32) {
        return data(
          {
            success: false,
            error: 'Invalid security token. Please refresh the page and try again.',
            fieldErrors: {},
          },
          {status: 400},
        );
      }
    }

    // Input validation constants
    const MAX_NAME_LENGTH = 100;
    const MAX_EMAIL_LENGTH = 254; // RFC 5321 limit
    const MAX_BODY_LENGTH = 5000;

    // Extract and validate form fields
    const name = formData.get('name');
    const email = formData.get('email');
    const body = formData.get('body');

    const fieldErrors = {};

    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      fieldErrors.name = 'Name is required';
    } else if (name.length > MAX_NAME_LENGTH) {
      fieldErrors.name = `Name must be less than ${MAX_NAME_LENGTH} characters`;
    }

    // Validate email
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      fieldErrors.email = 'Email is required';
    } else if (!validateEmail(email)) {
      fieldErrors.email = 'Please enter a valid email address';
    } else if (email.length > MAX_EMAIL_LENGTH) {
      fieldErrors.email = 'Email address is too long';
    }

    // Validate body
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      fieldErrors.body = 'Message is required';
    } else if (body.length > MAX_BODY_LENGTH) {
      fieldErrors.body = `Message must be less than ${MAX_BODY_LENGTH} characters`;
    }

    // Return validation errors if any
    if (Object.keys(fieldErrors).length > 0) {
      return data(
        {
          success: false,
          error: 'Please correct the errors below',
          fieldErrors,
        },
        {status: 400},
      );
    }

    // Sanitize inputs
    const sanitizedName = sanitizeString(name, MAX_NAME_LENGTH)
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters

    const sanitizedEmail = sanitizeString(email, MAX_EMAIL_LENGTH)
      .toLowerCase()
      .trim();

    const sanitizedBody = sanitizeString(body, MAX_BODY_LENGTH)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, ''); // Remove event handlers

    // Additional security: Check for common spam patterns
    const spamPatterns = [
      /http[s]?:\/\//gi, // URLs (allow some, but log for review)
      /bit\.ly|tinyurl|goo\.gl/gi, // URL shorteners
    ];

    let spamScore = 0;
    for (const pattern of spamPatterns) {
      if (pattern.test(sanitizedBody)) {
        spamScore++;
      }
    }

    // Check email API key (supports Resend, SendGrid, or Mailgun)
    const emailApiKey = context.env?.RESEND_API_KEY || context.env?.SENDGRID_API_KEY || context.env?.MAILGUN_API_KEY;
    const emailService = context.env?.EMAIL_SERVICE || 'resend'; // 'resend', 'sendgrid', or 'mailgun'
    
    if (!emailApiKey) {
      console.error('Email API key is not configured. Set RESEND_API_KEY, SENDGRID_API_KEY, or MAILGUN_API_KEY');
      return data(
        {
          success: false,
          error: 'Email service is not configured. Please contact support directly.',
          fieldErrors: {},
        },
        {status: 500},
      );
    }

    // Get recipient email from environment or use a default
    const recipientEmail = context.env?.CONTACT_EMAIL || 'contact@wornvault.com';

    // Get sender email from environment
    // For Resend: must be a verified domain
    // For SendGrid/Mailgun: use your verified sender
    const senderEmail = context.env?.CONTACT_FROM_EMAIL || 'contact@wornvault.com';
    const senderName = context.env?.CONTACT_FROM_NAME || 'WornVault';

    // Prepare email content
    const emailSubject = `Contact Form Submission from ${sanitizedName}`;
    const timestamp = new Date().toISOString();
    const emailBody = `
New contact form submission:

Name: ${sanitizedName}
Email: ${sanitizedEmail}
IP Address: ${clientIP}
Timestamp: ${timestamp}
${spamScore > 0 ? `\n⚠️ Spam Score: ${spamScore} (flagged for review)\n` : ''}

Message:
${sanitizedBody}
    `.trim();

    // Escape HTML for safe rendering in email
    const escapeHtml = (text) => {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      };
      return text.replace(/[&<>"']/g, (m) => map[m]);
    };

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">New Contact Form Submission</h2>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Name:</strong> ${escapeHtml(sanitizedName)}</p>
          <p><strong>Email:</strong> <a href="mailto:${escapeHtml(sanitizedEmail)}">${escapeHtml(sanitizedEmail)}</a></p>
          <p><strong>IP Address:</strong> ${escapeHtml(clientIP)}</p>
          <p><strong>Timestamp:</strong> ${escapeHtml(timestamp)}</p>
          ${spamScore > 0 ? `<p style="color: #d32f2f;"><strong>⚠️ Spam Score:</strong> ${spamScore} (flagged for review)</p>` : ''}
        </div>
        <div style="margin: 20px 0;">
          <h3 style="color: #333;">Message:</h3>
          <div style="background: #fff; padding: 15px; border-left: 4px solid #9089fc; white-space: pre-wrap;">${escapeHtml(sanitizedBody).replace(/\n/g, '<br>')}</div>
        </div>
      </div>
    `;

    // Send email via API (using fetch - works in Cloudflare Workers)
    let emailResult;
    let emailError;

    // Log email service configuration for debugging (without exposing sensitive data)
    console.log('[Contact Form] Email service configuration:', {
      service: emailService,
      hasApiKey: !!emailApiKey,
      senderEmail,
      recipientEmail,
      apiKeyLength: emailApiKey?.length || 0,
    });

    try {
      if (emailService === 'resend') {
        // Resend API (recommended - works great with Cloudflare Workers)
        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${emailApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${senderName} <${senderEmail}>`,
            to: [recipientEmail],
            reply_to: sanitizedEmail,
            subject: emailSubject,
            text: emailBody,
            html: htmlContent,
          }),
        });

        // Safely parse JSON response - handle both success and error cases
        let resendData;
        try {
          const responseText = await resendResponse.text();
          resendData = responseText ? JSON.parse(responseText) : {};
        } catch (parseError) {
          // If JSON parsing fails, capture the raw response
          emailError = {
            service: 'resend',
            message: 'Failed to parse API response',
            status: resendResponse.status,
            statusText: resendResponse.statusText,
            parseError: parseError instanceof Error ? parseError.message : 'Unknown parse error',
          };
        }
        
        if (!emailError && !resendResponse.ok) {
          emailError = {
            service: 'resend',
            message: resendData.message || resendData.error?.message || 'Failed to send email',
            status: resendResponse.status,
            statusText: resendResponse.statusText,
            details: resendData,
          };
        } else if (!emailError) {
          emailResult = {success: true, id: resendData.id};
        }
      } else if (emailService === 'sendgrid') {
        // SendGrid API
        const sendgridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${emailApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{
              to: [{email: recipientEmail}],
              subject: emailSubject,
            }],
            from: {email: senderEmail, name: senderName},
            reply_to: {email: sanitizedEmail},
            content: [
              {type: 'text/plain', value: emailBody},
              {type: 'text/html', value: htmlContent},
            ],
          }),
        });

        if (!sendgridResponse.ok) {
          const errorText = await sendgridResponse.text();
          let errorDetails;
          try {
            errorDetails = JSON.parse(errorText);
          } catch {
            errorDetails = errorText.substring(0, 500);
          }
          
          emailError = {
            service: 'sendgrid',
            message: 'Failed to send email via SendGrid',
            status: sendgridResponse.status,
            statusText: sendgridResponse.statusText,
            details: errorDetails,
          };
        } else {
          emailResult = {success: true};
        }
      } else if (emailService === 'mailgun') {
        // Mailgun API
        const mailgunDomain = context.env?.MAILGUN_DOMAIN || 'wornvault.com';
        const mailgunUrl = `https://api.mailgun.net/v3/${mailgunDomain}/messages`;
        
        const formData = new FormData();
        formData.append('from', `${senderName} <${senderEmail}>`);
        formData.append('to', recipientEmail);
        formData.append('h:Reply-To', sanitizedEmail);
        formData.append('subject', emailSubject);
        formData.append('text', emailBody);
        formData.append('html', htmlContent);

        const mailgunResponse = await fetch(mailgunUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${btoa(`api:${emailApiKey}`)}`,
          },
          body: formData,
        });

        // Safely parse JSON response
        let mailgunData;
        try {
          const responseText = await mailgunResponse.text();
          mailgunData = responseText ? JSON.parse(responseText) : {};
        } catch (parseError) {
          emailError = {
            service: 'mailgun',
            message: 'Failed to parse API response',
            status: mailgunResponse.status,
            statusText: mailgunResponse.statusText,
            parseError: parseError instanceof Error ? parseError.message : 'Unknown parse error',
          };
        }
        
        if (!emailError && !mailgunResponse.ok) {
          emailError = {
            service: 'mailgun',
            message: mailgunData.message || 'Failed to send email',
            status: mailgunResponse.status,
            statusText: mailgunResponse.statusText,
            details: mailgunData,
          };
        } else if (!emailError) {
          emailResult = {success: true, id: mailgunData.id};
        }
      } else {
        throw new Error(`Unsupported email service: ${emailService}`);
      }
    } catch (fetchError) {
      console.error('Email API fetch error:', {
        error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
        errorName: fetchError instanceof Error ? fetchError.name : 'Error',
        service: emailService,
        route: 'contact',
        timestamp: new Date().toISOString(),
        ...(fetchError instanceof Error && fetchError.stack ? {stack: fetchError.stack} : {}),
      });
      emailError = {
        service: emailService,
        message: 'Network error while sending email',
        details: fetchError instanceof Error ? fetchError.message : 'Unknown error',
        errorType: fetchError instanceof Error ? fetchError.name : 'Unknown',
      };
    }

    if (emailError) {
      // Serialize error properly for logging - this ensures we see the full error details
      const errorLog = {
        service: emailError.service || emailService,
        message: emailError.message,
        status: emailError.status,
        statusText: emailError.statusText,
        details: emailError.details,
        parseError: emailError.parseError,
        route: 'contact',
        timestamp: new Date().toISOString(),
      };
      
      // Log full error details with proper serialization
      console.error('Email API error:', JSON.stringify(errorLog, null, 2));

      return data(
        {
          success: false,
          error: 'Failed to send message. Please try again later or contact us directly.',
          fieldErrors: {},
        },
        {status: 500},
      );
    }

    // Success - return success response
    return data(
      {
        success: true,
        message: 'Thank you for your message! We\'ll get back to you as soon as possible.',
        fieldErrors: {},
      },
      {status: 200},
    );
  } catch (error) {
    // Log error details server-side only
    const isProduction = context.env?.NODE_ENV === 'production';
    console.error('Contact form submission error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      errorName: error instanceof Error ? error.name : 'Error',
      timestamp: new Date().toISOString(),
      route: 'contact',
      ...(isProduction ? {} : {errorStack: error instanceof Error ? error.stack : undefined}),
    });

    // Return generic error to client (don't expose internal details)
    return data(
      {
        success: false,
        error: 'An error occurred while sending your message. Please try again later.',
        fieldErrors: {},
      },
      {status: 500},
    );
  }
}

export default function ContactPage() {
  const {baseUrl, structuredDataJson, csrfToken} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  
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
                Contact & Support
              </h1>
              <p className="mt-6 text-lg font-medium text-pretty text-gray-600 sm:text-xl/8 dark:text-gray-400">
                Have a question, need support, or want to get in touch?
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
                {name: 'Contact & Support', href: '/contact', current: true},
              ]}
            />
          </div>
          
          {/* Contact Information Section */}
          <section className="mb-12 pb-8">
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              Our team is here to help with account questions, orders, listings, or anything else related to WornVault.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              We review all inquiries and respond as quickly as possible during business hours.
            </p>
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed mb-8">
              Your message is handled privately and securely.
            </p>
          </section>

          {/* Contact Form */}
          <section className="mb-12">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 sm:p-8">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">
                Send us a message
              </h2>

              {/* Success Message */}
              {actionData?.success && (
                <div className="mb-6 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    {actionData.message}
                  </p>
                </div>
              )}

              {/* Error Message */}
              {actionData?.error && !actionData.success && (
                <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">
                    {actionData.error}
                  </p>
                </div>
              )}

              <Form method="POST" className="space-y-6">
                {/* CSRF Token */}
                <input type="hidden" name="csrf_token" value={csrfToken} />

                {/* Name Field */}
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm/6 font-medium text-gray-900 dark:text-white"
                  >
                    Name
                  </label>
                  <div className="mt-2">
                    <input
                      type="text"
                      id="name"
                      name="name"
                      required
                      minLength={1}
                      maxLength={100}
                      autoComplete="name"
                      className="block w-full rounded-md bg-white py-1.5 pl-3 pr-3 text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-gray-500/50 dark:placeholder:text-gray-400/70 dark:focus:outline-indigo-400"
                    />
                  </div>
                </div>

                {/* Email Field */}
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm/6 font-medium text-gray-900 dark:text-white"
                  >
                    Email
                  </label>
                  <div className="mt-2 grid grid-cols-1">
                    <input
                      type="email"
                      id="email"
                      name="email"
                      required
                      minLength={1}
                      maxLength={254}
                      autoComplete="email"
                      placeholder="you@example.com"
                      aria-invalid={actionData?.fieldErrors?.email ? 'true' : 'false'}
                      aria-describedby={actionData?.fieldErrors?.email ? 'email-error' : undefined}
                      className={`col-start-1 row-start-1 block w-full rounded-md bg-white py-1.5 pr-10 pl-3 outline-1 -outline-offset-1 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 sm:pr-9 sm:text-sm/6 dark:bg-white/5 dark:placeholder:text-gray-400/70 ${
                        actionData?.fieldErrors?.email
                          ? 'text-red-900 outline-red-300 focus:outline-red-600 dark:text-red-400 dark:outline-red-500/50 dark:focus:outline-red-400 dark:placeholder:text-red-400/70'
                          : 'text-gray-900 outline-gray-300 focus:outline-indigo-600 dark:text-white dark:outline-gray-500/50 dark:focus:outline-indigo-400'
                      }`}
                    />
                    {actionData?.fieldErrors?.email && (
                      <ExclamationCircleIcon
                        aria-hidden="true"
                        className="pointer-events-none col-start-1 row-start-1 mr-3 size-5 self-center justify-self-end text-red-500 sm:size-4 dark:text-red-400"
                      />
                    )}
                  </div>
                  {actionData?.fieldErrors?.email && (
                    <p
                      id="email-error"
                      className="mt-2 text-sm text-red-600 dark:text-red-400"
                    >
                      {actionData.fieldErrors.email}
                    </p>
                  )}
                </div>

                {/* Message Field */}
                <div>
                  <label
                    htmlFor="body"
                    className="block text-sm/6 font-medium text-gray-900 dark:text-white"
                  >
                    Message
                  </label>
                  <div className="mt-2 relative">
                    <textarea
                      id="body"
                      name="body"
                      required
                      minLength={1}
                      maxLength={5000}
                      rows={6}
                      aria-invalid={actionData?.fieldErrors?.body ? 'true' : 'false'}
                      aria-describedby={actionData?.fieldErrors?.body ? 'body-error' : undefined}
                      className={`block w-full rounded-md bg-white py-1.5 pr-10 pl-3 outline-1 -outline-offset-1 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 resize-y sm:pr-9 sm:text-sm/6 dark:bg-white/5 dark:placeholder:text-gray-400/70 ${
                        actionData?.fieldErrors?.body
                          ? 'text-red-900 outline-red-300 focus:outline-red-600 dark:text-red-400 dark:outline-red-500/50 dark:focus:outline-red-400 dark:placeholder:text-red-400/70'
                          : 'text-gray-900 outline-gray-300 focus:outline-indigo-600 dark:text-white dark:outline-gray-500/50 dark:focus:outline-indigo-400'
                      }`}
                    />
                    {actionData?.fieldErrors?.body && (
                      <ExclamationCircleIcon
                        aria-hidden="true"
                        className="pointer-events-none absolute right-3 top-3 size-5 text-red-500 sm:size-4 dark:text-red-400"
                      />
                    )}
                  </div>
                  {actionData?.fieldErrors?.body && (
                    <p
                      id="body-error"
                      className="mt-2 text-sm text-red-600 dark:text-red-400"
                    >
                      {actionData.fieldErrors.body}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Maximum 5,000 characters
                  </p>
                </div>

                {/* Submit Button */}
                <div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full sm:w-auto px-6 py-3 bg-indigo-600 text-white font-medium rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-indigo-500 dark:hover:bg-indigo-600"
                  >
                    {isSubmitting ? 'Sending...' : 'Send Message'}
                  </button>
                </div>
              </Form>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/**
 * Error boundary for contact page
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
      route: 'contact',
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

/** @typedef {import('./+types/contact').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

