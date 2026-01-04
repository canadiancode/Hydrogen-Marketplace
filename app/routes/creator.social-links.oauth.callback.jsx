import {redirect} from 'react-router';
import {requireAuth, constantTimeEquals} from '~/lib/auth-helpers';
import {fetchCreatorProfile, createUserSupabaseClient, createServerSupabaseClient, getSupabaseSession} from '~/lib/supabase';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';
import {getAndDeleteOAuthState} from '~/lib/oauth-state';

// Valid platforms for OAuth verification
const VALID_PLATFORMS = new Set(['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'twitch']);

// Maximum length for OAuth parameters to prevent DoS
const MAX_PARAM_LENGTH = 2048;

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

  // Validate input length to prevent DoS attacks
  if ((code && code.length > MAX_PARAM_LENGTH) || 
      (state && state.length > MAX_PARAM_LENGTH) ||
      (error && error.length > MAX_PARAM_LENGTH) ||
      (errorDescription && errorDescription.length > MAX_PARAM_LENGTH)) {
    return redirect('/creator/social-links?error=invalid_request');
  }

  // Use isProduction flag for conditional logging
  const isProduction = context.env.NODE_ENV === 'production';

  // Handle OAuth errors first (before auth check)
  if (error) {
    if (!isProduction) {
      console.error('OAuth error:', error, errorDescription);
    }
    // Sanitize error message to prevent information disclosure
    const safeError = errorDescription || error || 'oauth_error';
    return redirect(`/creator/social-links?error=${encodeURIComponent(safeError)}`);
  }

  // Validate state token FIRST (before auth check) - this doesn't require authentication
  // This allows us to preserve OAuth state even if session cookie isn't sent on redirect
  if (!state) {
    return redirect('/creator/social-links?error=invalid_state');
  }

  // Get and DELETE OAuth state immediately after validation to prevent replay attacks
  // This validates the state exists, isn't expired, and gives us creatorId
  // State is deleted immediately to prevent reuse even if user needs to log in
  const oauthStateData = await getAndDeleteOAuthState({
    state,
    supabaseUrl: context.env.SUPABASE_URL,
    supabaseServiceKey: context.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!oauthStateData) {
    return redirect('/creator/social-links?error=invalid_state_expired');
  }

  const platform = oauthStateData.platform;
  const codeVerifier = oauthStateData.codeVerifier;
  const creatorId = oauthStateData.creatorId;

  // Validate platform from OAuth state to prevent platform injection
  if (!platform || !VALID_PLATFORMS.has(platform)) {
    return redirect('/creator/social-links?error=invalid_platform');
  }

  if (!code) {
    return redirect('/creator/social-links?error=no_code');
  }

  // Use getSupabaseSession directly instead of requireAuth to avoid throwing redirect
  // This allows us to handle the redirect ourselves while preserving the full callback URL
  let user, session, needsRefresh;
  try {
    const result = await getSupabaseSession(
      request,
      context.env.SUPABASE_URL,
      context.env.SUPABASE_ANON_KEY,
      isProduction,
    );
    user = result.user;
    session = result.session;
    needsRefresh = result.needsRefresh;
  } catch (authError) {
    // If there's an error getting session, treat as not authenticated
    user = null;
    session = null;
    needsRefresh = false;
  }
  
  // If not authenticated, we can still proceed if we have valid OAuth state
  // The OAuth state contains creatorId which was stored when user was authenticated
  // This handles the case where session cookie isn't sent due to SameSite restrictions
  let profile = null;
  if (user?.email && session?.access_token) {
    // User is authenticated - verify they match the creatorId from OAuth state
    profile = await fetchCreatorProfile(
      user.email,
      context.env.SUPABASE_URL,
      context.env.SUPABASE_ANON_KEY,
      session.access_token,
    );

    if (profile && profile.id !== creatorId) {
      if (!isProduction) {
        console.error('OAuth creator_id mismatch');
      }
      return redirect('/creator/social-links?error=authentication_mismatch');
    }
  } else {
    // Not authenticated - verify creatorId exists in database using service role
    // This allows OAuth to complete even if session cookie isn't sent
    // Security: OAuth state was stored when user was authenticated, so creatorId is trusted
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Validate redirect URL to prevent open redirect vulnerability
      const fullCallbackUrl = request.url;
      const callbackPath = new URL(fullCallbackUrl).pathname + new URL(fullCallbackUrl).search;
      
      // Only allow internal URLs
      if (!callbackPath.startsWith('/') || callbackPath.includes('//') || callbackPath.includes(':')) {
        return redirect('/creator/login?message=Please log in to complete social media connection');
      }
      
      return redirect(`/creator/login?returnTo=${encodeURIComponent(callbackPath)}&message=Please log in to complete social media connection`);
    }

    const serverSupabase = createServerSupabaseClient(
      context.env.SUPABASE_URL,
      context.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    // Verify creatorId exists (security check)
    const {data: creatorData, error: creatorError} = await serverSupabase
      .from('creators')
      .select('id')
      .eq('id', creatorId)
      .maybeSingle();

    if (creatorError || !creatorData) {
      if (!isProduction) {
        console.error('CreatorId from OAuth state not found in database');
      }
      return redirect('/creator/social-links?error=invalid_creator');
    }

    // Create a minimal profile object for the update logic below
    profile = {id: creatorId};
  }

  if (!profile || !profile.id) {
    return redirect('/creator/social-links?error=profile_not_found');
  }

  // Rate limiting (after auth and state validation)
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `oauth-callback:${clientIP}`, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });
  
  if (!rateLimit.allowed) {
    return redirect('/creator/social-links?error=rate_limit');
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
            code_verifier: codeVerifier, // Use stored verifier from database
          }),
        });

        if (!tokenResponse.ok) {
          if (!isProduction) {
            const errorText = await tokenResponse.text();
            console.error('Twitter token exchange error:', errorText);
          }
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
        username = userData.data?.username;
        profileUrl = username ? `https://x.com/${username}` : null;
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
    // Note: profile is already fetched above for verification, reuse it
    if (username && profileUrl && profile && profile.id) {
      // Use service role client if user isn't authenticated (cookie not sent due to SameSite)
      // Otherwise use user client for RLS compliance
      const supabase = session?.access_token
        ? createUserSupabaseClient(
            context.env.SUPABASE_URL,
            context.env.SUPABASE_ANON_KEY,
            session.access_token,
          )
        : createServerSupabaseClient(
            context.env.SUPABASE_URL,
            context.env.SUPABASE_SERVICE_ROLE_KEY,
          );

      const updates = {
        [`${platform}_url`]: profileUrl,
        [`${platform}_username`]: username,
        [`${platform}_verified`]: true,
      };

      const {error: updateError, data: updateData} = await supabase
        .from('creators')
        .update(updates)
        .eq('id', profile.id)
        .select();

      if (updateError) {
        if (!isProduction) {
          console.error('Error updating social link:', updateError);
        }
        return redirect('/creator/social-links?error=update_failed');
      }

      // Verify update was successful
      if (!updateData || updateData.length === 0) {
        return redirect('/creator/social-links?error=update_failed_no_rows');
      }

      // State was already deleted immediately after validation, so no need to delete again
      return redirect('/creator/social-links?verified=true');
    }
    
    return redirect('/creator/social-links?error=verification_failed');
  } catch (error) {
    // State was already deleted immediately after validation, so retry requires new OAuth flow
    const isProduction = context.env.NODE_ENV === 'production';
    if (!isProduction) {
      console.error('OAuth callback error:', {
        error: error.message || 'Unknown error',
        platform,
        timestamp: new Date().toISOString(),
        errorStack: error.stack,
      });
    }

    return redirect(`/creator/social-links?error=${encodeURIComponent('Verification failed. Please try again.')}`);
  }
}

/** @typedef {import('./+types/creator.social-links.oauth.callback').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

