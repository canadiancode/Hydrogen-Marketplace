import {redirect} from 'react-router';
import {requireAuth, constantTimeEquals} from '~/lib/auth-helpers';
import {fetchCreatorProfile, createUserSupabaseClient, createServerSupabaseClient, getSupabaseSession} from '~/lib/supabase';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';
import {getOAuthState, deleteOAuthState} from '~/lib/oauth-state';

export const meta = () => {
  return [{title: 'WornVault | Verifying Social Account'}];
};

/**
 * OAuth callback handler for social media platform verification
 * Handles the OAuth redirect from various platforms and verifies account ownership
 */
export async function loader({context, request}) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:16',message:'OAuth callback loader started',data:{url:request.url},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  // Extract OAuth parameters first (before auth check) to handle errors and preserve for redirect
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:23',message:'OAuth callback params extracted',data:{hasCode:!!code,hasState:!!state,hasError:!!error,error,errorDescription},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  // Handle OAuth errors first (before auth check)
  if (error) {
    console.error('OAuth error:', error, errorDescription);
    return redirect(`/creator/social-links?error=${encodeURIComponent(errorDescription || error)}`);
  }

  // Validate state token FIRST (before auth check) - this doesn't require authentication
  // This allows us to preserve OAuth state even if session cookie isn't sent on redirect
  if (!state) {
    return redirect('/creator/social-links?error=invalid_state');
  }

  // Get OAuth state from Supabase WITHOUT deleting (we'll delete after successful completion)
  // This validates the state exists, isn't expired, and gives us creatorId
  // We don't delete yet because user might need to log in first
  const oauthStateData = await getOAuthState({
    state,
    supabaseUrl: context.env.SUPABASE_URL,
    supabaseServiceKey: context.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:43',message:'OAuth state retrieved',data:{hasOAuthState:!!oauthStateData,platform:oauthStateData?.platform,creatorId:oauthStateData?.creatorId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  if (!oauthStateData) {
    return redirect('/creator/social-links?error=invalid_state_expired');
  }

  const platform = oauthStateData.platform;
  const codeVerifier = oauthStateData.codeVerifier;
  const creatorId = oauthStateData.creatorId;
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:60',message:'OAuth state data extracted',data:{platform,hasCodeVerifier:!!codeVerifier,creatorId,hasCode:!!code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  if (!code) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:65',message:'OAuth callback missing code',data:{platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return redirect('/creator/social-links?error=no_code');
  }
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:70',message:'Code check passed, proceeding to auth',data:{platform,hasCode:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  // Check authentication WITHOUT throwing redirect (so we can preserve OAuth callback URL)
  const cookieHeader = request.headers.get('Cookie') || '';
  const urlMatch = context.env.SUPABASE_URL?.match(/https?:\/\/([^.]+)\.supabase\.co/);
  const projectRef = urlMatch ? urlMatch[1] : null;
  const expectedCookieName = projectRef ? `sb-${projectRef}-auth-token` : null;
  const hasExpectedCookie = expectedCookieName && cookieHeader.includes(expectedCookieName);
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:75',message:'Checking auth without throwing',data:{platform,hasCookies:!!cookieHeader,cookieLength:cookieHeader.length,hasExpectedCookie,expectedCookieName,projectRef},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // Use getSupabaseSession directly instead of requireAuth to avoid throwing redirect
  // This allows us to handle the redirect ourselves while preserving the full callback URL
  const isProduction = context.env.NODE_ENV === 'production';
  let user, session, needsRefresh;
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:87',message:'About to call getSupabaseSession',data:{platform,hasSupabaseUrl:!!context.env.SUPABASE_URL,hasAnonKey:!!context.env.SUPABASE_ANON_KEY,isProduction,hasExpectedCookie},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const result = await getSupabaseSession(
      request,
      context.env.SUPABASE_URL,
      context.env.SUPABASE_ANON_KEY,
      isProduction,
    );
    user = result.user;
    session = result.session;
    needsRefresh = result.needsRefresh;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:93',message:'getSupabaseSession completed',data:{hasUser:!!user,hasEmail:!!user?.email,hasSession:!!session,hasAccessToken:!!session?.access_token,platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
  } catch (authError) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:97',message:'getSupabaseSession error',data:{error:authError?.message||'Unknown error',platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    // If there's an error getting session, treat as not authenticated
    user = null;
    session = null;
    needsRefresh = false;
  }
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:105',message:'Auth check completed (non-throwing)',data:{hasUser:!!user,hasEmail:!!user?.email,hasSession:!!session,hasAccessToken:!!session?.access_token,platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:130',message:'Profile fetched (authenticated)',data:{hasProfile:!!profile,profileId:profile?.id,oauthCreatorId:creatorId,matches:profile?.id===creatorId,platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    if (profile && profile.id !== creatorId) {
      console.error('OAuth creator_id mismatch', {
        oauthCreatorId: creatorId,
        authenticatedCreatorId: profile.id,
        userEmail: user.email,
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:140',message:'OAuth callback creator_id mismatch',data:{oauthCreatorId:creatorId,authenticatedCreatorId:profile.id,platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      return redirect('/creator/social-links?error=authentication_mismatch');
    }
  } else {
    // Not authenticated - verify creatorId exists in database using service role
    // This allows OAuth to complete even if session cookie isn't sent
    // Security: OAuth state was stored when user was authenticated, so creatorId is trusted
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:148',message:'No service role key for unauthenticated OAuth',data:{platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      const fullCallbackUrl = request.url;
      return redirect(`/creator/login?returnTo=${encodeURIComponent(fullCallbackUrl)}&message=Please log in to complete social media connection`);
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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:162',message:'CreatorId verification (unauthenticated)',data:{hasCreatorData:!!creatorData,creatorError:creatorError?.message||null,creatorId,platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    if (creatorError || !creatorData) {
      console.error('CreatorId from OAuth state not found in database:', creatorId);
      return redirect('/creator/social-links?error=invalid_creator');
    }

    // Create a minimal profile object for the update logic below
    profile = {id: creatorId};
  }

  if (!profile || !profile.id) {
    console.error('Failed to get creator profile for OAuth callback');
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:175',message:'OAuth callback profile not found',data:{platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return redirect('/creator/social-links?error=profile_not_found');
  }

  // Rate limiting (after auth and state validation)
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `oauth-callback:${clientIP}`, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:106',message:'Rate limit check',data:{allowed:rateLimit.allowed,platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:120',message:'Entering platform switch',data:{platform,redirectUri},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:231',message:'X OAuth flow started',data:{platform,hasCodeVerifier:!!codeVerifier,creatorId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
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
          const errorText = await tokenResponse.text();
          console.error('Twitter token exchange error:', errorText);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:257',message:'X token exchange failed',data:{status:tokenResponse.status,errorText},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
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
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:271',message:'X user info fetch failed',data:{status:userResponse.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          throw new Error('Failed to fetch X user info');
        }

        const userData = await userResponse.json();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:359',message:'X API userData response structure',data:{userData,hasData:!!userData.data,dataKeys:userData.data?Object.keys(userData.data):null,usernamePath:userData.data?.username},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        username = userData.data?.username;
        profileUrl = username ? `https://x.com/${username}` : null;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:363',message:'X user info extracted',data:{username,profileUrl,hasUsername:!!username,hasProfileUrl:!!profileUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:494',message:'Before database update check',data:{username:!!username,profileUrl:!!profileUrl,hasProfile:!!profile,profileId:profile?.id,platform,hasSession:!!session,hasAccessToken:!!session?.access_token},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:387',message:'Attempting database update',data:{updates,profileId:profile.id,platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion

      const {error: updateError, data: updateData} = await supabase
        .from('creators')
        .update(updates)
        .eq('id', profile.id)
        .select();

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:488',message:'Database update result',data:{hasError:!!updateError,error:updateError?.message||null,errorCode:updateError?.code||null,errorDetails:updateError?.details||null,updatedRows:updateData?.length||0,updateData:updateData?.[0]||null,platform,updates},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      if (updateError) {
        console.error('Error updating social link:', updateError);
        return redirect('/creator/social-links?error=update_failed');
      }

      // Verify update was successful before deleting state
      if (!updateData || updateData.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:497',message:'Database update returned no rows',data:{platform,profileId:profile.id,updates},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        return redirect('/creator/social-links?error=update_failed_no_rows');
      }

      // NOW delete the OAuth state after successful completion
      await deleteOAuthState({
        state,
        supabaseUrl: context.env.SUPABASE_URL,
        supabaseServiceKey: context.env.SUPABASE_SERVICE_ROLE_KEY,
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:505',message:'Redirecting after successful update',data:{platform,profileId:profile.id,updatedData:updateData[0]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      return redirect('/creator/social-links?verified=true');
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/40458742-6beb-4ac1-a5c9-c5271b558de0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'creator.social-links.oauth.callback.jsx:408',message:'Verification failed - missing data',data:{username:!!username,profileUrl:!!profileUrl,hasProfile:!!profile,profileId:profile?.id,platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    return redirect('/creator/social-links?error=verification_failed');
  } catch (error) {
    // Don't delete state on error - allow retry
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

