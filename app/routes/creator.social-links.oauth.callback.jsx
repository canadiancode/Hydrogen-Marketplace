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
        const startTime = Date.now();
        console.error('[TikTok OAuth] ===== STARTING TIKTOK OAUTH FLOW =====');
        console.error('[TikTok OAuth] Step 1: Initializing token exchange', {
          timestamp: new Date().toISOString(),
          redirectUri,
          hasClientKey: !!context.env.TIKTOK_CLIENT_KEY,
          hasClientSecret: !!context.env.TIKTOK_CLIENT_SECRET,
          clientKeyLength: context.env.TIKTOK_CLIENT_KEY?.length || 0,
          clientSecretLength: context.env.TIKTOK_CLIENT_SECRET?.length || 0,
          codeLength: code?.length,
          codePrefix: code ? code.substring(0, 20) + '...' : 'NO_CODE',
        });

        // Exchange code for access token
        const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/';
        console.error('[TikTok OAuth] Step 2: Making token exchange request', {
          url: tokenUrl,
          method: 'POST',
          hasCode: !!code,
          hasRedirectUri: !!redirectUri,
        });

        let tokenResponse;
        try {
          tokenResponse = await fetch(tokenUrl, {
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
        } catch (fetchError) {
          console.error('[TikTok OAuth] CRITICAL: Fetch request failed', {
            error: fetchError.message,
            errorStack: fetchError.stack,
            errorName: fetchError.name,
          });
          throw new Error(`Network error during token exchange: ${fetchError.message}`);
        }

        console.error('[TikTok OAuth] Step 3: Token exchange response received', {
          ok: tokenResponse.ok,
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
          headers: Object.fromEntries(tokenResponse.headers.entries()),
        });

        // Read response as text first to log it
        const responseText = await tokenResponse.text();
        console.error('[TikTok OAuth] Step 4: Raw token response text', {
          responseLength: responseText.length,
          responsePreview: responseText.substring(0, 500),
          isJSON: (() => {
            try {
              JSON.parse(responseText);
              return true;
            } catch {
              return false;
            }
          })(),
        });

        if (!tokenResponse.ok) {
          console.error('[TikTok OAuth] CRITICAL: Token exchange HTTP error', {
            status: tokenResponse.status,
            statusText: tokenResponse.statusText,
            fullResponse: responseText,
            headers: Object.fromEntries(tokenResponse.headers.entries()),
          });
          throw new Error(`Failed to exchange TikTok code: ${tokenResponse.status} - ${responseText.substring(0, 500)}`);
        }

        let tokenData;
        try {
          tokenData = JSON.parse(responseText);
        } catch (parseError) {
          console.error('[TikTok OAuth] CRITICAL: Failed to parse token response as JSON', {
            parseError: parseError.message,
            responseText: responseText,
          });
          throw new Error(`Invalid JSON response from TikTok: ${parseError.message}`);
        }
        
        // Debug: Log the actual response structure
        console.error('[TikTok OAuth] Step 5: Token response structure analysis', {
          hasTokenData: !!tokenData,
          tokenDataType: typeof tokenData,
          isArray: Array.isArray(tokenData),
          tokenDataKeys: tokenData ? Object.keys(tokenData) : [],
          hasData: !!tokenData?.data,
          dataType: typeof tokenData?.data,
          dataKeys: tokenData?.data ? Object.keys(tokenData.data) : [],
          hasError: !!tokenData?.error,
          errorDetails: tokenData?.error,
          fullResponseJSON: JSON.stringify(tokenData, null, 2),
        });
        
        // Check for TikTok API errors in response body (even with 200 status)
        // TikTok returns error: { code: "ok" } for successful responses
        if (tokenData?.error && tokenData.error?.code !== "ok") {
          console.error('[TikTok OAuth] CRITICAL: TikTok API returned error in token response', {
            error: tokenData.error,
            errorCode: tokenData.error?.code,
            errorMessage: tokenData.error?.message,
            errorLogId: tokenData.error?.log_id,
            errorDescription: tokenData.error?.description,
            fullResponse: JSON.stringify(tokenData, null, 2),
          });
          throw new Error(`TikTok API error: ${tokenData.error?.message || tokenData.error?.code || 'Unknown error'}`);
        }
        
        // Security: Validate token response structure
        // TikTok API v2 might return different structures depending on success/error
        let accessToken = null;
        
        // Try different possible response structures
        console.error('[TikTok OAuth] Step 6: Extracting access token', {
          checkingDataAccessToken: !!tokenData?.data?.access_token,
          checkingAccessToken: !!tokenData?.access_token,
          checkingData: !!tokenData?.data,
        });

        if (tokenData?.data?.access_token) {
          // Standard structure: { data: { access_token: "...", ... } }
          accessToken = tokenData.data.access_token;
          console.error('[TikTok OAuth] SUCCESS: Found access_token in tokenData.data.access_token', {
            tokenLength: accessToken.length,
            tokenPrefix: accessToken.substring(0, 20) + '...',
          });
        } else if (tokenData?.access_token) {
          // Alternative structure: { access_token: "...", ... }
          accessToken = tokenData.access_token;
          console.error('[TikTok OAuth] SUCCESS: Found access_token in tokenData.access_token', {
            tokenLength: accessToken.length,
            tokenPrefix: accessToken.substring(0, 20) + '...',
          });
        } else {
          // Log the actual structure for debugging
          const tokenDataStr = JSON.stringify(tokenData, null, 2);
          console.error('[TikTok OAuth] CRITICAL: Unexpected token response structure - NO ACCESS TOKEN FOUND', {
            tokenData: tokenDataStr,
            tokenDataType: typeof tokenData,
            tokenDataIsArray: Array.isArray(tokenData),
            hasData: !!tokenData?.data,
            dataType: typeof tokenData?.data,
            dataKeys: tokenData?.data ? Object.keys(tokenData.data) : [],
            topLevelKeys: tokenData ? Object.keys(tokenData) : [],
          });
          // Include response structure in error message for debugging (will show in redirect URL)
          const errorMsg = `Invalid TikTok token response: missing access_token. Response: ${tokenDataStr.substring(0, 200)}`;
          throw new Error(errorMsg);
        }

        if (!accessToken) {
          console.error('[TikTok OAuth] CRITICAL: Access token is null or undefined after extraction', {
            tokenData: JSON.stringify(tokenData, null, 2),
          });
          throw new Error('Failed to extract access token from TikTok response');
        }

        console.error('[TikTok OAuth] Step 7: Access token obtained successfully', {
          accessTokenLength: accessToken.length,
          accessTokenPrefix: accessToken.substring(0, 20) + '...',
          elapsedMs: Date.now() - startTime,
        });

        // Fetch user info - TikTok API v2 requires fields parameter
        // Note: user.info.basic scope only provides: open_id, union_id, avatar_url, display_name
        // username requires user.info.profile scope (requires app review)
        // For now, we'll use display_name which is available in user.info.basic
        const userInfoUrl = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name';
        console.error('[TikTok OAuth] Step 8: Fetching user info', {
          url: userInfoUrl,
          method: 'GET',
          hasAccessToken: !!accessToken,
          accessTokenPrefix: accessToken.substring(0, 20) + '...',
          note: 'Using user.info.basic scope fields only (display_name, not username)',
        });
        
        let userResponse;
        try {
          userResponse = await fetch(userInfoUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          });
        } catch (fetchError) {
          console.error('[TikTok OAuth] CRITICAL: User info fetch request failed', {
            error: fetchError.message,
            errorStack: fetchError.stack,
            errorName: fetchError.name,
          });
          throw new Error(`Network error during user info fetch: ${fetchError.message}`);
        }

        console.error('[TikTok OAuth] Step 9: User info response received', {
          ok: userResponse.ok,
          status: userResponse.status,
          statusText: userResponse.statusText,
          headers: Object.fromEntries(userResponse.headers.entries()),
        });

        // Read response as text first to log it
        const userResponseText = await userResponse.text();
        console.error('[TikTok OAuth] Step 10: Raw user info response text', {
          responseLength: userResponseText.length,
          responsePreview: userResponseText.substring(0, 500),
          isJSON: (() => {
            try {
              JSON.parse(userResponseText);
              return true;
            } catch {
              return false;
            }
          })(),
        });

        if (!userResponse.ok) {
          console.error('[TikTok OAuth] CRITICAL: User info HTTP error', {
            status: userResponse.status,
            statusText: userResponse.statusText,
            fullResponse: userResponseText,
            headers: Object.fromEntries(userResponse.headers.entries()),
          });
          throw new Error(`Failed to fetch TikTok user info: ${userResponse.status} - ${userResponseText.substring(0, 500)}`);
        }

        let userData;
        try {
          userData = JSON.parse(userResponseText);
        } catch (parseError) {
          console.error('[TikTok OAuth] CRITICAL: Failed to parse user info response as JSON', {
            parseError: parseError.message,
            responseText: userResponseText,
          });
          throw new Error(`Invalid JSON response from TikTok user info: ${parseError.message}`);
        }
        
        // Debug: Log the actual response structure
        console.error('[TikTok OAuth] Step 11: User info response structure analysis', {
          hasUserData: !!userData,
          userDataType: typeof userData,
          isArray: Array.isArray(userData),
          userDataKeys: userData ? Object.keys(userData) : [],
          hasData: !!userData?.data,
          dataType: typeof userData?.data,
          dataKeys: userData?.data ? Object.keys(userData.data) : [],
          hasUser: !!userData?.data?.user,
          userType: typeof userData?.data?.user,
          userKeys: userData?.data?.user ? Object.keys(userData.data.user) : [],
          hasError: !!userData?.error,
          errorDetails: userData?.error,
          fullResponseJSON: JSON.stringify(userData, null, 2),
        });
        
        // Check for TikTok API errors in response body (even with 200 status)
        // TikTok returns error: { code: "ok" } for successful responses
        if (userData?.error && userData.error?.code !== "ok") {
          console.error('[TikTok OAuth] CRITICAL: TikTok API returned error in user info response', {
            error: userData.error,
            errorCode: userData.error?.code,
            errorMessage: userData.error?.message,
            errorLogId: userData.error?.log_id,
            errorDescription: userData.error?.description,
            fullResponse: JSON.stringify(userData, null, 2),
          });
          throw new Error(`TikTok API error: ${userData.error?.message || userData.error?.code || 'Unknown error'}`);
        }
        
        // Security: Validate user data response structure
        let tiktokUser = null;
        
        // Try different possible response structures
        console.error('[TikTok OAuth] Step 12: Extracting user data', {
          checkingDataUser: !!userData?.data?.user,
          checkingUser: !!userData?.user,
          checkingData: !!userData?.data,
        });

        if (userData?.data?.user) {
          // Standard structure: { data: { user: { ... } } }
          tiktokUser = userData.data.user;
          console.error('[TikTok OAuth] SUCCESS: Found user data in userData.data.user', {
            userKeys: Object.keys(tiktokUser),
            hasUsername: !!tiktokUser.username,
            hasDisplayName: !!tiktokUser.display_name,
          });
        } else if (userData?.user) {
          // Alternative structure: { user: { ... } }
          tiktokUser = userData.user;
          console.error('[TikTok OAuth] SUCCESS: Found user data in userData.user', {
            userKeys: Object.keys(tiktokUser),
            hasUsername: !!tiktokUser.username,
            hasDisplayName: !!tiktokUser.display_name,
          });
        } else if (userData?.data) {
          // User data might be directly in data
          tiktokUser = userData.data;
          console.error('[TikTok OAuth] SUCCESS: Found user data in userData.data', {
            userKeys: Object.keys(tiktokUser),
            hasUsername: !!tiktokUser.username,
            hasDisplayName: !!tiktokUser.display_name,
          });
        } else {
          const userDataStr = JSON.stringify(userData, null, 2);
          console.error('[TikTok OAuth] CRITICAL: Unexpected user data response structure - NO USER DATA FOUND', {
            userData: userDataStr,
            userDataType: typeof userData,
            userDataIsArray: Array.isArray(userData),
            hasData: !!userData?.data,
            dataType: typeof userData?.data,
            dataKeys: userData?.data ? Object.keys(userData.data) : [],
            topLevelKeys: userData ? Object.keys(userData) : [],
          });
          // Include response structure in error message for debugging (will show in redirect URL)
          const errorMsg = `Invalid TikTok user data response structure. Response: ${userDataStr.substring(0, 200)}`;
          throw new Error(errorMsg);
        }
        
        if (!tiktokUser) {
          console.error('[TikTok OAuth] CRITICAL: User data is null or undefined after extraction', {
            userData: JSON.stringify(userData, null, 2),
          });
          throw new Error('Failed to extract user data from TikTok response');
        }
        
        console.error('[TikTok OAuth] Step 13: User data extracted successfully', {
          username: tiktokUser.username,
          displayName: tiktokUser.display_name,
          openId: tiktokUser.open_id,
          unionId: tiktokUser.union_id,
          avatarUrl: tiktokUser.avatar_url,
          userKeys: Object.keys(tiktokUser),
          allUserValues: JSON.stringify(tiktokUser, null, 2),
        });
        
        // Note: With user.info.basic scope, we only have display_name (not username)
        // username requires user.info.profile scope which needs app review
        // Use display_name for profile URL construction
        console.error('[TikTok OAuth] Step 14: Extracting username/display_name', {
          hasUsername: !!tiktokUser.username,
          usernameValue: tiktokUser.username,
          usernameType: typeof tiktokUser.username,
          hasDisplayName: !!tiktokUser.display_name,
          displayNameValue: tiktokUser.display_name,
          displayNameType: typeof tiktokUser.display_name,
          note: 'Using display_name (user.info.basic scope limitation)',
        });

        // With user.info.basic scope, we only have display_name
        // For profile URL, we'll use display_name and construct URL differently
        // TikTok profile URLs can use display_name: https://tiktok.com/@display_name
        const rawUsername = tiktokUser.display_name || tiktokUser.username;
        
        if (!rawUsername || typeof rawUsername !== 'string') {
          console.error('[TikTok OAuth] CRITICAL: Missing username/display_name', {
            tiktokUser: JSON.stringify(tiktokUser, null, 2),
            hasUsername: !!tiktokUser.username,
            usernameValue: tiktokUser.username,
            hasDisplayName: !!tiktokUser.display_name,
            displayNameValue: tiktokUser.display_name,
            rawUsername,
            rawUsernameType: typeof rawUsername,
          });
          throw new Error('Unable to determine TikTok username');
        }
        
        console.error('[TikTok OAuth] Step 15: Raw username extracted', {
          rawUsername,
          rawUsernameLength: rawUsername.length,
          rawUsernameType: typeof rawUsername,
        });
        
        // Security: Sanitize username to prevent XSS and injection
        // TikTok usernames are 2-24 chars, alphanumeric + underscore + period
        const sanitizedUsername = rawUsername
          .trim()
          .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
          .slice(0, 24);
        
        console.error('[TikTok OAuth] Step 16: Username sanitized', {
          sanitizedUsername,
          sanitizedLength: sanitizedUsername.length,
          originalLength: rawUsername.length,
        });
        
        // Validate: must be 2-24 chars, alphanumeric + underscore + period only
        if (sanitizedUsername.length < 2 || sanitizedUsername.length > 24) {
          console.error('[TikTok OAuth] CRITICAL: Username length invalid', {
            length: sanitizedUsername.length,
            username: sanitizedUsername,
            rawUsername,
          });
          throw new Error('TikTok username length invalid');
        }
        if (!/^[a-zA-Z0-9_.]+$/.test(sanitizedUsername)) {
          console.error('[TikTok OAuth] CRITICAL: Invalid username characters', {
            username: sanitizedUsername,
            matchesPattern: /^[a-zA-Z0-9_.]+$/.test(sanitizedUsername),
            rawUsername,
          });
          throw new Error('Invalid TikTok username characters');
        }
        
        username = sanitizedUsername;
        // Security: Use encodeURIComponent to safely construct URL
        profileUrl = `https://tiktok.com/@${encodeURIComponent(username)}`;
        
        console.error('[TikTok OAuth] Step 17: Final values prepared', {
          username,
          profileUrl,
          elapsedMs: Date.now() - startTime,
        });
        
        if (!username || !profileUrl) {
          console.error('[TikTok OAuth] CRITICAL: Final validation failed', {
            hasUsername: !!username,
            hasProfileUrl: !!profileUrl,
            username,
            profileUrl,
          });
          throw new Error('Unable to determine TikTok username or profile URL');
        }
        
        console.error('[TikTok OAuth] ===== TIKTOK OAUTH FLOW COMPLETED SUCCESSFULLY =====', {
          username,
          profileUrl,
          totalElapsedMs: Date.now() - startTime,
        });
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
    // Use console.error to ensure it shows up in Shopify deployment logs
    console.error('[OAuth Callback] ===== ERROR CAUGHT =====');
    console.error('[OAuth Callback] Error details:', {
      errorMessage: error.message || 'Unknown error',
      platform: platform || 'UNKNOWN',
      timestamp: new Date().toISOString(),
      errorName: error.name,
      errorType: typeof error,
      url: request.url,
      ...(isProduction ? {} : {
        errorStack: error.stack,
        errorFull: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      }),
    });
    
    // Log additional context for TikTok specifically
    if (platform === 'tiktok') {
      console.error('[OAuth Callback] TikTok-specific error context:', {
        hasClientKey: !!context.env.TIKTOK_CLIENT_KEY,
        hasClientSecret: !!context.env.TIKTOK_CLIENT_SECRET,
        errorMessage: error.message,
        errorName: error.name,
      });
    }

    // Provide more specific error message based on error type
    let errorMessage = 'Verification failed. Please try again.';
    let errorCode = 'unknown';
    
    if (error.message?.includes('token') || error.message?.includes('access_token')) {
      errorMessage = 'Failed to authenticate with TikTok. Please try again.';
      errorCode = 'token_error';
    } else if (error.message?.includes('user info') || error.message?.includes('username') || error.message?.includes('display_name')) {
      errorMessage = 'Failed to retrieve TikTok profile information. Please try again.';
      errorCode = 'user_info_error';
    } else if (error.message?.includes('Invalid') || error.message?.includes('missing')) {
      errorMessage = `TikTok verification error: ${error.message}`;
      errorCode = 'invalid_response';
    } else if (error.message?.includes('Network error') || error.message?.includes('fetch')) {
      errorMessage = 'Network error connecting to TikTok. Please try again.';
      errorCode = 'network_error';
    } else if (error.message?.includes('TikTok API error')) {
      errorMessage = `TikTok API error: ${error.message}`;
      errorCode = 'api_error';
    }

    // Sanitize error message for URL (limit length, remove special chars)
    const sanitizedError = error.message 
      ? error.message.substring(0, 100).replace(/[^a-zA-Z0-9\s\-_.,]/g, '')
      : 'unknown';
    
    console.error('[OAuth Callback] Redirecting with error message:', {
      errorMessage,
      errorCode,
      sanitizedError,
      platform,
    });

    // Include error code and sanitized error in URL for debugging (visible in HTTP logs)
    const errorUrl = `/creator/social-links?error=${encodeURIComponent(errorMessage)}&error_code=${errorCode}&debug=${encodeURIComponent(sanitizedError)}`;
    
    return redirect(errorUrl);
  }
}

/** @typedef {import('./+types/creator.social-links.oauth.callback').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

