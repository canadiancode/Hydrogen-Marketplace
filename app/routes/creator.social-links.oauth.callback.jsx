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

  console.log('[OAuth Callback] Callback initiated', {
    url: request.url,
    hasCode: !!code,
    hasState: !!state,
    hasError: !!error,
    error,
    errorDescription,
    timestamp: new Date().toISOString(),
  });

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

  console.log('[OAuth Callback] OAuth state validated', {
    platform,
    creatorId,
    hasCodeVerifier: !!codeVerifier,
    codeLength: code?.length,
  });

  // Validate platform from OAuth state to prevent platform injection
  if (!platform || !VALID_PLATFORMS.has(platform)) {
    console.error('[OAuth Callback] Invalid platform:', platform);
    return redirect('/creator/social-links?error=invalid_platform');
  }

  if (!code) {
    console.error('[OAuth Callback] Missing authorization code');
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
    // Security: Build redirect URI with Host header injection protection
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
    const redirectUri = `${baseUrl}/creator/social-links/oauth/callback`;
    
    console.log('[OAuth Callback] Processing OAuth flow', {
      platform,
      redirectUri,
      baseUrl,
      isValidOrigin,
      requestOrigin,
    });
    
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
        console.log('[TikTok OAuth] Starting token exchange', {
          redirectUri,
          hasClientKey: !!context.env.TIKTOK_CLIENT_KEY,
          hasClientSecret: !!context.env.TIKTOK_CLIENT_SECRET,
          codeLength: code?.length,
        });

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

        console.log('[TikTok OAuth] Token exchange response status:', {
          ok: tokenResponse.ok,
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error('[TikTok OAuth] Token exchange error:', {
            status: tokenResponse.status,
            statusText: tokenResponse.statusText,
            body: errorText,
            headers: Object.fromEntries(tokenResponse.headers.entries()),
          });
          throw new Error(`Failed to exchange TikTok code: ${tokenResponse.status} - ${errorText}`);
        }

        const tokenData = await tokenResponse.json();
        
        // Debug: Log the actual response structure
        console.log('[TikTok OAuth] Token response structure:', {
          hasTokenData: !!tokenData,
          tokenDataKeys: tokenData ? Object.keys(tokenData) : [],
          hasData: !!tokenData?.data,
          dataKeys: tokenData?.data ? Object.keys(tokenData.data) : [],
          fullResponse: JSON.stringify(tokenData, null, 2),
        });
        
        // Security: Validate token response structure
        // TikTok API v2 might return different structures depending on success/error
        let accessToken = null;
        
        // Try different possible response structures
        if (tokenData?.data?.access_token) {
          // Standard structure: { data: { access_token: "...", ... } }
          accessToken = tokenData.data.access_token;
          console.log('[TikTok OAuth] Found access_token in tokenData.data.access_token');
        } else if (tokenData?.access_token) {
          // Alternative structure: { access_token: "...", ... }
          accessToken = tokenData.access_token;
          console.log('[TikTok OAuth] Found access_token in tokenData.access_token');
        } else {
          // Log the actual structure for debugging
          console.error('[TikTok OAuth] Unexpected token response structure:', {
            tokenData: JSON.stringify(tokenData, null, 2),
            tokenDataType: typeof tokenData,
            tokenDataIsArray: Array.isArray(tokenData),
          });
          throw new Error('Invalid TikTok token response: missing access_token');
        }

        if (!accessToken) {
          console.error('[TikTok OAuth] Access token is null or undefined:', {
            tokenData: JSON.stringify(tokenData, null, 2),
          });
          throw new Error('Failed to extract access token from TikTok response');
        }

        console.log('[TikTok OAuth] Successfully obtained access token', {
          accessTokenLength: accessToken.length,
          accessTokenPrefix: accessToken.substring(0, 20) + '...',
        });

        // Fetch user info - TikTok API v2 requires fields parameter
        const userInfoUrl = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username';
        console.log('[TikTok OAuth] Fetching user info from:', userInfoUrl);
        
        const userResponse = await fetch(userInfoUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        console.log('[TikTok OAuth] User info response status:', {
          ok: userResponse.ok,
          status: userResponse.status,
          statusText: userResponse.statusText,
        });

        if (!userResponse.ok) {
          const errorText = await userResponse.text();
          console.error('[TikTok OAuth] User info API error:', {
            status: userResponse.status,
            statusText: userResponse.statusText,
            body: errorText,
            headers: Object.fromEntries(userResponse.headers.entries()),
          });
          throw new Error(`Failed to fetch TikTok user info: ${userResponse.status} - ${errorText}`);
        }

        const userData = await userResponse.json();
        
        // Debug: Log the actual response structure
        console.log('[TikTok OAuth] User info response structure:', {
          hasUserData: !!userData,
          userDataKeys: userData ? Object.keys(userData) : [],
          hasData: !!userData?.data,
          dataKeys: userData?.data ? Object.keys(userData.data) : [],
          hasUser: !!userData?.data?.user,
          userKeys: userData?.data?.user ? Object.keys(userData.data.user) : [],
          fullResponse: JSON.stringify(userData, null, 2),
        });
        
        // Security: Validate user data response structure
        let tiktokUser = null;
        
        // Try different possible response structures
        if (userData?.data?.user) {
          // Standard structure: { data: { user: { ... } } }
          tiktokUser = userData.data.user;
          console.log('[TikTok OAuth] Found user data in userData.data.user');
        } else if (userData?.user) {
          // Alternative structure: { user: { ... } }
          tiktokUser = userData.user;
          console.log('[TikTok OAuth] Found user data in userData.user');
        } else if (userData?.data) {
          // User data might be directly in data
          tiktokUser = userData.data;
          console.log('[TikTok OAuth] Found user data in userData.data');
        } else {
          console.error('[TikTok OAuth] Unexpected user data response structure:', {
            userData: JSON.stringify(userData, null, 2),
            userDataType: typeof userData,
            userDataIsArray: Array.isArray(userData),
          });
          throw new Error('Invalid TikTok user data response structure');
        }
        
        if (!tiktokUser) {
          console.error('[TikTok OAuth] User data is null or undefined:', {
            userData: JSON.stringify(userData, null, 2),
          });
          throw new Error('Failed to extract user data from TikTok response');
        }
        
        console.log('[TikTok OAuth] Extracted user data:', {
          username: tiktokUser.username,
          displayName: tiktokUser.display_name,
          openId: tiktokUser.open_id,
          userKeys: Object.keys(tiktokUser),
        });
        
        // Use username for profile URL (more reliable than display_name)
        // Fallback to display_name if username not available
        const rawUsername = tiktokUser.username || tiktokUser.display_name;
        
        if (!rawUsername || typeof rawUsername !== 'string') {
          console.error('[TikTok OAuth] Missing username/display_name:', {
            tiktokUser: JSON.stringify(tiktokUser, null, 2),
            hasUsername: !!tiktokUser.username,
            hasDisplayName: !!tiktokUser.display_name,
          });
          throw new Error('Unable to determine TikTok username');
        }
        
        console.log('[TikTok OAuth] Raw username:', rawUsername);
        
        // Security: Sanitize username to prevent XSS and injection
        // TikTok usernames are 2-24 chars, alphanumeric + underscore + period
        const sanitizedUsername = rawUsername
          .trim()
          .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
          .slice(0, 24);
        
        console.log('[TikTok OAuth] Sanitized username:', sanitizedUsername);
        
        // Validate: must be 2-24 chars, alphanumeric + underscore + period only
        if (sanitizedUsername.length < 2 || sanitizedUsername.length > 24) {
          console.error('[TikTok OAuth] Username length invalid:', {
            length: sanitizedUsername.length,
            username: sanitizedUsername,
          });
          throw new Error('TikTok username length invalid');
        }
        if (!/^[a-zA-Z0-9_.]+$/.test(sanitizedUsername)) {
          console.error('[TikTok OAuth] Invalid username characters:', {
            username: sanitizedUsername,
            matchesPattern: /^[a-zA-Z0-9_.]+$/.test(sanitizedUsername),
          });
          throw new Error('Invalid TikTok username characters');
        }
        
        username = sanitizedUsername;
        // Security: Use encodeURIComponent to safely construct URL
        profileUrl = `https://tiktok.com/@${encodeURIComponent(username)}`;
        
        console.log('[TikTok OAuth] Final values:', {
          username,
          profileUrl,
        });
        
        if (!username || !profileUrl) {
          throw new Error('Unable to determine TikTok username or profile URL');
        }
        
        console.log('[TikTok OAuth] Successfully processed TikTok OAuth flow');
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
        // Use same Google OAuth credentials as Supabase (for login)
        // Uses CLIENT_ID and CLIENT_SECRET (same as configured in Supabase)
        const googleClientId = context.env.CLIENT_ID || '';
        const googleClientSecret = context.env.CLIENT_SECRET || '';
        
        if (!googleClientId || !googleClientSecret) {
          if (!isProduction) {
            console.error('Missing Google OAuth credentials for YouTube verification');
          }
          throw new Error('YouTube OAuth not configured');
        }
        
        // Exchange code for access token (Google OAuth)
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: googleClientId,
            client_secret: googleClientSecret,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });

        if (!tokenResponse.ok) {
          if (!isProduction) {
            const errorText = await tokenResponse.text();
            console.error('YouTube token exchange error:', errorText);
          }
          throw new Error('Failed to exchange YouTube code');
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
          throw new Error('No access token received from YouTube');
        }

        // Fetch channel info using YouTube Data API v3
        const channelResponse = await fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!channelResponse.ok) {
          if (!isProduction) {
            const errorText = await channelResponse.text();
            console.error('YouTube API error:', errorText);
          }
          throw new Error('Failed to fetch YouTube channel info');
        }

        const channelData = await channelResponse.json();
        
        if (!channelData.items || channelData.items.length === 0) {
          throw new Error('No YouTube channel found');
        }
        
        const channel = channelData.items[0];
        // Use customUrl if available (e.g., @username), otherwise use channel ID
        const customUrl = channel.snippet?.customUrl;
        const channelId = channel.id;
        const channelTitle = channel.snippet?.title;
        
        // Set username to customUrl (without @) or channel title
        username = customUrl ? customUrl.replace('@', '') : channelTitle;
        
        // Build profile URL: use customUrl format if available, otherwise use channel ID
        if (customUrl) {
          profileUrl = `https://youtube.com/${customUrl}`;
        } else if (channelId) {
          profileUrl = `https://youtube.com/channel/${channelId}`;
        } else {
          throw new Error('Unable to determine YouTube channel URL');
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
          if (!isProduction) {
            const errorText = await tokenResponse.text();
            console.error('Twitch token exchange error:', errorText);
          }
          throw new Error('Failed to exchange Twitch code');
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
          throw new Error('No access token received from Twitch');
        }

        // Fetch user info
        const userResponse = await fetch('https://api.twitch.tv/helix/users', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Client-Id': context.env.TWITCH_CLIENT_ID || '',
          },
        });

        if (!userResponse.ok) {
          if (!isProduction) {
            const errorText = await userResponse.text();
            console.error('Twitch API error:', errorText);
          }
          throw new Error('Failed to fetch Twitch user info');
        }

        const userData = await userResponse.json();
        
        if (!userData.data || userData.data.length === 0) {
          throw new Error('No Twitch user data found');
        }
        
        const twitchUser = userData.data[0];
        const rawUsername = twitchUser.login || twitchUser.display_name;
        
        // Security: Sanitize username to prevent XSS and injection
        if (!rawUsername || typeof rawUsername !== 'string') {
          throw new Error('Invalid Twitch username format');
        }
        
        // Sanitize: remove control characters, limit length, trim whitespace
        // Twitch usernames are 4-25 chars, alphanumeric + underscore
        const sanitizedUsername = rawUsername
          .trim()
          .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
          .slice(0, 25);
        
        // Validate: must be 4-25 chars, alphanumeric + underscore only
        if (sanitizedUsername.length < 4 || sanitizedUsername.length > 25) {
          throw new Error('Twitch username length invalid');
        }
        if (!/^[a-zA-Z0-9_]+$/.test(sanitizedUsername)) {
          throw new Error('Invalid Twitch username characters');
        }
        
        username = sanitizedUsername;
        // Security: Use encodeURIComponent to safely construct URL
        profileUrl = `https://twitch.tv/${encodeURIComponent(username)}`;
        
        if (!username || !profileUrl) {
          throw new Error('Unable to determine Twitch username or profile URL');
        }
        
        break;
      }

      default:
        return redirect('/creator/social-links?error=unsupported_platform');
    }

    // Update creator profile with verified social link
    // Note: profile is already fetched above for verification, reuse it
    console.log('[OAuth Callback] Preparing to update creator profile', {
      platform,
      hasUsername: !!username,
      hasProfileUrl: !!profileUrl,
      hasProfile: !!profile,
      profileId: profile?.id,
      username,
      profileUrl,
    });

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

      console.log('[OAuth Callback] Updating creator profile', {
        platform,
        creatorId: profile.id,
        updates,
      });

      const {error: updateError, data: updateData} = await supabase
        .from('creators')
        .update(updates)
        .eq('id', profile.id)
        .select();

      if (updateError) {
        console.error('[OAuth Callback] Error updating social link:', {
          platform,
          creatorId: profile.id,
          error: updateError,
          errorMessage: updateError.message,
          errorCode: updateError.code,
        });
        return redirect('/creator/social-links?error=update_failed');
      }

      // Verify update was successful
      if (!updateData || updateData.length === 0) {
        console.error('[OAuth Callback] Update returned no rows', {
          platform,
          creatorId: profile.id,
        });
        return redirect('/creator/social-links?error=update_failed_no_rows');
      }

      console.log('[OAuth Callback] Successfully updated creator profile', {
        platform,
        creatorId: profile.id,
        updatedData: updateData,
      });

      // State was already deleted immediately after validation, so no need to delete again
      return redirect('/creator/social-links?verified=true');
    }
    
    console.error('[OAuth Callback] Missing required data for profile update', {
      platform,
      hasUsername: !!username,
      hasProfileUrl: !!profileUrl,
      hasProfile: !!profile,
      profileId: profile?.id,
    });
    
    return redirect('/creator/social-links?error=verification_failed');
  } catch (error) {
    // State was already deleted immediately after validation, so retry requires new OAuth flow
    const isProduction = context.env.NODE_ENV === 'production';
    
    // Always log errors for debugging (even in production, but sanitized)
    console.error('[OAuth Callback] Error caught:', {
      error: error.message || 'Unknown error',
      platform,
      timestamp: new Date().toISOString(),
      errorName: error.name,
      ...(isProduction ? {} : {
        errorStack: error.stack,
        errorFull: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      }),
    });

    // Provide more specific error message based on error type
    let errorMessage = 'Verification failed. Please try again.';
    if (error.message?.includes('token') || error.message?.includes('access_token')) {
      errorMessage = 'Failed to authenticate with TikTok. Please try again.';
    } else if (error.message?.includes('user info') || error.message?.includes('username') || error.message?.includes('display_name')) {
      errorMessage = 'Failed to retrieve TikTok profile information. Please try again.';
    } else if (error.message?.includes('Invalid') || error.message?.includes('missing')) {
      errorMessage = `TikTok verification error: ${error.message}`;
    }

    return redirect(`/creator/social-links?error=${encodeURIComponent(errorMessage)}`);
  }
}

/** @typedef {import('./+types/creator.social-links.oauth.callback').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

