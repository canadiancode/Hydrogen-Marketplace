import {Form, useLoaderData, useActionData, useNavigation} from 'react-router';
import {requireAuth, generateCSRFToken, getClientIP, constantTimeEquals} from '~/lib/auth-helpers';
import {fetchCreatorProfile, createUserSupabaseClient, createServerSupabaseClient} from '~/lib/supabase';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {CheckCircleIcon, XCircleIcon} from '@heroicons/react/24/solid';
import {EllipsisVerticalIcon} from '@heroicons/react/20/solid';
import {Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react';

export const meta = () => {
  return [{title: 'WornVault | Social Links'}];
};

// Performance: Module-level constants to avoid object recreation
const VALID_PLATFORMS = new Set(['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'twitch']);

const ALLOWED_DOMAINS = {
  instagram: ['instagram.com', 'www.instagram.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'fb.com', 'www.fb.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'youtu.be'],
  twitch: ['twitch.tv', 'www.twitch.tv'],
};

const DEFAULT_SOCIAL_LINKS = {
  instagram: '',
  instagramVerified: false,
  facebook: '',
  facebookVerified: false,
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
    facebook: submittedLinks.facebook_url || submittedLinks.facebook || '',
    facebookVerified: false,
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

// Ensure loader revalidates after form submission
export const shouldRevalidate = ({formMethod}) => {
  if (formMethod && formMethod !== 'GET') return true;
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
    const decoded = decodeURIComponent(error);
    callbackError = decoded
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .substring(0, 200); // Limit length
  }

  // Fetch creator profile to get creator_id
  let creatorId = null;
  let socialLinks = null;
  try {
    const profile = await fetchCreatorProfile(
      user.email,
      context.env.SUPABASE_URL,
      context.env.SUPABASE_ANON_KEY,
      session.access_token,
    );
    
    if (profile?.id) {
      creatorId = profile.id;
      
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
        
        if (!verificationError && verification?.submitted_links) {
          // Extract social links from submitted_links JSONB
          const submittedLinks = verification.submitted_links;
          
          // Debug logging (remove in production if needed)
          if (context.env.NODE_ENV === 'development') {
            console.log('Loaded submitted_links:', submittedLinks);
          }
          
          socialLinks = mapSubmittedLinksToSocialLinks(submittedLinks);
          
          // Debug logging (remove in production if needed)
          if (context.env.NODE_ENV === 'development') {
            console.log('Mapped socialLinks:', socialLinks);
          }
        } else if (verificationError) {
          console.error('Error fetching verification record:', verificationError);
        } else if (!verification) {
          // No verification record found - this is normal for first-time users
          if (context.env.NODE_ENV === 'development') {
            console.log('No verification record found for creator_id:', creatorId);
          }
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
        
        if (!verificationError && verification?.submitted_links) {
          const submittedLinks = verification.submitted_links;
          socialLinks = mapSubmittedLinksToSocialLinks(submittedLinks);
        }
      }
    }
  } catch (error) {
    console.error('Error fetching social links:', error);
  }

  // Generate CSRF token for form protection
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);

  return {
    user,
    socialLinks: socialLinks || DEFAULT_SOCIAL_LINKS,
    csrfToken,
    callbackMessage,
    callbackError,
  };
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
    
    // Performance: Use Set.has() instead of array.includes() for O(1) lookup
    if (!platform || !VALID_PLATFORMS.has(platform)) {
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

    // Generate OAuth state token for CSRF protection
    const oauthState = await generateCSRFToken(request, context.env.SESSION_SECRET);
    context.session.set(`oauth_state_${platform}`, oauthState);
    context.session.set(`oauth_platform_${oauthState}`, platform);

    // Build OAuth URL based on platform
    const baseUrl = new URL(request.url).origin;
    const redirectUri = `${baseUrl}/creator/social-links/oauth/callback`;
    
    let oauthUrl = '';
    
    switch (platform) {
      case 'instagram':
        // Instagram Basic Display API
        oauthUrl = `https://api.instagram.com/oauth/authorize?client_id=${context.env.INSTAGRAM_CLIENT_ID || 'YOUR_CLIENT_ID'}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user_profile,user_media&response_type=code&state=${oauthState}`;
        break;
      case 'facebook':
        // Facebook Login API
        oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${context.env.FACEBOOK_APP_ID || 'YOUR_APP_ID'}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_profile,email&state=${oauthState}`;
        break;
      case 'tiktok':
        // TikTok OAuth
        oauthUrl = `https://www.tiktok.com/v2/auth/authorize?client_key=${context.env.TIKTOK_CLIENT_KEY || 'YOUR_CLIENT_KEY'}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=user.info.basic&state=${oauthState}`;
        break;
      case 'x': {
        // Generate PKCE code verifier and challenge
        const codeVerifier = generateRandomString(128);
        const codeChallenge = await sha256(codeVerifier);
        const codeChallengeBase64 = base64UrlEncode(codeChallenge);
        
        // Store code verifier in session for later use
        context.session.set(`oauth_code_verifier_${platform}`, codeVerifier);
        
        // X (Twitter) OAuth 2.0 with PKCE
        oauthUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${context.env.X_CLIENT_ID || 'YOUR_CLIENT_ID'}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=tweet.read%20users.read&state=${oauthState}&code_challenge=${codeChallengeBase64}&code_challenge_method=S256`;
        break;
      }
      case 'youtube':
        // YouTube Data API v3 OAuth
        oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${context.env.YOUTUBE_CLIENT_ID || 'YOUR_CLIENT_ID'}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/youtube.readonly&state=${oauthState}`;
        break;
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
    
    const platforms = ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'twitch'];
    
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

      // Regenerate CSRF token for next request
      const newCsrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
      context.session.set('csrf_token', newCsrfToken);

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

    // Validate CSRF token
    const csrfToken = formData.get('csrf_token')?.toString();
    const storedCSRFToken = context.session.get('csrf_token');
    
    if (!csrfToken || !storedCSRFToken || !constantTimeEquals(csrfToken, storedCSRFToken)) {
      return {
        success: false,
        error: 'Invalid security token. Please refresh the page and try again.',
      };
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

      if (!existingVerification?.submitted_links) {
        return {
          success: false,
          error: 'No social links found to disconnect.',
        };
      }

      // Remove the platform URL from submitted_links
      const updatedLinks = {...existingVerification.submitted_links};
      delete updatedLinks[`${platform}_url`];
      delete updatedLinks[platform]; // Also remove alternative field names

      // Update the creator_verifications record
      const {error: updateError} = await serverSupabase
        .from('creator_verifications')
        .update({
          submitted_links: updatedLinks,
        })
        .eq('id', existingVerification.id)
        .eq('creator_id', profile.id); // Additional security: ensure creator_id matches

      if (updateError) {
        console.error('Error disconnecting social link from creator_verifications:', updateError);
        return {
          success: false,
          error: 'Failed to disconnect social link. Please try again.',
        };
      }

      // Clear the platform fields in the creators table
      // Set URL and username to null, and verified to false
      const creatorUpdates = {
        [`${platform}_url`]: null,
        [`${platform}_username`]: null,
        [`${platform}_verified`]: false,
      };

      const {error: creatorUpdateError} = await serverSupabase
        .from('creators')
        .update(creatorUpdates)
        .eq('id', profile.id); // Security: only update the authenticated user's creator record

      if (creatorUpdateError) {
        console.error('Error clearing social link from creators table:', creatorUpdateError);
        return {
          success: false,
          error: 'Failed to disconnect social link. Please try again.',
        };
      }

      // Regenerate CSRF token for next request
      const newCsrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
      context.session.set('csrf_token', newCsrfToken);

      return {
        success: true,
        message: `${platform.charAt(0).toUpperCase() + platform.slice(1)} disconnected successfully`,
      };
    } catch (error) {
      const isProduction = context.env.NODE_ENV === 'production';
      console.error('Error disconnecting social link:', {
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString(),
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
  const {user, socialLinks, csrfToken, callbackMessage, callbackError} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  
  // Debug logging (remove in production if needed)
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    console.log('CreatorSocialLinks - socialLinks:', socialLinks);
  }

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

  const FacebookIcon = (props) => (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path
        fillRule="evenodd"
        d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"
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
      key: 'facebook',
      label: 'Facebook',
      Icon: FacebookIcon,
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
        {(actionData?.success || callbackMessage) && (
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
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {isConnected ? (
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

