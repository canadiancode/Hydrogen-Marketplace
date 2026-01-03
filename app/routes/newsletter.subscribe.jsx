import {data, useActionData, useNavigation, Form} from 'react-router';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';
import {validateEmail, sanitizeString} from '~/lib/validation';

/**
 * Headers function - prevent caching to ensure fresh form state
 * @type {import('react-router').HeadersFunction}
 */
export const headers = ({actionHeaders}) => {
  const headers = new Headers(actionHeaders);
  headers.set(
    'Cache-Control',
    'no-cache, no-store, must-revalidate, max-age=0'
  );
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return headers;
};

/**
 * Newsletter subscription action handler
 * Sends email notification using ReSend API (same as contact form)
 * @param {Route.ActionArgs}
 */
export async function action({request, context}) {
  // Only allow POST requests
  if (request.method !== 'POST') {
    return data({success: false, error: 'Method not allowed'}, {status: 405});
  }

  // Rate limiting: max 3 subscriptions per 15 minutes per IP
  // Stricter than contact form since newsletter subscriptions are simpler
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `newsletter:${clientIP}`, {
    maxRequests: 3,
    windowMs: 15 * 60 * 1000, // 15 minutes
  });

  if (!rateLimit.allowed) {
    return data(
      {
        success: false,
        error: 'Too many requests. Please wait before subscribing again.',
      },
      {status: 429},
    );
  }

  try {
    const formData = await request.formData();
    const email = formData.get('email');

    // Input validation
    const MAX_EMAIL_LENGTH = 254; // RFC 5321 limit

    // Validate email
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      return data(
        {
          success: false,
          error: 'Email is required',
        },
        {status: 400},
      );
    }

    if (!validateEmail(email)) {
      return data(
        {
          success: false,
          error: 'Please enter a valid email address',
        },
        {status: 400},
      );
    }

    if (email.length > MAX_EMAIL_LENGTH) {
      return data(
        {
          success: false,
          error: 'Email address is too long',
        },
        {status: 400},
      );
    }

    // Sanitize email
    const sanitizedEmail = sanitizeString(email, MAX_EMAIL_LENGTH)
      .toLowerCase()
      .trim();

    // Check email API key (supports Resend, SendGrid, or Mailgun)
    const emailApiKey = context.env?.RESEND_API_KEY || context.env?.SENDGRID_API_KEY || context.env?.MAILGUN_API_KEY;
    const emailService = context.env?.EMAIL_SERVICE || 'resend';

    if (!emailApiKey) {
      console.error('Email API key is not configured. Set RESEND_API_KEY, SENDGRID_API_KEY, or MAILGUN_API_KEY');
      return data(
        {
          success: false,
          error: 'Newsletter service is not configured. Please contact support.',
        },
        {status: 500},
      );
    }

    // Get recipient email from environment (same as contact form)
    const recipientEmail = context.env?.CONTACT_EMAIL || 'contact@wornvault.com';

    // Get sender email from environment
    const senderEmail = context.env?.CONTACT_FROM_EMAIL || 'contact@wornvault.com';
    const senderName = context.env?.CONTACT_FROM_NAME || 'WornVault';

    // Prepare email content
    const emailSubject = 'New Newsletter Subscription';
    const timestamp = new Date().toISOString();
    const emailBody = `
New newsletter subscription:

Email: ${sanitizedEmail}
IP Address: ${clientIP}
Timestamp: ${timestamp}
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
        <h2 style="color: #333;">New Newsletter Subscription</h2>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Email:</strong> <a href="mailto:${escapeHtml(sanitizedEmail)}">${escapeHtml(sanitizedEmail)}</a></p>
          <p><strong>IP Address:</strong> ${escapeHtml(clientIP)}</p>
          <p><strong>Timestamp:</strong> ${escapeHtml(timestamp)}</p>
        </div>
      </div>
    `;

    // Send email via API (using fetch - works in Cloudflare Workers)
    let emailResult;
    let emailError;

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

        const resendData = await resendResponse.json();

        if (!resendResponse.ok) {
          emailError = {
            message: resendData.message || 'Failed to send email',
            status: resendResponse.status,
          };
        } else {
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
          emailError = {
            message: 'Failed to send email via SendGrid',
            status: sendgridResponse.status,
            details: errorText,
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

        const mailgunData = await mailgunResponse.json();

        if (!mailgunResponse.ok) {
          emailError = {
            message: mailgunData.message || 'Failed to send email',
            status: mailgunResponse.status,
          };
        } else {
          emailResult = {success: true, id: mailgunData.id};
        }
      } else {
        throw new Error(`Unsupported email service: ${emailService}`);
      }
    } catch (fetchError) {
      console.error('Newsletter email API fetch error:', {
        error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
        route: 'newsletter.subscribe',
        timestamp: new Date().toISOString(),
      });
      emailError = {
        message: 'Network error while sending email',
        details: fetchError instanceof Error ? fetchError.message : 'Unknown error',
      };
    }

    if (emailError) {
      console.error('Newsletter email API error:', {
        error: emailError,
        route: 'newsletter.subscribe',
        timestamp: new Date().toISOString(),
      });

      return data(
        {
          success: false,
          error: 'Failed to subscribe. Please try again later.',
        },
        {status: 500},
      );
    }

    // Success - return success response
    return data(
      {
        success: true,
        message: 'Thank you for subscribing!',
      },
      {status: 200},
    );
  } catch (error) {
    // Log error details server-side only
    const isProduction = context.env?.NODE_ENV === 'production';
    console.error('Newsletter subscription error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      errorName: error instanceof Error ? error.name : 'Error',
      timestamp: new Date().toISOString(),
      route: 'newsletter.subscribe',
      ...(isProduction ? {} : {errorStack: error instanceof Error ? error.stack : undefined}),
    });

    // Return generic error to client (don't expose internal details)
    return data(
      {
        success: false,
        error: 'An error occurred while subscribing. Please try again later.',
      },
      {status: 500},
    );
  }
}

/**
 * Newsletter subscription component
 * This is a minimal component that handles form submission
 * The form is actually rendered in the Footer component
 */
export default function NewsletterSubscribe() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  // This component is mainly for handling the action
  // The form UI is in the Footer component
  return null;
}

/** @typedef {import('./+types/newsletter.subscribe').Route} Route */

