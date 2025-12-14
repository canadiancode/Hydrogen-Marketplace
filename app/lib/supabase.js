/**
 * Supabase Client Utilities for WornVault
 * 
 * This file provides server-side Supabase client creation and authentication helpers.
 * Supabase Auth is used for creator and admin authentication.
 * 
 * Setup Instructions:
 * 1. Install Supabase: npm install @supabase/supabase-js
 * 2. Add environment variables:
 *    - SUPABASE_URL
 *    - SUPABASE_ANON_KEY (for client-side)
 *    - SUPABASE_SERVICE_ROLE_KEY (for server-side admin operations)
 * 3. Configure Supabase Auth providers in Supabase dashboard
 */

import {createClient} from '@supabase/supabase-js';

/**
 * Creates a server-side Supabase client for use in loaders and actions
 * This client uses the service role key and bypasses RLS
 * Use only for admin operations or when RLS bypass is needed
 * 
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (server-side only)
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createServerSupabaseClient(supabaseUrl, serviceRoleKey) {
  // const supabase = createClient(supabaseUrl, serviceRoleKey, {
  //   auth: {
  //     autoRefreshToken: false,
  //     persistSession: false,
  //   },
  // });
  // return supabase;
  
  // Placeholder - uncomment when Supabase is installed
  return null;
}

/**
 * Creates a Supabase client for use with a user session
 * This client respects RLS policies based on the user's session
 * 
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token from session
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createUserSupabaseClient(supabaseUrl, anonKey, accessToken) {
  // const supabase = createClient(supabaseUrl, anonKey, {
  //   global: {
  //     headers: {
  //       Authorization: `Bearer ${accessToken}`,
  //     },
  //   },
  //   auth: {
  //     autoRefreshToken: false,
  //     persistSession: false,
  //   },
  // });
  // return supabase;
  
  // Placeholder - uncomment when Supabase is installed
  return null;
}

/**
 * Gets the Supabase session from the request
 * Reads the session from cookies or headers
 * 
 * @param {Request} request - The incoming request
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @returns {Promise<{session: Session | null, user: User | null}>}
 */
export async function getSupabaseSession(request, supabaseUrl, anonKey) {
  // const supabase = createClient(supabaseUrl, anonKey, {
  //   auth: {
  //     autoRefreshToken: false,
  //     persistSession: false,
  //   },
  // });
  
  // // Get session from cookies
  // const cookieHeader = request.headers.get('Cookie') || '';
  // const cookies = Object.fromEntries(
  //   cookieHeader.split(';').map(c => c.trim().split('='))
  // );
  
  // // Supabase stores session in sb-<project-ref>-auth-token cookie
  // const accessToken = cookies[`sb-${supabaseUrl.split('//')[1].split('.')[0]}-auth-token`];
  
  // if (accessToken) {
  //   const {data: {session}, error} = await supabase.auth.getSession();
  //   if (!error && session) {
  //     return {session, user: session.user};
  //   }
  // }
  
  // return {session: null, user: null};
  
  // Placeholder - uncomment when Supabase is installed
  return {session: null, user: null};
}

/**
 * Sends a magic link email via Supabase Auth
 * 
 * @param {string} email - User's email address
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} redirectTo - URL to redirect to after clicking magic link
 * @returns {Promise<{error: Error | null}>}
 */
export async function sendMagicLink(email, supabaseUrl, anonKey, redirectTo) {
  // const supabase = createClient(supabaseUrl, anonKey, {
  //   auth: {
  //     autoRefreshToken: false,
  //     persistSession: false,
  //   },
  // });
  
  // const {error} = await supabase.auth.signInWithOtp({
  //   email,
  //   options: {
  //     emailRedirectTo: redirectTo,
  //   },
  // });
  
  // return {error};
  
  // Placeholder - uncomment when Supabase is installed
  return {error: null};
}

/**
 * Initiates Google OAuth flow
 * 
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} redirectTo - URL to redirect to after OAuth
 * @returns {Promise<{url: string | null, error: Error | null}>}
 */
export async function initiateGoogleOAuth(supabaseUrl, anonKey, redirectTo) {
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  
  const {data, error} = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
    },
  });
  
  return {url: data?.url || null, error};
}

/**
 * Verifies a magic link token and creates a session
 * This is typically called from a callback route after user clicks magic link
 * 
 * @param {string} token - The token from the magic link
 * @param {string} type - The type of token (usually 'magiclink')
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @returns {Promise<{session: Session | null, user: User | null, error: Error | null}>}
 */
export async function verifyMagicLink(token, type, supabaseUrl, anonKey) {
  // const supabase = createClient(supabaseUrl, anonKey, {
  //   auth: {
  //     autoRefreshToken: false,
  //     persistSession: false,
  //   },
  // });
  
  // const {data, error} = await supabase.auth.verifyOtp({
  //   token_hash: token,
  //   type,
  // });
  
  // if (error) {
  //   return {session: null, user: null, error};
  // }
  
  // return {session: data.session, user: data.user, error: null};
  
  // Placeholder - uncomment when Supabase is installed
  return {session: null, user: null, error: null};
}

/**
 * Checks if a user is authenticated
 * 
 * @param {Request} request - The incoming request
 * @param {object} env - Environment variables
 * @returns {Promise<{isAuthenticated: boolean, user: User | null}>}
 */
export async function checkCreatorAuth(request, env) {
  // const {user} = await getSupabaseSession(
  //   request,
  //   env.SUPABASE_URL,
  //   env.SUPABASE_ANON_KEY,
  // );
  
  // return {
  //   isAuthenticated: !!user,
  //   user,
  // };
  
  // Placeholder - uncomment when Supabase is installed
  return {isAuthenticated: false, user: null};
}

/**
 * Checks if a user is an admin
 * Requires checking the database for admin flag
 * 
 * @param {Request} request - The incoming request
 * @param {object} env - Environment variables
 * @returns {Promise<{isAdmin: boolean, user: User | null}>}
 */
export async function checkAdminAuth(request, env) {
  // const {isAuthenticated, user} = await checkCreatorAuth(request, env);
  
  // if (!isAuthenticated || !user) {
  //   return {isAdmin: false, user: null};
  // }
  
  // // Check admin flag in database
  // const supabase = createUserSupabaseClient(
  //   env.SUPABASE_URL,
  //   env.SUPABASE_ANON_KEY,
  //   user.access_token,
  // );
  
  // const {data, error} = await supabase
  //   .from('creators')
  //   .select('is_admin')
  //   .eq('user_id', user.id)
  //   .single();
  
  // if (error || !data) {
  //   return {isAdmin: false, user};
  // }
  
  // return {isAdmin: data.is_admin === true, user};
  
  // Placeholder - uncomment when Supabase is installed
  return {isAdmin: false, user: null};
}

