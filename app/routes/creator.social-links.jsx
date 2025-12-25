import {useState} from 'react';
import {Form, useLoaderData, useActionData, useNavigation, useSubmit} from 'react-router';
import {requireAuth, generateCSRFToken, getClientIP, constantTimeEquals} from '~/lib/auth-helpers';
import {fetchCreatorProfile, createUserSupabaseClient} from '~/lib/supabase';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {CheckCircleIcon, XCircleIcon} from '@heroicons/react/24/solid';

export const meta = () => {
  return [{title: 'WornVault | Social Links'}];
};

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
    callbackError = decodeURIComponent(error);
  }

  // Fetch creator profile to get social links
  let socialLinks = null;
  try {
    const profile = await fetchCreatorProfile(
      user.email,
      context.env.SUPABASE_URL,
      context.env.SUPABASE_ANON_KEY,
      session.access_token,
    );
    
    // Extract social links from profile (assuming they're stored in profile or separate table)
    if (profile) {
      socialLinks = {
        instagram: profile.instagram_url || '',
        instagramUsername: profile.instagram_username || '',
        instagramVerified: profile.instagram_verified || false,
        facebook: profile.facebook_url || '',
        facebookUsername: profile.facebook_username || '',
        facebookVerified: profile.facebook_verified || false,
        tiktok: profile.tiktok_url || '',
        tiktokUsername: profile.tiktok_username || '',
        tiktokVerified: profile.tiktok_verified || false,
        x: profile.x_url || '',
        xUsername: profile.x_username || '',
        xVerified: profile.x_verified || false,
        youtube: profile.youtube_url || '',
        youtubeUsername: profile.youtube_username || '',
        youtubeVerified: profile.youtube_verified || false,
        twitch: profile.twitch_url || '',
        twitchUsername: profile.twitch_username || '',
        twitchVerified: profile.twitch_verified || false,
      };
    }
  } catch (error) {
    console.error('Error fetching social links:', error);
  }

  // Generate CSRF token for form protection
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);

  return {
    user,
    socialLinks: socialLinks || {
      instagram: '',
      instagramUsername: '',
      instagramVerified: false,
      facebook: '',
      facebookUsername: '',
      facebookVerified: false,
      tiktok: '',
      tiktokUsername: '',
      tiktokVerified: false,
      x: '',
      xUsername: '',
      xVerified: false,
      youtube: '',
      youtubeUsername: '',
      youtubeVerified: false,
      twitch: '',
      twitchUsername: '',
      twitchVerified: false,
    },
    csrfToken,
    callbackMessage,
    callbackError,
  };
}

export async function action({request, context}) {
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
    
    if (!platform || !['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'twitch'].includes(platform)) {
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

    // Clear CSRF token after use
    context.session.unset('csrf_token');

    // Sanitize and validate URLs
    const sanitizeUrl = (url) => {
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
        
        // Validate domain based on platform
        const hostname = urlObj.hostname.toLowerCase();
        
        // Ensure HTTPS
        if (urlObj.protocol !== 'https:') {
          return null;
        }
        
        // Limit length
        if (sanitized.length > 500) {
          return null;
        }
        
        return sanitized;
      } catch {
        return null;
      }
    };

    const sanitizeUsername = (username) => {
      if (!username || typeof username !== 'string') return null;
      const trimmed = username.trim();
      if (!trimmed) return null;
      
      // Remove @ symbol if present
      const cleaned = trimmed.replace(/^@/, '');
      
      // Only allow alphanumeric, underscores, dots, and hyphens
      const sanitized = cleaned.replace(/[^a-zA-Z0-9._-]/g, '');
      
      // Limit length
      if (sanitized.length > 100) {
        return sanitized.substring(0, 100);
      }
      
      return sanitized || null;
    };

    // Extract and sanitize social links
    const updates = {};
    
    const platforms = ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'twitch'];
    
    platforms.forEach((platform) => {
      const url = sanitizeUrl(formData.get(`${platform}_url`)?.toString());
      const username = sanitizeUsername(formData.get(`${platform}_username`)?.toString());
      
      if (url) {
        updates[`${platform}_url`] = url;
      }
      if (username) {
        updates[`${platform}_username`] = username;
      }
    });

    try {
      // Get creator profile
      const profile = await fetchCreatorProfile(
        user.email,
        context.env.SUPABASE_URL,
        context.env.SUPABASE_ANON_KEY,
        session.access_token,
      );

      if (!profile || !profile.id) {
        return {
          success: false,
          error: 'Creator profile not found. Please complete your profile first.',
        };
      }

      // Update social links in Supabase
      const supabase = createUserSupabaseClient(
        context.env.SUPABASE_URL,
        context.env.SUPABASE_ANON_KEY,
        session.access_token,
      );

      const {error: updateError} = await supabase
        .from('creators')
        .update(updates)
        .eq('id', profile.id);

      if (updateError) {
        console.error('Error updating social links:', updateError);
        return {
          success: false,
          error: 'Failed to save social links. Please try again.',
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

  return {
    success: false,
    error: 'Invalid action',
  };
}

export default function CreatorSocialLinks() {
  const {user, socialLinks, csrfToken, callbackMessage, callbackError} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === 'submitting';
  
  const [verifyingPlatform, setVerifyingPlatform] = useState(null);

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

  const handleVerify = (platform) => {
    setVerifyingPlatform(platform);
    const formData = new FormData();
    formData.append('action_type', 'verify');
    formData.append('platform', platform);
    formData.append('csrf_token', csrfToken);
    submit(formData, {method: 'post'});
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Social Links</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Connect your social media accounts to verify ownership and display them on your profile.
          </p>
        </div>

        <Form method="post" className="space-y-6">
          <input type="hidden" name="csrf_token" value={csrfToken} />
          <input type="hidden" name="action_type" value="save" />

          {/* Success/Error Messages */}
          {(actionData?.success || callbackMessage) && (
            <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                {callbackMessage || actionData?.message || 'Social links saved successfully'}
              </p>
            </div>
          )}
          
          {(actionData?.error || callbackError) && (
            <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                {callbackError || actionData?.error}
              </p>
            </div>
          )}

          {/* Social Platform Inputs */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 space-y-6">
            {platforms.map((platform) => {
              const verifiedKey = `${platform.key}Verified`;
              
              const isVerified = socialLinks?.[verifiedKey] || false;
              const isVerifying = verifyingPlatform === platform.key;
              const IconComponent = platform.Icon;

              return (
                <div key={platform.key} className="border-b border-gray-200 dark:border-gray-700 pb-6 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <IconComponent className="h-6 w-6 text-gray-700 dark:text-gray-300" aria-hidden="true" />
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {platform.label}
                      </h3>
                    </div>
                    {isVerified ? (
                      <p className="!p-1 mt-0.5 rounded-md bg-green-50 px-4 py-2 !text-[11px] font-medium text-green-700 inset-ring inset-ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:inset-ring-green-500/20">
                        {socialLinks?.[`${platform.key}Username`] || 'Connected'}
                      </p>
                    ) : (
                      <p className="!p-1 mt-0.5 rounded-md bg-gray-50 px-4 py-2 !text-[11px] font-medium text-gray-600 inset-ring inset-ring-gray-500/10 dark:bg-gray-400/10 dark:text-gray-400 dark:inset-ring-gray-400/20">
                        Not Connected
                      </p>
                    )}
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => handleVerify(platform.key)}
                      disabled={isVerifying || isSubmitting}
                      className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:shadow-none dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500"
                    >
                      {isVerifying ? (
                        <>
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Connecting...
                        </>
                      ) : (
                        <>
                          {isVerified ? (
                            <>
                              <CheckCircleIcon className="h-4 w-4" />
                              Re-connect
                            </>
                          ) : (
                            'Connect'
                          )}
                        </>
                      )}
                    </button>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Click "Connect" to sign in with {platform.label} and confirm account ownership.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:shadow-none dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.social-links').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  for (let i = 0; i < length; i++) {
    result += charset[values[i] % charset.length];
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

