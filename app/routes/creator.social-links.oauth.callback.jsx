import {redirect} from 'react-router';
import {requireAuth, constantTimeEquals} from '~/lib/auth-helpers';
import {fetchCreatorProfile, createUserSupabaseClient} from '~/lib/supabase';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';

export const meta = () => {
  return [{title: 'WornVault | Verifying Social Account'}];
};

/**
 * OAuth callback handler for social media platform verification
 * Handles the OAuth redirect from various platforms and verifies account ownership
 */
export async function loader({context, request}) {
  // Extract OAuth parameters first (before auth check) to handle errors and preserve for redirect
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Handle OAuth errors first (before auth check)
  if (error) {
    console.error('OAuth error:', error, errorDescription);
    return redirect(`/creator/social-links?error=${encodeURIComponent(errorDescription || error)}`);
  }

  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  // If not authenticated, preserve the full callback URL with OAuth parameters
  if (!user?.email || !session?.access_token) {
    const fullCallbackUrl = request.url;
    return redirect(`/creator/login?returnTo=${encodeURIComponent(fullCallbackUrl)}`);
  }

  // Rate limiting
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `oauth-callback:${clientIP}`, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });
  
  if (!rateLimit.allowed) {
    return redirect('/creator/social-links?error=rate_limit');
  }

  // Validate state token (CSRF protection)
  if (!state) {
    return redirect('/creator/social-links?error=invalid_state');
  }

  // Get platform from state
  const platform = context.session.get(`oauth_platform_${state}`);
  const storedState = context.session.get(`oauth_state_${platform}`);

  if (!platform || !storedState || !constantTimeEquals(state, storedState)) {
    return redirect('/creator/social-links?error=invalid_state');
  }

  // Clear OAuth state tokens (one-time use)
  context.session.unset(`oauth_state_${platform}`);
  context.session.unset(`oauth_platform_${state}`);

  if (!code) {
    return redirect('/creator/social-links?error=no_code');
  }

  try {
    // Exchange authorization code for access token and fetch user info
    const baseUrl = new URL(request.url).origin;
    const redirectUri = `${baseUrl}/creator/social-links/oauth/callback`;
    
    let userInfo = null;
    let username = null;
    let profileUrl = null;

    // Exchange code for access token and fetch user info based on platform
    switch (platform) {
      case 'instagram': {
        // Exchange code for access token
        const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: context.env.INSTAGRAM_CLIENT_ID || '',
            client_secret: context.env.INSTAGRAM_CLIENT_SECRET || '',
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code: code,
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error('Failed to exchange Instagram code');
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        const userId = tokenData.user_id;

        // Fetch user profile
        const profileResponse = await fetch(
          `https://graph.instagram.com/${userId}?fields=id,username&access_token=${accessToken}`
        );

        if (!profileResponse.ok) {
          throw new Error('Failed to fetch Instagram profile');
        }

        const profileData = await profileResponse.json();
        username = profileData.username;
        profileUrl = `https://instagram.com/${username}`;
        break;
      }

      case 'facebook': {
        // Exchange code for access token
        const tokenResponse = await fetch('https://graph.facebook.com/v18.0/oauth/access_token', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const tokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
        tokenUrl.searchParams.set('client_id', context.env.FACEBOOK_APP_ID || '');
        tokenUrl.searchParams.set('client_secret', context.env.FACEBOOK_APP_SECRET || '');
        tokenUrl.searchParams.set('redirect_uri', redirectUri);
        tokenUrl.searchParams.set('code', code);

        const fbTokenResponse = await fetch(tokenUrl.toString());

        if (!fbTokenResponse.ok) {
          throw new Error('Failed to exchange Facebook code');
        }

        const fbTokenData = await fbTokenResponse.json();
        const fbAccessToken = fbTokenData.access_token;

        // Fetch user profile
        const fbProfileResponse = await fetch(
          `https://graph.facebook.com/v18.0/me?fields=id,name,username&access_token=${fbAccessToken}`
        );

        if (!fbProfileResponse.ok) {
          throw new Error('Failed to fetch Facebook profile');
        }

        const fbProfileData = await fbProfileResponse.json();
        username = fbProfileData.username || fbProfileData.name;
        profileUrl = `https://facebook.com/${username}`;
        break;
      }

      case 'tiktok': {
        // Exchange code for access token
        const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_key: context.env.TIKTOK_CLIENT_KEY || '',
            client_secret: context.env.TIKTOK_CLIENT_SECRET || '',
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error('Failed to exchange TikTok code');
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.data.access_token;

        // Fetch user info
        const userResponse = await fetch('https://open.tiktokapis.com/v2/user/info/', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!userResponse.ok) {
          throw new Error('Failed to fetch TikTok user info');
        }

        const userData = await userResponse.json();
        username = userData.data.user.display_name;
        profileUrl = `https://tiktok.com/@${username}`;
        break;
      }

      case 'x': {
        // Get stored code verifier
        const codeVerifier = context.session.get(`oauth_code_verifier_${platform}`);
        context.session.unset(`oauth_code_verifier_${platform}`);
        
        if (!codeVerifier) {
          throw new Error('Missing code verifier');
        }
        
        // Exchange code for access token (X/Twitter OAuth 2.0)
        const credentials = `${context.env.X_CLIENT_ID || ''}:${context.env.X_CLIENT_SECRET || ''}`;
        const base64Credentials = btoa(credentials);
        
        const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${base64Credentials}`,
          },
          body: new URLSearchParams({
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code_verifier: codeVerifier, // Use stored verifier
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error('Failed to exchange X code');
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // Fetch user info
        const userResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=username', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!userResponse.ok) {
          throw new Error('Failed to fetch X user info');
        }

        const userData = await userResponse.json();
        username = userData.data.username;
        profileUrl = `https://x.com/${username}`;
        break;
      }

      case 'youtube': {
        // Exchange code for access token (Google OAuth)
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: context.env.YOUTUBE_CLIENT_ID || '',
            client_secret: context.env.YOUTUBE_CLIENT_SECRET || '',
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error('Failed to exchange YouTube code');
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // Fetch channel info
        const channelResponse = await fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!channelResponse.ok) {
          throw new Error('Failed to fetch YouTube channel info');
        }

        const channelData = await channelResponse.json();
        if (channelData.items && channelData.items.length > 0) {
          const channel = channelData.items[0];
          username = channel.snippet.customUrl || channel.snippet.title;
          profileUrl = `https://youtube.com/${channel.snippet.customUrl || `channel/${channel.id}`}`;
        }
        break;
      }

      case 'twitch': {
        // Exchange code for access token
        const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: context.env.TWITCH_CLIENT_ID || '',
            client_secret: context.env.TWITCH_CLIENT_SECRET || '',
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error('Failed to exchange Twitch code');
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // Fetch user info
        const userResponse = await fetch('https://api.twitch.tv/helix/users', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Client-Id': context.env.TWITCH_CLIENT_ID || '',
          },
        });

        if (!userResponse.ok) {
          throw new Error('Failed to fetch Twitch user info');
        }

        const userData = await userResponse.json();
        if (userData.data && userData.data.length > 0) {
          username = userData.data[0].login;
          profileUrl = `https://twitch.tv/${username}`;
        }
        break;
      }

      default:
        return redirect('/creator/social-links?error=unsupported_platform');
    }

    // Update creator profile with verified social link
    if (username && profileUrl) {
      const profile = await fetchCreatorProfile(
        user.email,
        context.env.SUPABASE_URL,
        context.env.SUPABASE_ANON_KEY,
        session.access_token,
      );

      if (profile && profile.id) {
        const supabase = createUserSupabaseClient(
          context.env.SUPABASE_URL,
          context.env.SUPABASE_ANON_KEY,
          session.access_token,
        );

        const updates = {
          [`${platform}_url`]: profileUrl,
          [`${platform}_username`]: username,
          [`${platform}_verified`]: true,
        };

        const {error: updateError} = await supabase
          .from('creators')
          .update(updates)
          .eq('id', profile.id);

        if (updateError) {
          console.error('Error updating social link:', updateError);
          return redirect('/creator/social-links?error=update_failed');
        }

        return redirect('/creator/social-links?verified=true');
      }
    }

    return redirect('/creator/social-links?error=verification_failed');
  } catch (error) {
    const isProduction = context.env.NODE_ENV === 'production';
    console.error('OAuth callback error:', {
      error: error.message || 'Unknown error',
      platform,
      timestamp: new Date().toISOString(),
      ...(isProduction ? {} : {errorStack: error.stack}),
    });

    return redirect(`/creator/social-links?error=${encodeURIComponent('Verification failed. Please try again.')}`);
  }
}

/** @typedef {import('./+types/creator.social-links.oauth.callback').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

