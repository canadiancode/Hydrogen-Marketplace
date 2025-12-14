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
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase URL and service role key are required');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  
  return supabase;
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
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase URL and anon key are required');
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  
  return supabase;
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
  if (!supabaseUrl || !anonKey) {
    return {session: null, user: null};
  }

  // Create Supabase client
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Get cookies from request
  const cookieHeader = request.headers.get('Cookie') || '';
  
  // Extract project reference from Supabase URL
  // e.g., https://vpzktiosvxbusozfjhrx.supabase.co -> vpzktiosvxbusozfjhrx
  const urlMatch = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
  const projectRef = urlMatch ? urlMatch[1] : null;
  
  if (!projectRef) {
    console.warn('Could not extract project reference from Supabase URL');
    return {session: null, user: null};
  }

  // Supabase stores session in cookie: sb-<project-ref>-auth-token
  const cookieName = `sb-${projectRef}-auth-token`;
  
  // Parse cookies
  const cookies = cookieHeader
    .split(';')
    .map(c => c.trim())
    .reduce((acc, cookie) => {
      const [key, ...valueParts] = cookie.split('=');
      if (key && valueParts.length > 0) {
        acc[key] = decodeURIComponent(valueParts.join('='));
      }
      return acc;
    }, {});

  const authToken = cookies[cookieName];

  if (!authToken) {
    return {session: null, user: null};
  }

  try {
    // Parse the auth token cookie (it's a JSON string)
    const tokenData = JSON.parse(authToken);
    const accessToken = tokenData?.access_token;

    if (!accessToken) {
      return {session: null, user: null};
    }

    // Create a client with the access token to verify the session
    const userClient = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
    
    // Get the user to verify the token is valid
    const {data: {user}, error: userError} = await userClient.auth.getUser();

    if (userError || !user) {
      return {session: null, user: null};
    }

    // Construct session object from token data
    const session = {
      access_token: accessToken,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type || 'bearer',
      user,
    };

    return {session, user};
  } catch (error) {
    console.error('Error parsing Supabase auth token:', error);
    return {session: null, user: null};
  }
}

/**
 * Sends a magic link email via Supabase Auth
 * 
 * Best practices:
 * - Email confirmation should be enabled in Supabase dashboard
 * - Custom SMTP recommended for production
 * - Ensure database triggers are set up correctly
 * 
 * @param {string} email - User's email address
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} redirectTo - URL to redirect to after clicking magic link
 * @returns {Promise<{error: Error | null, data: object | null}>}
 */
export async function sendMagicLink(email, supabaseUrl, anonKey, redirectTo) {
  if (!email || !supabaseUrl || !anonKey) {
    return {
      error: new Error('Email, Supabase URL, and anon key are required'),
      data: null,
    };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      error: new Error('Invalid email format'),
      data: null,
    };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      // Don't require email confirmation for magic links (handled by Supabase)
      // But ensure email confirmation is enabled in Supabase dashboard
    },
  });
  
  try {
    const {data, error} = await supabase.auth.signInWithOtp({
      email: email.toLowerCase().trim(), // Normalize email
      options: {
        emailRedirectTo: redirectTo,
        // Allow new user signups
        shouldCreateUser: true,
      },
    });
    
    if (error) {
      // Provide more helpful error messages
      let errorMessage = error.message;
      
      if (error.message?.includes('Database error')) {
        errorMessage = 'Database configuration error. Please check Supabase dashboard settings. Ensure database triggers are set up correctly.';
      } else if (error.message?.includes('email')) {
        errorMessage = 'Email sending failed. Please check your email address and try again.';
      } else if (error.message?.includes('rate limit')) {
        errorMessage = 'Too many requests. Please wait a moment and try again.';
      }
      
      return {
        error: new Error(errorMessage),
        data: null,
      };
    }
    
    return {error: null, data};
  } catch (err) {
    console.error('Unexpected error sending magic link:', err);
    return {
      error: new Error('An unexpected error occurred. Please try again.'),
      data: null,
    };
  }
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
  if (!token || !type || !supabaseUrl || !anonKey) {
    return {
      session: null,
      user: null,
      error: new Error('Token, type, Supabase URL, and anon key are required'),
    };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  
  // Supabase magic links use token_hash parameter
  // The type is typically 'magiclink' or 'email'
  const {data, error} = await supabase.auth.verifyOtp({
    token_hash: token,
    type: type === 'magiclink' ? 'magiclink' : type,
  });
  
  if (error) {
    return {session: null, user: null, error};
  }
  
  return {session: data.session, user: data.user, error: null};
}

/**
 * Checks if a user is authenticated
 * 
 * @param {Request} request - The incoming request
 * @param {object} env - Environment variables
 * @returns {Promise<{isAuthenticated: boolean, user: User | null}>}
 */
export async function checkCreatorAuth(request, env) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
    return {isAuthenticated: false, user: null};
  }

  const {user} = await getSupabaseSession(
    request,
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
  );
  
  return {
    isAuthenticated: !!user,
    user,
  };
}

/**
 * Checks if a creator profile exists for the authenticated user
 * Uses email matching since schema links creators to auth via email
 * 
 * @param {string} email - User's email address
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @returns {Promise<{exists: boolean, creator: object | null}>}
 */
export async function checkCreatorProfileExists(email, supabaseUrl, anonKey, accessToken) {
  if (!email || !supabaseUrl || !anonKey || !accessToken) {
    return {exists: false, creator: null};
  }

  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
  
  // RLS will automatically filter by auth.email(), but we can also explicitly check by email
  // Using .single() since email is unique in the creators table
  const {data, error} = await supabase
    .from('creators')
    .select('id, email, display_name, handle, verification_status')
    .eq('email', email)
    .single();
  
  if (error || !data) {
    // If error is "PGRST116" (no rows returned), that's expected for new users
    if (error?.code === 'PGRST116') {
      return {exists: false, creator: null};
    }
    // Other errors might indicate a problem
    console.error('Error checking creator profile:', error);
    return {exists: false, creator: null};
  }
  
  return {exists: true, creator: data};
}

/**
 * Checks if a user is an admin
 * NOTE: Admin identification method needs to be determined
 * Options:
 * 1. Add is_admin boolean to creators table
 * 2. Create separate admins table
 * 3. Use specific email addresses/domain
 * 4. Use Supabase Auth metadata
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
  
  // // TODO: Implement admin check based on chosen method
  // // Option 1: Check is_admin flag in creators table (if added)
  // // Option 2: Check separate admins table
  // // Option 3: Check if email is in admin list
  // // Option 4: Check user metadata/claims
  
  // // Example for Option 1 (if is_admin column is added):
  // // const supabase = createUserSupabaseClient(
  // //   env.SUPABASE_URL,
  // //   env.SUPABASE_ANON_KEY,
  // //   user.access_token,
  // // );
  // // const {data} = await supabase
  // //   .from('creators')
  // //   .select('is_admin')
  // //   .eq('email', user.email)
  // //   .single();
  // // return {isAdmin: data?.is_admin === true, user};
  
  // Placeholder - uncomment when Supabase is installed and admin method is determined
  return {isAdmin: false, user: null};
}

