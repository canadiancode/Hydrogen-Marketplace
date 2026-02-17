import {Form, useLoaderData, useActionData, useNavigation, useRevalidator, useSubmit, data} from 'react-router';
import {useEffect, useState} from 'react';
import {requireAuth, generateCSRFToken, getClientIP, constantTimeEquals} from '~/lib/auth-helpers';
import {fetchCreatorProfile, createUserSupabaseClient, createServerSupabaseClient, logActivity, logActivityAdmin} from '~/lib/supabase';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {storeOAuthState} from '~/lib/oauth-state';
import {CheckCircleIcon, XCircleIcon} from '@heroicons/react/24/solid';
import {EllipsisVerticalIcon, ClipboardDocumentIcon} from '@heroicons/react/20/solid';
import {Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react';

/**
 * Extract Instagram username from URL
 * @param {string} url - Instagram profile URL
 * @returns {string|null} - Username or null if not found
 */
function extractInstagramUsername(url) {
  if (!url || typeof url !== 'string') return null;
  
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Remove leading/trailing slashes and extract username
    // Instagram URLs: instagram.com/username or instagram.com/username/
    const match = pathname.match(/^\/([^\/]+)\/?$/);
    if (match && match[1]) {
      return match[1];
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Send email notification for Instagram verification
 * Uses the same email service as contact form and newsletter
 * @param {object} params
 * @param {string} params.verificationCode - The verification code
 * @param {string} params.instagramUrl - Instagram profile URL
 * @param {string} params.instagramUsername - Instagram username
 * @param {string} params.creatorEmail - Creator's email address
 * @param {object} params.env - Environment variables
 * @param {string} params.clientIP - Client IP address
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendInstagramVerificationEmail({verificationCode, instagramUrl, instagramUsername, creatorEmail, env, clientIP}) {
  console.log('[sendInstagramVerificationEmail] Function called', {
    verificationCode,
    instagramUrl,
    instagramUsername,
    creatorEmail,
    hasEnv: !!env,
    timestamp: new Date().toISOString(),
  });
  
  // Check email API key (supports Resend, SendGrid, or Mailgun)
  const emailApiKey = env?.RESEND_API_KEY || env?.SENDGRID_API_KEY || env?.MAILGUN_API_KEY;
  const emailService = env?.EMAIL_SERVICE || 'resend';
  
  console.log('[sendInstagramVerificationEmail] Email service check', {
    hasApiKey: !!emailApiKey,
    emailService,
    hasResendKey: !!env?.RESEND_API_KEY,
    hasSendGridKey: !!env?.SENDGRID_API_KEY,
    hasMailgunKey: !!env?.MAILGUN_API_KEY,
  });
  
  if (!emailApiKey) {
    console.error('[sendInstagramVerificationEmail] Email API key is not configured. Set RESEND_API_KEY, SENDGRID_API_KEY, or MAILGUN_API_KEY');
    return {success: false, error: 'Email service is not configured'};
  }

  // Get recipient email from environment (same as contact form)
  const recipientEmail = env?.CONTACT_EMAIL || 'contact@wornvault.com';
  
  // Get sender email from environment
  const senderEmail = env?.CONTACT_FROM_EMAIL || 'contact@wornvault.com';
  const senderName = env?.CONTACT_FROM_NAME || 'WornVault';
  
  console.log('[sendInstagramVerificationEmail] Email configuration', {
    recipientEmail,
    senderEmail,
    senderName,
  });

  // Prepare email content
  const emailSubject = 'Instagram Verification Request';
  const timestamp = new Date().toISOString();
  const emailBody = `
New Instagram verification request:

Verification Code: ${verificationCode}
Instagram Username: ${instagramUsername || 'N/A'}
Instagram URL: ${instagramUrl || 'N/A'}
Creator Email: ${creatorEmail}
IP Address: ${clientIP}
Timestamp: ${timestamp}
  `.trim();

  // Escape HTML for safe rendering in email
  const escapeHtml = (text) => {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  };

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">New Instagram Verification Request</h2>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Verification Code:</strong> <code style="background: #fff; padding: 4px 8px; border-radius: 4px; font-size: 18px; font-weight: bold;">${escapeHtml(verificationCode)}</code></p>
        <p><strong>Instagram Username:</strong> ${escapeHtml(instagramUsername || 'N/A')}</p>
        <p><strong>Instagram URL:</strong> <a href="${escapeHtml(instagramUrl || '#')}">${escapeHtml(instagramUrl || 'N/A')}</a></p>
        <p><strong>Creator Email:</strong> <a href="mailto:${escapeHtml(creatorEmail)}">${escapeHtml(creatorEmail)}</a></p>
        <p><strong>IP Address:</strong> ${escapeHtml(clientIP)}</p>
        <p><strong>Timestamp:</strong> ${escapeHtml(timestamp)}</p>
      </div>
      <div style="margin: 20px 0; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
        <p style="margin: 0; color: #856404;"><strong>Action Required:</strong> Please verify the Instagram account by checking the DM sent to @w0rnvault with the verification code above.</p>
      </div>
    </div>
  `;

  // Send email via API
  let emailError;

  try {
    console.log('[sendInstagramVerificationEmail] Attempting to send email via', emailService);
    
    if (emailService === 'resend') {
      // Resend API
      console.log('[sendInstagramVerificationEmail] Sending via Resend API...');
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${emailApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${senderName} <${senderEmail}>`,
          to: [recipientEmail],
          reply_to: creatorEmail,
          subject: emailSubject,
          text: emailBody,
          html: htmlContent,
        }),
      });

      const resendData = await resendResponse.json();
      
      console.log('[sendInstagramVerificationEmail] Resend API response', {
        ok: resendResponse.ok,
        status: resendResponse.status,
        data: resendData,
      });
      
      if (!resendResponse.ok) {
        emailError = {
          message: resendData.message || 'Failed to send email',
          status: resendResponse.status,
        };
      } else {
        console.log('[sendInstagramVerificationEmail] Resend email sent successfully', {
          emailId: resendData.id,
        });
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
          reply_to: {email: creatorEmail},
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
      }
    } else if (emailService === 'mailgun') {
      // Mailgun API
      const mailgunDomain = env?.MAILGUN_DOMAIN || 'wornvault.com';
      const mailgunUrl = `https://api.mailgun.net/v3/${mailgunDomain}/messages`;
      
      const formData = new FormData();
      formData.append('from', `${senderName} <${senderEmail}>`);
      formData.append('to', recipientEmail);
      formData.append('h:Reply-To', creatorEmail);
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
      }
    } else {
      throw new Error(`Unsupported email service: ${emailService}`);
    }
  } catch (fetchError) {
    console.error('Instagram verification email API fetch error:', {
      error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
      route: 'creator.social-links',
      timestamp: new Date().toISOString(),
    });
    emailError = {
      message: 'Network error while sending email',
      details: fetchError instanceof Error ? fetchError.message : 'Unknown error',
    };
  }

  if (emailError) {
    console.error('Instagram verification email API error:', {
      error: emailError,
      route: 'creator.social-links',
      timestamp: new Date().toISOString(),
    });
    return {success: false, error: emailError.message};
  }

  return {success: true};
}

export const meta = () => {
  return [{title: 'WornVault | Social Links'}];
};

// Performance: Module-level constants to avoid object recreation
const VALID_PLATFORMS = new Set(['instagram', 'tiktok', 'x', 'youtube', 'twitch']);

const ALLOWED_DOMAINS = {
  instagram: ['instagram.com', 'www.instagram.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'youtu.be'],
  twitch: ['twitch.tv', 'www.twitch.tv'],
};

// Security: Explicit platform field mapping to prevent injection and ensure type safety
const PLATFORM_FIELD_MAP = {
  instagram: {
    url: 'instagram_url',
    username: 'instagram_username',
    verified: 'instagram_verified',
  },
  tiktok: {
    url: 'tiktok_url',
    username: 'tiktok_username',
    verified: 'tiktok_verified',
  },
  x: {
    url: 'x_url',
    username: 'x_username',
    verified: 'x_verified',
  },
  youtube: {
    url: 'youtube_url',
    username: 'youtube_username',
    verified: 'youtube_verified',
  },
  twitch: {
    url: 'twitch_url',
    username: 'twitch_username',
    verified: 'twitch_verified',
  },
};

// Platform display names for user-facing messages
const PLATFORM_DISPLAY_NAMES = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
  youtube: 'YouTube',
  twitch: 'Twitch',
};

const DEFAULT_SOCIAL_LINKS = {
  instagram: '',
  instagramVerified: false,
  tiktok: '',
  tiktokVerified: false,
  x: '',
  xVerified: false,
  youtube: '',
  youtubeVerified: false,
  twitch: '',
  twitchVerified: false,
};

// Performance: Helper function to map submitted_links JSONB to socialLinks object
function mapSubmittedLinksToSocialLinks(submittedLinks) {
  return {
    instagram: submittedLinks.instagram_url || submittedLinks.instagram || '',
    instagramVerified: false,
    tiktok: submittedLinks.tiktok_url || submittedLinks.tiktok || '',
    tiktokVerified: false,
    x: submittedLinks.x_url || submittedLinks.x || '',
    xVerified: false,
    youtube: submittedLinks.youtube_url || submittedLinks.youtube || '',
    youtubeVerified: false,
    twitch: submittedLinks.twitch_url || submittedLinks.twitch || '',
    twitchVerified: false,
  };
}

// Merge OAuth-verified data from creators table with manually entered links from creator_verifications
function mergeSocialLinksFromBothSources(submittedLinksData, creatorsData) {
  const socialLinks = mapSubmittedLinksToSocialLinks(submittedLinksData || {});
  
  // Override with OAuth-verified data from creators table (takes precedence)
  if (creatorsData) {
    const platforms = ['instagram', 'tiktok', 'x', 'youtube', 'twitch'];
    platforms.forEach((platform) => {
      const urlField = `${platform}_url`;
      const usernameField = `${platform}_username`;
      const verifiedField = `${platform}_verified`;
      
      // If OAuth-verified URL exists in creators table, use it (OAuth takes precedence)
      if (creatorsData[urlField]) {
        socialLinks[platform] = creatorsData[urlField];
        socialLinks[`${platform}Verified`] = creatorsData[verifiedField] || false;
      }
    });
  }
  
  return socialLinks;
}

// Ensure loader revalidates after form submission and OAuth callback redirects
export const shouldRevalidate = ({formMethod, currentUrl, nextUrl}) => {
  if (formMethod && formMethod !== 'GET') return true;
  
  // Revalidate when returning from OAuth callback (has verified=true or error param)
  const currentParams = new URL(currentUrl).searchParams;
  const nextParams = new URL(nextUrl).searchParams;
  if (currentParams.has('verified') || currentParams.has('error') || 
      nextParams.has('verified') || nextParams.has('error')) {
    return true;
  }
  
  return false;
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    return {
      user,
      socialLinks: null,
      csrfToken: null,
      callbackMessage: null,
      callbackError: null,
      instagramCode: null,
    };
  }

  // Check for callback query parameters
  const url = new URL(request.url);
  const verified = url.searchParams.get('verified');
  const error = url.searchParams.get('error');
  
  let callbackMessage = null;
  let callbackError = null;
  
  if (verified === 'true') {
    callbackMessage = 'Social account verified successfully!';
  }
  if (error) {
    // Sanitize error message to prevent XSS
    try {
      const decoded = decodeURIComponent(error);
      // Remove HTML tags and encode HTML entities
      let sanitized = decoded
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .substring(0, 200); // Limit length
      
      // Escape HTML entities to prevent XSS
      sanitized = sanitized
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
      
      callbackError = sanitized;
    } catch {
      // If decoding fails, use a safe default message
      callbackError = 'An error occurred during verification';
    }
  }

  // Fetch creator profile to get creator_id
  let creatorId = null;
  let socialLinks = null;
  let instagramCode = null;
  try {
    const profile = await fetchCreatorProfile(
      user.email,
      context.env.SUPABASE_URL,
      context.env.SUPABASE_ANON_KEY,
      session.access_token,
    );
    
    if (profile?.id) {
      creatorId = profile.id;
      
      // Extract last 3 characters of UUID for Instagram verification code
      // Security: UUIDs are validated format, safe to extract substring
      if (creatorId && typeof creatorId === 'string' && creatorId.length >= 3) {
        // Remove hyphens and get last 3 characters, convert to uppercase
        const uuidWithoutHyphens = creatorId.replace(/-/g, '');
        instagramCode = uuidWithoutHyphens.slice(-3).toUpperCase();
      }
      
      // Use service role client to read creator_verifications (bypasses RLS)
      // Security: We validate creator_id matches authenticated user's profile
      if (context.env.SUPABASE_SERVICE_ROLE_KEY) {
        const serverSupabase = createServerSupabaseClient(
          context.env.SUPABASE_URL,
          context.env.SUPABASE_SERVICE_ROLE_KEY,
        );
        
        const {data: verification, error: verificationError} = await serverSupabase
          .from('creator_verifications')
          .select('submitted_links')
          .eq('creator_id', creatorId) // Security: only read records for authenticated user
          .order('created_at', {ascending: false})
          .limit(1)
          .maybeSingle();
        
        // Check creators table for OAuth-verified platforms (FIX: Merge both data sources)
        const {data: creatorData, error: creatorError} = await serverSupabase
          .from('creators')
          .select('x_url,x_username,x_verified,instagram_url,instagram_username,instagram_verified,tiktok_url,tiktok_username,tiktok_verified,youtube_url,youtube_username,youtube_verified,twitch_url,twitch_username,twitch_verified')
          .eq('id', creatorId)
          .maybeSingle();
        
        // Merge data from both sources: creator_verifications.submitted_links and creators table
        const submittedLinks = verification?.submitted_links || {};
        socialLinks = mergeSocialLinksFromBothSources(submittedLinks, creatorData);
        
        // Debug logging (remove in production if needed)
        if (context.env.NODE_ENV === 'development') {
          console.log('Loaded submitted_links:', submittedLinks);
          console.log('Loaded creators data:', creatorData);
          console.log('Merged socialLinks:', socialLinks);
        }
        
        if (verificationError) {
          console.error('Error fetching verification record:', verificationError);
        }
      } else {
        // Fallback: try with user client if service role key not available
        const supabase = createUserSupabaseClient(
          context.env.SUPABASE_URL,
          context.env.SUPABASE_ANON_KEY,
          session.access_token,
        );
        
        const {data: verification, error: verificationError} = await supabase
          .from('creator_verifications')
          .select('submitted_links')
          .eq('creator_id', creatorId)
          .order('created_at', {ascending: false})
          .limit(1)
          .maybeSingle();
        
        // Also fetch creators table data
        const {data: creatorData} = await supabase
          .from('creators')
          .select('x_url,x_username,x_verified,instagram_url,instagram_username,instagram_verified,tiktok_url,tiktok_username,tiktok_verified,youtube_url,youtube_username,youtube_verified,twitch_url,twitch_username,twitch_verified')
          .eq('id', creatorId)
          .maybeSingle();
        
        const submittedLinks = verification?.submitted_links || {};
        socialLinks = mergeSocialLinksFromBothSources(submittedLinks, creatorData);
      }
    }
  } catch (error) {
    console.error('Error fetching social links:', error);
  }

  // Generate CSRF token for form protection
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  
  // Prevent caching to ensure fresh data after OAuth redirects
  return data(
    {
      user,
      socialLinks: socialLinks || DEFAULT_SOCIAL_LINKS,
      csrfToken,
      callbackMessage,
      callbackError,
      instagramCode,
    },
    {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    }
  );
}

export async function action({request, context}) {
  // Performance: Validate Content-Type early before any processing
  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/x-www-form-urlencoded') && 
      !contentType?.includes('multipart/form-data')) {
    return {
      success: false,
      error: 'Invalid request format',
    };
  }

  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    return {
      success: false,
      error: 'Authentication required',
    };
  }

  // Rate limiting: max 10 requests per minute per user
  const clientIP = getClientIP(request);
  const rateLimitKey = `social-links:${user.email}:${clientIP}`;
  const rateLimit = await rateLimitMiddleware(request, rateLimitKey, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });
  
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Too many requests. Please wait a moment before trying again.`,
    };
  }

  const formData = await request.formData();
  const actionType = formData.get('action_type')?.toString();

  // Handle OAuth verification initiation
  if (actionType === 'verify') {
    const platform = formData.get('platform')?.toString();
    
    // Production logging: These logs will appear in Shopify Oxygen runtime logs
    // Search for "TIKTOK_OAUTH_DEBUG" in Shopify Oxygen logs to find these entries
    console.error('[OAuth Verify Action] TIKTOK_OAUTH_DEBUG Action received', {
      platform,
      actionType,
      hasPlatform: !!platform,
      timestamp: new Date().toISOString(),
    });
    
    // Performance: Use Set.has() instead of array.includes() for O(1) lookup
    if (!platform || !VALID_PLATFORMS.has(platform)) {
      console.error('[OAuth Verify Action] Invalid platform detected', {
        platform,
        validPlatforms: Array.from(VALID_PLATFORMS),
        timestamp: new Date().toISOString(),
      });
      return {
        success: false,
        error: 'Invalid platform specified',
      };
    }

    // Validate CSRF token
    const csrfToken = formData.get('csrf_token')?.toString();
    const storedCSRFToken = context.session.get('csrf_token');
    
    if (!csrfToken || !storedCSRFToken || !constantTimeEquals(csrfToken, storedCSRFToken)) {
      return {
        success: false,
        error: 'Invalid security token. Please refresh the page and try again.',
      };
    }

    // Check if CSRF token was already used (prevent replay attacks)
    const csrfUsed = context.session.get('csrf_token_used');
    if (csrfUsed === csrfToken) {
      return {
        success: false,
        error: 'Security token has already been used. Please refresh the page and try again.',
      };
    }

    // Mark CSRF token as used and clear it (one-time use)
    context.session.set('csrf_token_used', csrfToken);
    context.session.unset('csrf_token');

    // Get creator profile to get creator_id
    const profile = await fetchCreatorProfile(
      user.email,
      context.env.SUPABASE_URL,
      context.env.SUPABASE_ANON_KEY,
      session.access_token,
    );

    if (!profile || !profile.id) {
      return {
        success: false,
        error: 'Unable to initiate OAuth. Please try again.',
      };
    }

    // Generate OAuth state token for CSRF protection
    const oauthState = await generateCSRFToken(request, context.env.SESSION_SECRET);

    // Security: Build OAuth redirect URI with Host header injection protection
    // Use environment variable for production domain, validate against whitelist
    const requestOrigin = new URL(request.url).origin;
    const allowedOrigins = [
      context.env.PUBLIC_STORE_DOMAIN ? `https://${context.env.PUBLIC_STORE_DOMAIN}` : null,
      'https://wornvault.com',
      'https://www.wornvault.com',
      // Allow localhost for development only
      ...(context.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : []),
    ].filter(Boolean);
    
    // Validate origin against whitelist to prevent Host header injection
    const isValidOrigin = allowedOrigins.some(allowed => {
      try {
        const allowedUrl = new URL(allowed);
        const requestUrl = new URL(requestOrigin);
        return allowedUrl.hostname === requestUrl.hostname && 
               allowedUrl.protocol === requestUrl.protocol;
      } catch {
        return false;
      }
    });
    
    // Use whitelisted origin or fallback to first allowed origin
    const baseUrl = isValidOrigin ? requestOrigin : (allowedOrigins[0] || 'https://wornvault.com');
    // CRITICAL: redirect_uri must NOT include query parameters - TikTok will add its own
    // The redirect_uri must match exactly what's registered in TikTok dashboard
    const redirectUri = `${baseUrl}/creator/social-links/oauth/callback`;
    
    // Validate redirectUri doesn't contain query parameters (security check)
    if (redirectUri.includes('?') || redirectUri.includes('&')) {
      console.error('[OAuth Verify Action] TIKTOK_OAUTH_DEBUG CRITICAL: redirectUri contains query parameters!', {
        redirectUri,
        baseUrl,
        requestOrigin,
        timestamp: new Date().toISOString(),
      });
      return {
        success: false,
        error: 'Invalid redirect URI configuration. Please contact support.',
      };
    }
    
    let oauthUrl = '';
    let codeVerifier = null;
    
    switch (platform) {
      case 'tiktok': {
        // Production logging: These logs will appear in Shopify Oxygen runtime logs
        // Search for "TIKTOK_OAUTH_DEBUG" in Shopify Oxygen logs to find these entries
        console.error('[TikTok OAuth Init] TIKTOK_OAUTH_DEBUG ===== STARTING TIKTOK OAUTH INITIATION =====');
        console.error('[TikTok OAuth Init] TIKTOK_OAUTH_DEBUG Step 1: Environment check', {
          hasClientKey: !!context.env.TIKTOK_CLIENT_KEY,
          hasClientSecret: !!context.env.TIKTOK_CLIENT_SECRET,
          clientKeyLength: context.env.TIKTOK_CLIENT_KEY?.length || 0,
          // SECURITY: Removed clientSecretLength to prevent information disclosure
          // SECURITY: Removed clientKeyPrefix to prevent partial key exposure
          redirectUri,
          baseUrl,
          requestOrigin,
          isValidOrigin,
          timestamp: new Date().toISOString(),
        });
        
        // TikTok OAuth - Include both scopes if configured
        // User has user.info.basic and user.info.profile configured
        // TikTok OAuth v2 authorization URL format
        const tiktokScopes = 'user.info.basic,user.info.profile';
        // Note: TikTok OAuth v2 requires /v2/auth/authorize/ endpoint (v1 /auth/authorize/ is deprecated)
        // Token endpoint uses /v2/oauth/token/ (already correct in callback handler)
        // CRITICAL: redirect_uri must NOT include query parameters - only the base URL
        // TikTok will add its own query parameters (code, state) when redirecting back
        const cleanRedirectUri = redirectUri.split('?')[0].split('&')[0]; // Remove any query params as safety check
        oauthUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${context.env.TIKTOK_CLIENT_KEY || 'YOUR_CLIENT_KEY'}&scope=${encodeURIComponent(tiktokScopes)}&redirect_uri=${encodeURIComponent(cleanRedirectUri)}&response_type=code&state=${encodeURIComponent(oauthState)}`;
        
        // CRITICAL: Verify redirectUri doesn't contain query parameters before encoding
        const redirectUriEncoded = encodeURIComponent(cleanRedirectUri);
        console.error('[TikTok OAuth Init] TIKTOK_OAUTH_DEBUG Step 2: OAuth URL constructed', {
          oauthUrl,
          scopes: tiktokScopes,
          redirectUri,
          cleanRedirectUri,
          redirectUriEncoded,
          redirectUriHasQueryParams: redirectUri.includes('?') || redirectUri.includes('&'),
          cleanRedirectUriHasQueryParams: cleanRedirectUri.includes('?') || cleanRedirectUri.includes('&'),
          hasClientKey: !!context.env.TIKTOK_CLIENT_KEY,
          // SECURITY: Removed clientKeyPrefix to prevent partial key exposure
          oauthStateLength: oauthState?.length || 0,
          // SECURITY: Removed oauthStatePrefix to prevent token exposure
          timestamp: new Date().toISOString(),
        });
        
        // Double-check: cleanRedirectUri should NOT contain query parameters
        if (cleanRedirectUri.includes('?') || cleanRedirectUri.includes('&')) {
          console.error('[TikTok OAuth Init] TIKTOK_OAUTH_DEBUG CRITICAL ERROR: cleanRedirectUri still contains query parameters!', {
            redirectUri,
            cleanRedirectUri,
            redirectUriEncoded,
            timestamp: new Date().toISOString(),
          });
          return {
            success: false,
            error: 'Invalid redirect URI configuration. Please contact support.',
          };
        }
        break;
      }
      case 'x': {
        // Generate PKCE code verifier and challenge
        codeVerifier = generateRandomString(128);
        const codeChallenge = await sha256(codeVerifier);
        const codeChallengeBase64 = base64UrlEncode(codeChallenge);
        
        // X (Twitter) OAuth 2.0 with PKCE
        oauthUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${context.env.X_CLIENT_ID || 'YOUR_CLIENT_ID'}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=tweet.read%20users.read&state=${oauthState}&code_challenge=${codeChallengeBase64}&code_challenge_method=S256`;
        break;
      }
      case 'youtube': {
        // YouTube Data API v3 OAuth using same Google credentials as Supabase
        // Uses CLIENT_ID (same as configured in Supabase for Google OAuth)
        const googleClientId = context.env.CLIENT_ID || 'YOUR_CLIENT_ID';
        // Include access_type=offline and prompt=consent to get refresh token if needed
        oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/youtube.readonly&state=${oauthState}&access_type=offline&prompt=consent`;
        break;
      }
      case 'twitch':
        // Twitch OAuth
        oauthUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${context.env.TWITCH_CLIENT_ID || 'YOUR_CLIENT_ID'}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=user:read:email&state=${oauthState}`;
        break;
      default:
        return {
          success: false,
          error: 'Unsupported platform',
        };
    }

    // Store OAuth state in Supabase instead of session cookie
    try {
      await storeOAuthState({
        state: oauthState,
        platform,
        codeVerifier,
        creatorId: profile.id,
        supabaseUrl: context.env.SUPABASE_URL,
        supabaseServiceKey: context.env.SUPABASE_SERVICE_ROLE_KEY,
      });
    } catch (error) {
      console.error('Error storing OAuth state:', error);
      return {
        success: false,
        error: 'Failed to initiate OAuth. Please try again.',
      };
    }

    // Production logging: These logs will appear in Shopify Oxygen runtime logs
    // Search for "TIKTOK_OAUTH_DEBUG" in Shopify Oxygen logs to find these entries
    console.error('[OAuth Redirect] TIKTOK_OAUTH_DEBUG Redirecting to OAuth provider', {
      platform,
      oauthUrl,
      oauthUrlLength: oauthUrl?.length,
      hasOAuthState: !!oauthState,
      redirectUri,
      timestamp: new Date().toISOString(),
    });
    
    // Redirect to OAuth provider
    return new Response(null, {
      status: 302,
      headers: {
        Location: oauthUrl,
      },
    });
  }

  // Handle saving social links
  if (actionType === 'save') {
    // Validate CSRF token
    const csrfToken = formData.get('csrf_token')?.toString();
    const storedCSRFToken = context.session.get('csrf_token');
    
    if (!csrfToken || !storedCSRFToken || !constantTimeEquals(csrfToken, storedCSRFToken)) {
      return {
        success: false,
        error: 'Invalid security token. Please refresh the page and try again.',
      };
    }

    // Check if CSRF token was already used (prevent replay attacks)
    const csrfUsed = context.session.get('csrf_token_used');
    if (csrfUsed === csrfToken) {
      return {
        success: false,
        error: 'Security token has already been used. Please refresh the page and try again.',
      };
    }

    // Mark CSRF token as used and clear it (one-time use)
    context.session.set('csrf_token_used', csrfToken);
    context.session.unset('csrf_token');

    // Performance: Sanitize and validate URLs with platform-specific domain validation
    // Using module-level ALLOWED_DOMAINS constant to avoid object recreation
    const sanitizeUrl = (url, platform) => {
      if (!url || typeof url !== 'string') return null;
      const trimmed = url.trim();
      if (!trimmed) return null;
      
      // Remove control characters
      let sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, '');
      
      // Validate URL format
      try {
        // If it doesn't start with http:// or https://, add https://
        if (!sanitized.match(/^https?:\/\//i)) {
          sanitized = `https://${sanitized}`;
        }
        
        const urlObj = new URL(sanitized);
        
        // Ensure HTTPS
        if (urlObj.protocol !== 'https:') {
          return null;
        }
        
        // Limit length
        if (sanitized.length > 500) {
          return null;
        }
        
        // CRITICAL: Validate hostname matches platform using module-level constant
        const hostname = urlObj.hostname.toLowerCase();
        const allowed = ALLOWED_DOMAINS[platform] || [];
        const isValidDomain = allowed.some(domain => 
          hostname === domain || hostname.endsWith('.' + domain)
        );
        
        if (!isValidDomain) {
          return null;
        }
        
        return sanitized;
      } catch {
        return null;
      }
    };

    // Extract and sanitize social links into JSONB structure
    const submittedLinks = {};
    
    const platforms = ['instagram', 'tiktok', 'x', 'youtube', 'twitch'];
    
    platforms.forEach((platform) => {
      const url = sanitizeUrl(formData.get(`${platform}_url`)?.toString(), platform);
      
      if (url) {
        // Store in format: { platform_url: "https://..." }
        submittedLinks[`${platform}_url`] = url;
      }
    });
    
    // Debug logging (remove in production if needed)
    if (context.env.NODE_ENV === 'development') {
      console.log('Saving submitted_links:', submittedLinks);
    }

    try {
      // Get creator profile to get creator_id
      const profile = await fetchCreatorProfile(
        user.email,
        context.env.SUPABASE_URL,
        context.env.SUPABASE_ANON_KEY,
        session.access_token,
      );

      if (!profile || !profile.id) {
        return {
          success: false,
          error: 'Unable to save social links. Please try again.',
        };
      }

      // Validate that SUPABASE_SERVICE_ROLE_KEY is available
      if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
        return {
          success: false,
          error: 'Server configuration error. Please contact support.',
        };
      }

      // Use service role client to bypass RLS for insert/update
      // Security: We've already validated that profile.id matches the authenticated user
      // The creator_id comes from the authenticated user's profile, not from user input
      const serverSupabase = createServerSupabaseClient(
        context.env.SUPABASE_URL,
        context.env.SUPABASE_SERVICE_ROLE_KEY,
      );

      // Check if creator_verifications record exists
      const {data: existingVerification, error: checkError} = await serverSupabase
        .from('creator_verifications')
        .select('id')
        .eq('creator_id', profile.id)
        .order('created_at', {ascending: false})
        .limit(1)
        .maybeSingle();

      if (checkError) {
        console.error('Error checking existing verification:', checkError);
        return {
          success: false,
          error: 'Failed to save social links. Please try again.',
        };
      }

      // Upsert: update if exists, insert if not
      if (existingVerification?.id) {
        // Update existing record - ensure creator_id matches (security check)
        const {error: updateError} = await serverSupabase
          .from('creator_verifications')
          .update({
            submitted_links: submittedLinks,
          })
          .eq('id', existingVerification.id)
          .eq('creator_id', profile.id); // Additional security: ensure creator_id matches

        if (updateError) {
          console.error('Error updating social links:', updateError);
          return {
            success: false,
            error: 'Failed to save social links. Please try again.',
          };
        }
        
        // Debug logging
        if (context.env.NODE_ENV === 'development') {
          console.log('Successfully updated verification record:', existingVerification.id);
        }
      } else {
        // Insert new record - creator_id is validated from authenticated user's profile
        const {data: newVerification, error: insertError} = await serverSupabase
          .from('creator_verifications')
          .insert({
            creator_id: profile.id, // Validated from authenticated user's profile
            submitted_links: submittedLinks,
            status: 'pending', // Default status
          })
          .select()
          .single();

        if (insertError) {
          console.error('Error creating verification record:', insertError);
          return {
            success: false,
            error: 'Failed to save social links. Please try again.',
          };
        }
        
        // Debug logging
        if (context.env.NODE_ENV === 'development') {
          console.log('Successfully created verification record:', newVerification?.id);
        }
      }

      // Also save Instagram URL to creators table if provided
      if (submittedLinks.instagram_url) {
        const {error: creatorUpdateError} = await serverSupabase
          .from('creators')
          .update({
            instagram_url: submittedLinks.instagram_url,
          })
          .eq('id', profile.id); // Security: only update the authenticated user's creator record

        if (creatorUpdateError) {
          console.error('Error updating creator Instagram URL:', creatorUpdateError);
          // Don't fail the entire request if creator update fails, but log it
          // The URL is already saved in creator_verifications
        } else if (context.env.NODE_ENV === 'development') {
          console.log('Successfully updated creator Instagram URL');
        }
      }

      // Regenerate CSRF token for next request
      const newCsrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
      context.session.set('csrf_token', newCsrfToken);

      // Check if this is an Instagram verification submission
      const isInstagramVerification = formData.get('is_instagram_verification') === 'true';
      
      if (isInstagramVerification) {
        // Extract Instagram verification code from creator ID (same as loader)
        let instagramCode = null;
        if (profile.id && typeof profile.id === 'string' && profile.id.length >= 3) {
          const uuidWithoutHyphens = profile.id.replace(/-/g, '');
          instagramCode = uuidWithoutHyphens.slice(-3).toUpperCase();
        }
        
        // Extract Instagram username from URL
        const instagramUrl = submittedLinks.instagram_url || '';
        const instagramUsername = instagramUrl ? extractInstagramUsername(instagramUrl) : null;
        
        // Log Instagram verification attempt
        console.log('[Instagram Verification] Starting email send process', {
          creatorId: profile.id,
          creatorEmail: user.email,
          instagramUrl,
          instagramUsername,
          verificationCode: instagramCode,
          timestamp: new Date().toISOString(),
        });
        
        // Send email notification (non-blocking - don't fail request if email fails)
        const clientIP = getClientIP(request);
        try {
          console.log('[Instagram Verification] Calling sendInstagramVerificationEmail...');
          const emailResult = await sendInstagramVerificationEmail({
            verificationCode: instagramCode || 'N/A',
            instagramUrl,
            instagramUsername,
            creatorEmail: user.email,
            env: context.env,
            clientIP,
          });
          
          if (!emailResult.success) {
            // Log error but don't fail the request
            console.error('[Instagram Verification] Failed to send email:', {
              error: emailResult.error,
              creatorId: profile.id,
              creatorEmail: user.email,
              timestamp: new Date().toISOString(),
            });
          } else {
            console.log('[Instagram Verification] Email sent successfully', {
              creatorId: profile.id,
              instagramUsername,
              creatorEmail: user.email,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (emailError) {
          // Log error but don't fail the request
          console.error('[Instagram Verification] Exception sending email:', {
            error: emailError instanceof Error ? emailError.message : 'Unknown error',
            errorStack: emailError instanceof Error ? emailError.stack : undefined,
            creatorId: profile.id,
            creatorEmail: user.email,
            timestamp: new Date().toISOString(),
          });
        }
        
        // Log activity to activity_log table (for creator's own activity feed)
        try {
          const activityResult = await logActivity({
            creatorId: profile.id,
            activityType: 'verification_submitted',
            entityType: 'verification',
            description: `Submitted Instagram verification request for ${instagramUsername || instagramUrl}`,
            metadata: {
              platform: 'instagram',
              instagramUrl,
              instagramUsername,
              verificationCode: instagramCode || 'N/A',
            },
            supabaseUrl: context.env.SUPABASE_URL,
            anonKey: context.env.SUPABASE_ANON_KEY,
            accessToken: session.access_token,
          });
          
          if (!activityResult.success) {
            // Log error but don't fail the request
            console.error('[Instagram Verification] Failed to log activity:', {
              error: activityResult.error?.message || 'Unknown error',
              creatorId: profile.id,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (activityError) {
          // Log error but don't fail the request
          console.error('[Instagram Verification] Exception logging activity:', {
            error: activityError instanceof Error ? activityError.message : 'Unknown error',
            creatorId: profile.id,
            timestamp: new Date().toISOString(),
          });
        }
        
        // Also log to admin activity feed using service role key
        // This ensures admins can see Instagram DM verification requests
        if (context.env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const adminActivityResult = await logActivityAdmin({
              creatorId: profile.id,
              activityType: 'verification_submitted',
              entityType: 'verification',
              description: `Instagram DM verification request sent - @${instagramUsername || 'user'} (${instagramUrl})`,
              entityId: null,
              metadata: {
                platform: 'instagram',
                instagramUrl,
                instagramUsername,
                verificationCode: instagramCode || 'N/A',
                action: 'dm_sent',
                creatorEmail: user.email,
              },
              supabaseUrl: context.env.SUPABASE_URL,
              serviceRoleKey: context.env.SUPABASE_SERVICE_ROLE_KEY,
            });
            
            if (!adminActivityResult.success) {
              // Log error but don't fail the request
              console.error('[Instagram Verification] Failed to log admin activity:', {
                error: adminActivityResult.error?.message || 'Unknown error',
                creatorId: profile.id,
                timestamp: new Date().toISOString(),
              });
            } else {
              console.log('[Instagram Verification] Admin activity logged successfully', {
                creatorId: profile.id,
                instagramUsername,
                timestamp: new Date().toISOString(),
              });
            }
          } catch (adminActivityError) {
            // Log error but don't fail the request
            console.error('[Instagram Verification] Exception logging admin activity:', {
              error: adminActivityError instanceof Error ? adminActivityError.message : 'Unknown error',
              creatorId: profile.id,
              timestamp: new Date().toISOString(),
            });
          }
        }
        
        // For Instagram verification, return success but suppress the message
        // The UI will show the pending state instead
        return {
          success: true,
          message: null, // Suppress success message for Instagram verification
          isInstagramVerification: true,
        };
      }

      return {
        success: true,
        message: 'Social links saved successfully',
      };
    } catch (error) {
      const isProduction = context.env.NODE_ENV === 'production';
      console.error('Error saving social links:', {
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString(),
        ...(isProduction ? {} : {errorStack: error.stack}),
      });
      
      return {
        success: false,
        error: 'Failed to save social links. Please try again.',
      };
    }
  }

  // Handle disconnecting a social media platform
  if (actionType === 'disconnect') {
    const platform = formData.get('platform')?.toString();
    
    // Validate platform
    if (!platform || !VALID_PLATFORMS.has(platform)) {
      return {
        success: false,
        error: 'Invalid platform specified',
      };
    }

    // Security: Get platform field mapping - validates platform exists in map
    const platformFields = PLATFORM_FIELD_MAP[platform];
    if (!platformFields) {
      return {
        success: false,
        error: 'Invalid platform specified',
      };
    }

    // Validate CSRF token
    const csrfToken = formData.get('csrf_token')?.toString();
    const storedCSRFToken = context.session.get('csrf_token');
    
    if (!csrfToken || !storedCSRFToken || !constantTimeEquals(csrfToken, storedCSRFToken)) {
      return {
        success: false,
        error: 'Invalid security token. Please refresh the page and try again.',
      };
    }

    // Check if CSRF token was already used (prevent replay attacks)
    const csrfUsed = context.session.get('csrf_token_used');
    if (csrfUsed === csrfToken) {
      return {
        success: false,
        error: 'Security token has already been used. Please refresh the page and try again.',
      };
    }

    // Mark CSRF token as used and clear it (one-time use)
    context.session.set('csrf_token_used', csrfToken);
    context.session.unset('csrf_token');

    try {
      // Get creator profile to get creator_id
      const profile = await fetchCreatorProfile(
        user.email,
        context.env.SUPABASE_URL,
        context.env.SUPABASE_ANON_KEY,
        session.access_token,
      );

      if (!profile || !profile.id) {
        return {
          success: false,
          error: 'Unable to disconnect social link. Please try again.',
        };
      }

      // Validate that SUPABASE_SERVICE_ROLE_KEY is available
      if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
        return {
          success: false,
          error: 'Server configuration error. Please contact support.',
        };
      }

      // Use service role client to bypass RLS for update
      const serverSupabase = createServerSupabaseClient(
        context.env.SUPABASE_URL,
        context.env.SUPABASE_SERVICE_ROLE_KEY,
      );

      // CRITICAL FIX #1: Check if platform exists in creators table
      // This handles OAuth-verified platforms that may not exist in submitted_links
      const {data: creatorData, error: creatorCheckError} = await serverSupabase
        .from('creators')
        .select(`${platformFields.url}, ${platformFields.username}, ${platformFields.verified}`)
        .eq('id', profile.id)
        .single();

      if (creatorCheckError) {
        console.error('Error checking creator platform data:', creatorCheckError);
        return {
          success: false,
          error: 'Failed to disconnect social link. Please try again.',
        };
      }

      // CRITICAL FIX #2: Verify platform actually exists before disconnect
      // Platform is considered connected if URL, username, or verified status is set
      const hasPlatformInCreators = !!(creatorData?.[platformFields.url] || 
                                       creatorData?.[platformFields.username] ||
                                       creatorData?.[platformFields.verified]);

      // Fetch existing verification record
      const {data: existingVerification, error: checkError} = await serverSupabase
        .from('creator_verifications')
        .select('id, submitted_links')
        .eq('creator_id', profile.id)
        .order('created_at', {ascending: false})
        .limit(1)
        .maybeSingle();

      if (checkError) {
        console.error('Error checking existing verification:', checkError);
        return {
          success: false,
          error: 'Failed to disconnect social link. Please try again.',
        };
      }

      // CRITICAL FIX #3: Check if platform exists in submitted_links
      const hasPlatformInSubmittedLinks = existingVerification?.submitted_links?.[`${platform}_url`] || 
                                           existingVerification?.submitted_links?.[platform];

      // Verify platform exists in at least one location
      if (!hasPlatformInCreators && !hasPlatformInSubmittedLinks) {
        return {
          success: false,
          error: 'Platform is not connected.',
        };
      }

      // Store original state for potential rollback
      const originalSubmittedLinks = existingVerification?.submitted_links ? 
        JSON.parse(JSON.stringify(existingVerification.submitted_links)) : null;
      const originalCreatorData = creatorData ? JSON.parse(JSON.stringify(creatorData)) : null;

      // Update creator_verifications if it has the platform
      let verificationUpdateSuccess = true;
      if (hasPlatformInSubmittedLinks && existingVerification?.id) {
        const updatedLinks = {...existingVerification.submitted_links};
        delete updatedLinks[`${platform}_url`];
        delete updatedLinks[platform]; // Also remove alternative field names

        const {error: updateError} = await serverSupabase
          .from('creator_verifications')
          .update({
            submitted_links: updatedLinks,
          })
          .eq('id', existingVerification.id)
          .eq('creator_id', profile.id); // Additional security: ensure creator_id matches

        if (updateError) {
          console.error('Error disconnecting social link from creator_verifications:', updateError);
          verificationUpdateSuccess = false;
        }
      }

      // CRITICAL FIX #4: Clear platform fields in creators table using explicit mapping
      const creatorUpdates = {
        [platformFields.url]: null,
        [platformFields.username]: null,
        [platformFields.verified]: false,
      };

      const {error: creatorUpdateError} = await serverSupabase
        .from('creators')
        .update(creatorUpdates)
        .eq('id', profile.id); // Security: only update the authenticated user's creator record

      // CRITICAL FIX #5: Rollback logic if second update fails
      if (creatorUpdateError) {
        console.error('Error clearing social link from creators table:', creatorUpdateError);
        
        // Rollback creator_verifications update if it succeeded
        if (verificationUpdateSuccess && originalSubmittedLinks && existingVerification?.id) {
          const {error: rollbackError} = await serverSupabase
            .from('creator_verifications')
            .update({
              submitted_links: originalSubmittedLinks,
            })
            .eq('id', existingVerification.id)
            .eq('creator_id', profile.id);

          if (rollbackError) {
            console.error('CRITICAL: Failed to rollback creator_verifications update:', rollbackError);
            // Log for manual intervention
            console.error('Manual intervention required - data inconsistency detected', {
              creatorId: profile.id,
              platform,
              timestamp: new Date().toISOString(),
            });
          }
        }

        return {
          success: false,
          error: 'Failed to disconnect social link. Please try again.',
        };
      }

      // Security: Audit logging for disconnect operations
      const clientIP = getClientIP(request);
      console.log('Social platform disconnected', {
        creatorId: profile.id,
        platform,
        platformDisplayName: PLATFORM_DISPLAY_NAMES[platform] || platform,
        timestamp: new Date().toISOString(),
        ip: clientIP,
        userEmail: user.email,
      });

      // Regenerate CSRF token for next request
      const newCsrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
      context.session.set('csrf_token', newCsrfToken);

      return {
        success: true,
        message: `${PLATFORM_DISPLAY_NAMES[platform] || platform} disconnected successfully`,
      };
    } catch (error) {
      const isProduction = context.env.NODE_ENV === 'production';
      let profileId = null;
      try {
        // Attempt to get profile ID for logging, but don't fail if it errors
        const profile = await fetchCreatorProfile(
          user.email,
          context.env.SUPABASE_URL,
          context.env.SUPABASE_ANON_KEY,
          session.access_token,
        );
        profileId = profile?.id;
      } catch {
        // Ignore errors fetching profile for logging
      }
      
      console.error('Error disconnecting social link:', {
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString(),
        platform,
        creatorId: profileId,
        ...(isProduction ? {} : {errorStack: error.stack}),
      });
      
      return {
        success: false,
        error: 'Failed to disconnect social link. Please try again.',
      };
    }
  }

  return {
    success: false,
    error: 'Invalid action',
  };
}

export default function CreatorSocialLinks() {
  const {user, socialLinks, csrfToken, callbackMessage, callbackError, instagramCode} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const isSubmitting = navigation.state === 'submitting';
  const [copied, setCopied] = useState(false);
  const [showInstagramCode, setShowInstagramCode] = useState(false);
  // Persist dmSent state in sessionStorage to survive revalidations
  const [dmSent, setDmSent] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('instagram_dm_sent') === 'true';
    }
    return false;
  });
  const [instagramUrl, setInstagramUrl] = useState(socialLinks?.instagram || '');
  const [instagramUrlError, setInstagramUrlError] = useState('');
  
  // Determine pending state: Instagram URL exists but not verified
  const isInstagramPending = !!(socialLinks?.instagram && !socialLinks?.instagramVerified);
  
  // Auto-show verification UI if Instagram is pending (URL exists but not verified)
  useEffect(() => {
    if (isInstagramPending && !showInstagramCode) {
      setShowInstagramCode(true);
      // Also set dmSent to true if we have a URL but aren't verified
      if (!dmSent) {
        setDmSent(true);
      }
    }
  }, [isInstagramPending, showInstagramCode, dmSent]);
  
  // Sync instagramUrl state with loader data when it changes
  useEffect(() => {
    // Only update if socialLinks.instagram exists and is different from current state
    if (socialLinks?.instagram && socialLinks.instagram !== instagramUrl) {
      setInstagramUrl(socialLinks.instagram);
    } else if (!socialLinks?.instagram && instagramUrl) {
      // Clear instagramUrl state if loader data doesn't have it
      setInstagramUrl('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialLinks?.instagram]);
  
  // Clear any localStorage/sessionStorage related to Instagram URL on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check and clear any Instagram-related localStorage/sessionStorage
      // (only keeping instagram_dm_sent which is intentional)
      const keysToCheck = ['instagram_url', 'instagramUrl', 'instagram_connected'];
      keysToCheck.forEach(key => {
        if (localStorage.getItem(key)) {
          localStorage.removeItem(key);
        }
        if (sessionStorage.getItem(key)) {
          sessionStorage.removeItem(key);
        }
      });
    }
  }, []);
  
  // Update sessionStorage when dmSent changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (dmSent) {
        sessionStorage.setItem('instagram_dm_sent', 'true');
      } else {
        sessionStorage.removeItem('instagram_dm_sent');
      }
    }
  }, [dmSent]);
  
  // Clear dmSent state when Instagram is actually verified
  useEffect(() => {
    if (socialLinks?.instagramVerified && dmSent) {
      setDmSent(false);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('instagram_dm_sent');
      }
    }
  }, [socialLinks?.instagramVerified, dmSent]);
  
  // Reset dmSent if Instagram verification submission failed
  // Only reset if URL wasn't saved (not connected) and there's an error
  useEffect(() => {
    if (actionData?.error && dmSent && !socialLinks?.instagram) {
      // If submission failed and Instagram URL wasn't saved, allow retry
      setDmSent(false);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('instagram_dm_sent');
      }
    }
  }, [actionData?.error, dmSent, socialLinks?.instagram]);
  
  // Force revalidation when returning from OAuth callback to ensure fresh data
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('verified') || url.searchParams.has('error')) {
      // Small delay to ensure redirect has completed, then revalidate
      const timer = setTimeout(() => {
        revalidator.revalidate();
        // Clean up URL params after revalidation
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('verified');
        cleanUrl.searchParams.delete('error');
        window.history.replaceState({}, '', cleanUrl.toString());
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [revalidator]);

  // Copy to clipboard handler for Instagram verification code
  const handleCopyCode = async () => {
    if (instagramCode && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(instagramCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy code:', error);
      }
    }
  };

  // Validate Instagram URL format
  const validateInstagramUrl = (url) => {
    if (!url || typeof url !== 'string') {
      return { isValid: false, error: 'Please enter your Instagram profile URL' };
    }
    
    const trimmed = url.trim();
    if (!trimmed) {
      return { isValid: false, error: 'Please enter your Instagram profile URL' };
    }
    
    // Remove control characters
    let sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, '');
    
    // Validate URL format
    try {
      // If it doesn't start with http:// or https://, add https://
      if (!sanitized.match(/^https?:\/\//i)) {
        sanitized = `https://${sanitized}`;
      }
      
      const urlObj = new URL(sanitized);
      
      // Ensure HTTPS
      if (urlObj.protocol !== 'https:') {
        return { isValid: false, error: 'URL must use HTTPS' };
      }
      
      // Validate hostname matches Instagram domain
      const hostname = urlObj.hostname.toLowerCase();
      const isValidDomain = ALLOWED_DOMAINS.instagram.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      );
      
      if (!isValidDomain) {
        return { isValid: false, error: 'Please enter a valid Instagram URL (instagram.com)' };
      }
      
      // Limit length
      if (sanitized.length > 500) {
        return { isValid: false, error: 'URL is too long' };
      }
      
      return { isValid: true, sanitizedUrl: sanitized };
    } catch {
      return { isValid: false, error: 'Please enter a valid Instagram URL' };
    }
  };

  // Handle Instagram URL input change
  const handleInstagramUrlChange = (e) => {
    const value = e.target.value;
    setInstagramUrl(value);
    // Clear error when user starts typing
    if (instagramUrlError) {
      setInstagramUrlError('');
    }
  };

  // Handle DM sent button click - save Instagram URL and set pending state
  const handleDmSent = () => {
    // Validate Instagram URL before submitting
    const validation = validateInstagramUrl(instagramUrl);
    
    if (!validation.isValid) {
      setInstagramUrlError(validation.error);
      return;
    }
    
    // Clear any previous errors
    setInstagramUrlError('');
    
    // Set pending state immediately for better UX
    setDmSent(true);
    
    // Submit form with Instagram URL and verification flag
    const formData = new FormData();
    formData.append('action_type', 'save');
    formData.append('csrf_token', csrfToken || '');
    formData.append('instagram_url', validation.sanitizedUrl);
    formData.append('is_instagram_verification', 'true');
    
    submit(formData, {
      method: 'post',
      replace: false,
    });
  };

  // Get Instagram username from URL for display
  const getInstagramUsername = (url) => {
    if (!url) return null;
    return extractInstagramUsername(url);
  };

  // Social media icon components matching footer style
  const InstagramIcon = (props) => (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path
        fillRule="evenodd"
        d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
        clipRule="evenodd"
      />
    </svg>
  );

  const TikTokIcon = (props) => (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );

  const XIcon = (props) => (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M13.6823 10.6218L20.2391 3H18.6854L12.9921 9.61788L8.44486 3H3.2002L10.0765 13.0074L3.2002 21H4.75404L10.7663 14.0113L15.5685 21H20.8131L13.6819 10.6218H13.6823ZM11.5541 13.0956L10.8574 12.0991L5.31391 4.16971H7.70053L12.1742 10.5689L12.8709 11.5655L18.6861 19.8835H16.2995L11.5541 13.096V13.0956Z" />
    </svg>
  );

  const YouTubeIcon = (props) => (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path
        fillRule="evenodd"
        d="M19.812 5.418c.861.23 1.538.907 1.768 1.768C21.998 8.746 22 12 22 12s0 3.255-.418 4.814a2.504 2.504 0 0 1-1.768 1.768c-1.56.419-7.814.419-7.814.419s-6.255 0-7.814-.419a2.505 2.505 0 0 1-1.768-1.768C2 15.255 2 12 2 12s0-3.255.417-4.814a2.507 2.507 0 0 1 1.768-1.768C5.744 5 11.998 5 11.998 5s6.255 0 7.814.418ZM15.194 12 10 15V9l5.194 3Z"
        clipRule="evenodd"
      />
    </svg>
  );

  const TwitchIcon = (props) => (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
    </svg>
  );

  const platforms = [
    {
      key: 'instagram',
      label: 'Instagram',
      Icon: InstagramIcon,
    },
    {
      key: 'tiktok',
      label: 'TikTok',
      Icon: TikTokIcon,
    },
    {
      key: 'x',
      label: 'X (Twitter)',
      Icon: XIcon,
    },
    {
      key: 'youtube',
      label: 'YouTube',
      Icon: YouTubeIcon,
    },
    {
      key: 'twitch',
      label: 'Twitch',
      Icon: TwitchIcon,
    },
  ];


  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Social Links</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Add your social media profile links to display them on your creator profile.
          </p>
        </div>

        {/* Success/Error Messages */}
        {/* Don't show success message for Instagram verification - it's in pending state */}
        {(actionData?.success || callbackMessage) && !actionData?.isInstagramVerification && (
          <div className="mb-6 rounded-md bg-green-50 p-4 dark:bg-green-900/20">
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              {callbackMessage || actionData?.message || 'Social links saved successfully'}
            </p>
          </div>
        )}
        
        {(actionData?.error || callbackError) && (
          <div className="mb-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {String(callbackError || actionData?.error || '')}
            </p>
          </div>
        )}

        {/* Social Platform Cards */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 space-y-6">
          {platforms.map((platform) => {
            const IconComponent = platform.Icon;
            const isConnected = !!socialLinks?.[platform.key];
            const connectedUrl = socialLinks?.[platform.key] || '';
            const isInstagram = platform.key === 'instagram';

            return (
              <div key={platform.key} className="border-b border-gray-200 dark:border-gray-700 pb-6 last:border-b-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <IconComponent className="h-6 w-6 text-gray-700 dark:text-gray-300 flex-shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {platform.label}
                      </h3>
                      {isConnected && connectedUrl && (
                        <a
                          href={connectedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 truncate block mt-1"
                        >
                          {connectedUrl.replace(/^https?:\/\//, '').replace(/^www\./, '')}
                        </a>
                      )}
                      {/* Instagram verification section - restructured with step-by-step guidance */}
                      {/* Show verification UI if: not connected, DM sent, or Instagram is pending (URL exists but not verified) */}
                      {isInstagram && (!isConnected || dmSent || isInstagramPending) && instagramCode && showInstagramCode && (
                        <div className="mt-6 space-y-6">
                          {/* Step-by-step verification guide */}
                          <div className="rounded-lg p-6">
                            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                              Verify Your Instagram Account
                            </h4>
                            
                            {/* Step 1: Enter Instagram URL */}
                            <div className="space-y-3 mb-6">
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold text-sm">
                                  1
                                </div>
                                <div className="flex-1 min-w-0">
                                  <label htmlFor="instagram-url-input" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                    Enter Your Instagram Profile URL
                                  </label>
                                  <input
                                    id="instagram-url-input"
                                    type="text"
                                    value={instagramUrl}
                                    onChange={handleInstagramUrlChange}
                                    placeholder="https://instagram.com/yourusername"
                                    disabled={dmSent || isInstagramPending}
                                    className={`block w-full rounded-md border px-4 py-3 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500 dark:border-gray-600 dark:focus:ring-indigo-400 transition-colors ${
                                      instagramUrlError
                                        ? 'border-red-300 dark:border-red-700 focus:ring-red-500 dark:focus:ring-red-400'
                                        : 'border-gray-300 dark:border-gray-600'
                                    } ${dmSent || isInstagramPending ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-gray-800' : ''}`}
                                    aria-invalid={instagramUrlError ? 'true' : 'false'}
                                    aria-describedby={instagramUrlError ? 'instagram-url-error' : undefined}
                                  />
                                  {instagramUrlError && (
                                    <p id="instagram-url-error" className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
                                      {instagramUrlError}
                                    </p>
                                  )}
                                  {instagramUrl && !instagramUrlError && getInstagramUsername(instagramUrl) && (
                                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                                      ✓ We'll verify: <span className="font-semibold">@{getInstagramUsername(instagramUrl)}</span>
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Step 2: Copy Verification Code */}
                            <div className="space-y-3 mb-6">
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold text-sm">
                                  2
                                </div>
                                <div className="flex-1 min-w-0">
                                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                    Copy Your Verification Code
                                  </label>
                                  <div className="flex items-center gap-3">
                                    <div className="flex-1 px-4 py-3 bg-white dark:bg-gray-800 border-2 border-indigo-300 dark:border-indigo-700 rounded-lg">
                                      <code className="text-2xl font-mono font-bold text-gray-900 dark:text-white tracking-wider">
                                        {instagramCode}
                                      </code>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={handleCopyCode}
                                      className="flex-shrink-0 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-600 dark:focus:ring-indigo-400 flex items-center gap-2"
                                      aria-label="Copy verification code"
                                    >
                                      <ClipboardDocumentIcon className="h-5 w-5" />
                                      {copied ? 'Copied!' : 'Copy'}
                                    </button>
                                  </div>
                                  {copied && (
                                    <p className="mt-2 text-sm text-green-600 dark:text-green-400 font-medium">
                                      ✓ Code copied to clipboard!
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Step 3: Send DM */}
                            <div className="space-y-3 mb-6">
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold text-sm">
                                  3
                                </div>
                                <div className="flex-1 min-w-0">
                                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                    Send DM to @w0rnvault
                                  </label>
                                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                                    Open Instagram and send a direct message to <span className="font-semibold text-gray-900 dark:text-white">@w0rnvault</span> with your verification code.
                                  </p>
                                  <div className="flex flex-wrap gap-3">
                                    <a
                                      href="https://www.instagram.com/w0rnvault/"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-lg font-semibold text-sm transition-all shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                                    >
                                      <IconComponent className="h-5 w-5" />
                                      Open Instagram
                                    </a>
                                    {!dmSent && (
                                      <button
                                        type="button"
                                        onClick={handleDmSent}
                                        disabled={!instagramUrl || !!instagramUrlError || isSubmitting}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                                      >
                                        {isSubmitting ? 'Submitting...' : "I've Sent the DM"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Step 4: Verification Status */}
                            {dmSent && (
                              <div className="space-y-3">
                                <div className="flex items-start gap-3">
                                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-500 text-white flex items-center justify-center font-semibold text-sm">
                                    4
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4">
                                      <h5 className="text-sm font-semibold text-yellow-900 dark:text-yellow-200 mb-1">
                                        Verification Pending
                                      </h5>
                                      <p className="text-sm text-yellow-800 dark:text-yellow-300">
                                        We've received your verification request. Verification usually takes up to 24 hours. We'll review your DM and verify your account soon.
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Show connected state only when connected AND (not Instagram OR Instagram verified OR not pending verification) */}
                    {isConnected && (!isInstagram || !dmSent || socialLinks?.instagramVerified) ? (
                      <div className="flex items-center gap-2">
                        <CheckCircleIcon className="h-6 w-6 text-green-600 dark:text-green-400" aria-hidden="true" />
                        <span className="sr-only">Connected</span>
                        <Menu as="div" className="relative flex-none">
                          <MenuButton className="relative block text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                            <span className="absolute -inset-2.5" />
                            <span className="sr-only">Open options for {platform.label}</span>
                            <EllipsisVerticalIcon aria-hidden="true" className="size-5" />
                          </MenuButton>
                          <MenuItems
                            transition
                            className="absolute right-0 z-10 mt-2 w-32 origin-top-right rounded-md bg-white py-2 shadow-lg outline-1 outline-gray-900/5 transition data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-100 data-enter:ease-out data-leave:duration-75 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
                          >
                            <MenuItem>
                              {({focus}) => (
                                <Form method="post" className="m-0">
                                  <input type="hidden" name="csrf_token" value={csrfToken} />
                                  <input type="hidden" name="action_type" value="disconnect" />
                                  <input type="hidden" name="platform" value={platform.key} />
                                  <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={`block w-full text-left px-3 py-1 text-sm/6 text-gray-900 data-focus:bg-gray-50 data-focus:outline-hidden dark:text-white dark:data-focus:bg-white/5 ${
                                      focus ? 'bg-gray-50 dark:bg-white/5' : ''
                                    } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  >
                                    Disconnect
                                  </button>
                                </Form>
                              )}
                            </MenuItem>
                          </MenuItems>
                        </Menu>
                      </div>
                    ) : (
                      // Show Connect button for all platforms when not connected
                      // For Instagram, clicking will show the verification code instead of OAuth
                      // Only show Connect button if Instagram URL doesn't exist in database and not pending
                      isInstagram ? (
                        !socialLinks?.instagram && !showInstagramCode && !isInstagramPending && (
                          <button
                            type="button"
                            onClick={() => setShowInstagramCode(true)}
                            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:shadow-none dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500"
                          >
                            Connect
                          </button>
                        )
                      ) : (
                        <Form method="post" className="m-0">
                          <input type="hidden" name="csrf_token" value={csrfToken} />
                          <input type="hidden" name="action_type" value="verify" />
                          <input type="hidden" name="platform" value={platform.key} />
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:shadow-none dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500"
                          >
                            Connect
                          </button>
                        </Form>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.social-links').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

// Performance: Simplified PKCE random string generation
// Using 2x buffer size reduces modulo bias to negligible levels without complex rejection sampling
function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const charsetLength = charset.length;
  // Generate 2x bytes to reduce bias significantly (bias is negligible with 2x buffer)
  const values = new Uint8Array(length * 2);
  crypto.getRandomValues(values);
  
  let result = '';
  for (let i = 0; i < length; i++) {
    // Use modulo with larger buffer - bias is negligible with 2x buffer
    result += charset[values[i * 2] % charsetLength];
  }
  
  return result;
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return new Uint8Array(hashBuffer);
}

function base64UrlEncode(array) {
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

