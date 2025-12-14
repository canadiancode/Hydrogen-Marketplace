import {redirect} from 'react-router';
import {verifyMagicLink} from '~/lib/supabase';

/**
 * Callback route for Supabase Auth
 * Handles magic link verification and OAuth callbacks
 * 
 * Query parameters:
 * - token_hash: Magic link token (for email magic links)
 * - type: Token type (usually 'magiclink')
 * - code: OAuth code (for OAuth providers)
 * - provider_token: OAuth provider token
 */
export async function loader({request, context}) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const code = url.searchParams.get('code');
  
  const {env} = context;
  
  // Handle magic link verification
  if (tokenHash && type) {
    // const {session, user, error} = await verifyMagicLink(
    //   tokenHash,
    //   type,
    //   env.SUPABASE_URL,
    //   env.SUPABASE_ANON_KEY,
    // );
    
    // if (error || !session) {
    //   // Redirect to login with error
    //   return redirect('/creator/login?error=auth_failed');
    // }
    
    // // Set session cookie
    // // This will be handled by Supabase client-side SDK in production
    // // For now, we'll redirect to dashboard
    
    // // Check if creator profile exists
    // // If not, redirect to profile completion
    // const hasCreatorProfile = await checkCreatorProfileExists(user.id, env);
    // if (!hasCreatorProfile) {
    //   return redirect('/creator/signup?complete_profile=true');
    // }
    
    // Redirect to dashboard (will be replaced with actual logic)
    return redirect('/creator/dashboard');
  }
  
  // Handle OAuth callback (Google, etc.)
  if (code) {
    // OAuth flow completion is handled by Supabase client-side SDK
    // This route just redirects to dashboard after successful OAuth
    // const {session, user, error} = await handleOAuthCallback(code, env);
    
    // if (error || !session) {
    //   return redirect('/creator/login?error=oauth_failed');
    // }
    
    // Check if creator profile exists
    // const hasCreatorProfile = await checkCreatorProfileExists(user.id, env);
    // if (!hasCreatorProfile) {
    //   return redirect('/creator/signup?complete_profile=true');
    // }
    
    return redirect('/creator/dashboard');
  }
  
  // If no valid callback parameters, redirect to login
  return redirect('/creator/login?error=invalid_callback');
}

/** @typedef {import('./+types/creator.auth.callback').Route} Route */

