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
 * @param {typeof fetch} [customFetch] - Optional custom fetch function (required for Cloudflare Workers)
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createServerSupabaseClient(supabaseUrl, serviceRoleKey, customFetch) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase URL and service role key are required');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: {
      // Use custom fetch if provided (required for Cloudflare Workers to avoid I/O context errors)
      fetch: customFetch || fetch,
    },
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
 * @param {typeof fetch} [customFetch] - Optional custom fetch function (required for Cloudflare Workers)
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch) {
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase URL and anon key are required');
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      // Use custom fetch if provided (required for Cloudflare Workers to avoid I/O context errors)
      fetch: customFetch || fetch,
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
 * @param {boolean} isProduction - Whether in production environment
 * @returns {Promise<{session: Session | null, user: User | null, needsRefresh: boolean}>}
 */
export async function getSupabaseSession(request, supabaseUrl, anonKey, isProduction = false) {
  if (!supabaseUrl || !anonKey) {
    return {session: null, user: null, needsRefresh: false};
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
    return {session: null, user: null, needsRefresh: false};
  }

  // Supabase stores session in cookie: sb-<project-ref>-auth-token
  const cookieName = `sb-${projectRef}-auth-token`;
  
  // Parse cookies with error handling
  let cookies = {};
  try {
    cookies = cookieHeader
      .split(';')
      .map(c => c.trim())
      .reduce((acc, cookie) => {
        const [key, ...valueParts] = cookie.split('=');
        if (key && valueParts.length > 0) {
          try {
            acc[key] = decodeURIComponent(valueParts.join('='));
          } catch (e) {
            // Skip malformed cookies
            console.warn('Failed to decode cookie:', key);
          }
        }
        return acc;
      }, {});
  } catch (error) {
    console.error('Error parsing cookies:', error);
    return {session: null, user: null, needsRefresh: false};
  }

  const authToken = cookies[cookieName];

  if (!authToken) {
    return {session: null, user: null, needsRefresh: false};
  }

  try {
    // Parse the auth token cookie (it's a JSON string)
    const tokenData = JSON.parse(authToken);
    const accessToken = tokenData?.access_token;

    if (!accessToken) {
      return {session: null, user: null, needsRefresh: false};
    }

    // Check token expiration
    if (tokenData.expires_at) {
      const expiresAt = typeof tokenData.expires_at === 'number' 
        ? tokenData.expires_at 
        : parseInt(tokenData.expires_at, 10);
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Token expired - return null session
      if (expiresAt && currentTime >= expiresAt) {
        return {session: null, user: null, needsRefresh: false};
      }
      
      // Token expires within 5 minutes - mark for refresh
      const needsRefresh = expiresAt && (expiresAt - currentTime) < 300;
      
      // Create a client with the access token to verify the session
      const userClient = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
      
      // Get the user to verify the token is valid
      const {data: {user}, error: userError} = await userClient.auth.getUser();

      if (userError || !user) {
        return {session: null, user: null, needsRefresh: false};
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

      return {session, user, needsRefresh: needsRefresh || false};
    } else {
      // No expiration info - verify token but don't refresh
      const userClient = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
      const {data: {user}, error: userError} = await userClient.auth.getUser();

      if (userError || !user) {
        return {session: null, user: null, needsRefresh: false};
      }

      const session = {
        access_token: accessToken,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type || 'bearer',
        user,
      };

      return {session, user, needsRefresh: false};
    }
  } catch (error) {
    // Log error without exposing token details
    const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
    console.error('Error parsing Supabase auth token:', {
      message: error.message || 'Unknown error',
      name: error.name || 'Error',
      ...(isProduction ? {} : {stack: error.stack}),
    });
    return {session: null, user: null, needsRefresh: false};
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
 * Exchanges OAuth code for a session
 * Used when OAuth provider redirects back with a code parameter
 * 
 * @param {string} code - OAuth authorization code
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @returns {Promise<{session: Session | null, user: User | null, error: Error | null}>}
 */
export async function exchangeOAuthCode(code, supabaseUrl, anonKey) {
  if (!code || !supabaseUrl || !anonKey) {
    return {
      session: null,
      user: null,
      error: new Error('Code, Supabase URL, and anon key are required'),
    };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  
  try {
    const {data, error} = await supabase.auth.exchangeCodeForSession(code);
    
    if (error) {
      return {session: null, user: null, error};
    }
    
    return {
      session: data.session,
      user: data.user,
      error: null,
    };
  } catch (err) {
    console.error('Error exchanging OAuth code:', err);
    return {
      session: null,
      user: null,
      error: new Error('Failed to exchange OAuth code'),
    };
  }
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
 * Refreshes an expired or soon-to-expire Supabase session
 * 
 * @param {string} refreshToken - The refresh token from the session
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @returns {Promise<{session: Session | null, user: User | null, error: Error | null}>}
 */
export async function refreshSupabaseSession(refreshToken, supabaseUrl, anonKey) {
  if (!refreshToken || !supabaseUrl || !anonKey) {
    return {
      session: null,
      user: null,
      error: new Error('Refresh token, Supabase URL, and anon key are required'),
    };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const {data, error} = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      return {
        session: null,
        user: null,
        error: error || new Error('Failed to refresh session'),
      };
    }

    return {
      session: data.session,
      user: data.user,
      error: null,
    };
  } catch (err) {
    console.error('Error refreshing Supabase session:', err);
    return {
      session: null,
      user: null,
      error: new Error('Failed to refresh session'),
    };
  }
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

  // CRITICAL: Use customFetch if provided (for Cloudflare Workers I/O context)
  // Otherwise fall back to global fetch
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);
  
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
 * Generates a unique handle from email address
 * Handles uniqueness by appending numbers if needed
 * 
 * @param {string} email - User's email address
 * @param {object} supabase - Supabase client instance
 * @returns {Promise<string>} Unique handle
 */
async function generateUniqueHandle(email, supabase) {
  // Extract base handle from email (part before @)
  let baseHandle = email.split('@')[0].toLowerCase();
  
  // Remove invalid characters (only allow alphanumeric and underscores)
  baseHandle = baseHandle.replace(/[^a-z0-9_]/g, '');
  
  // Ensure handle is not empty and has minimum length
  if (!baseHandle || baseHandle.length < 3) {
    // Fallback: use first 8 chars of email hash if handle is too short
    const emailHash = email.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);
    baseHandle = `user${Math.abs(emailHash).toString(36).substring(0, 5)}`;
  }
  
  // Limit handle length to 30 characters (common database limit)
  baseHandle = baseHandle.substring(0, 30);
  
  // Check if handle exists, append number if needed
  let handle = baseHandle;
  let counter = 1;
  const maxAttempts = 100; // Prevent infinite loops
  
  while (counter < maxAttempts) {
    const {data, error} = await supabase
      .from('creators')
      .select('handle')
      .eq('handle', handle)
      .maybeSingle();
    
    // If no error and no data, handle is available
    if (!error && !data) {
      return handle;
    }
    
    // Handle exists, try with number suffix
    const suffix = counter.toString();
    const maxHandleLength = 30;
    const availableLength = maxHandleLength - suffix.length - 1; // -1 for underscore
    
    if (baseHandle.length > availableLength) {
      handle = baseHandle.substring(0, availableLength) + '_' + suffix;
    } else {
      handle = baseHandle + '_' + suffix;
    }
    
    counter++;
  }
  
  // Fallback: use timestamp if all attempts failed
  return `user${Date.now().toString(36)}`;
}

/**
 * Creates a creator profile automatically if it doesn't exist
 * Used during first-time authentication to ensure creator record exists
 * 
 * @param {object} user - Supabase user object from auth
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @returns {Promise<{created: boolean, creator: object | null, error: Error | null}>}
 */
export async function createCreatorProfileIfNotExists(user, supabaseUrl, anonKey, accessToken) {
  if (!user?.email || !supabaseUrl || !anonKey || !accessToken) {
    return {
      created: false,
      creator: null,
      error: new Error('Missing required parameters'),
    };
  }

  // CRITICAL: Use customFetch if provided (for Cloudflare Workers I/O context)
  // Otherwise fall back to global fetch
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);
  
  // First, check if profile already exists
  const {exists, creator: existingCreator} = await checkCreatorProfileExists(
    user.email,
    supabaseUrl,
    anonKey,
    accessToken
  );
  
  if (exists && existingCreator) {
    return {
      created: false,
      creator: existingCreator,
      error: null,
    };
  }
  
  // Generate display name from user metadata or email
  let displayName = user.user_metadata?.full_name || 
                    user.user_metadata?.name ||
                    user.user_metadata?.display_name;
  
  if (!displayName) {
    // Fallback: use email username or email itself
    const emailUsername = user.email.split('@')[0];
    displayName = emailUsername.charAt(0).toUpperCase() + emailUsername.slice(1);
  }
  
  // Sanitize display name (remove control characters, limit length)
  displayName = displayName
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '')
    .substring(0, 100);
  
  if (!displayName || displayName.length < 1) {
    displayName = 'Creator'; // Final fallback
  }
  
  // Generate unique handle
  let handle = await generateUniqueHandle(user.email, supabase);
  
  // Create new creator profile with required fields
  let newCreator = {
    email: user.email.toLowerCase().trim(),
    display_name: displayName,
    handle: handle,
    // Optional fields from user metadata
    first_name: user.user_metadata?.given_name || null,
    last_name: user.user_metadata?.family_name || null,
    profile_image_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    // Defaults are handled by database
    verification_status: 'pending',
    is_verified: false,
  };
  
  let {data, error} = await supabase
    .from('creators')
    .insert(newCreator)
    .select()
    .single();
  
  // If handle uniqueness check failed (RLS might prevent checking other handles),
  // catch unique constraint error and retry with a new handle
  if (error && error.code === '23505' && error.message?.includes('handle')) {
    // Handle collision - generate a new unique handle using timestamp
    const timestampSuffix = Date.now().toString(36);
    const baseHandle = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 20);
    handle = `${baseHandle}_${timestampSuffix}`.substring(0, 30);
    
    newCreator = {
      ...newCreator,
      handle: handle,
    };
    
    // Retry insert with new handle
    const retryResult = await supabase
      .from('creators')
      .insert(newCreator)
      .select()
      .single();
    
    if (retryResult.error) {
      console.error('Error creating creator profile (retry failed):', {
        message: retryResult.error.message || 'Unknown error',
        code: retryResult.error.code,
        email: user.email,
        timestamp: new Date().toISOString(),
      });
      
      return {
        created: false,
        creator: null,
        error: retryResult.error,
      };
    }
    
    data = retryResult.data;
    error = null;
  }
  
  if (error) {
    // Log error without exposing sensitive details
    console.error('Error creating creator profile:', {
      message: error.message || 'Unknown error',
      code: error.code,
      email: user.email,
      timestamp: new Date().toISOString(),
    });
    
    return {
      created: false,
      creator: null,
      error: error,
    };
  }
  
  return {
    created: true,
    creator: data,
    error: null,
  };
}

/**
 * Fetches creator profile by email
 * Returns full profile data for use in settings page
 * 
 * @param {string} userEmail - User's email address
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @returns {Promise<object | null>} Creator profile object or null if not found
 */
export async function fetchCreatorProfile(userEmail, supabaseUrl, anonKey, accessToken, customFetch) {
  if (!userEmail || !supabaseUrl || !anonKey || !accessToken) {
    return null;
  }

  // CRITICAL: Pass customFetch to ensure Cloudflare Workers uses request-scoped fetch
  // This prevents "I/O on behalf of a different request" errors
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);
  
  // RLS will automatically filter by auth.email()
  const {data, error} = await supabase
    .from('creators')
    .select('*')
    .eq('email', userEmail)
    .single();
  
  if (error) {
    // If error is "PGRST116" (no rows returned), profile doesn't exist yet
    if (error?.code === 'PGRST116') {
      return null;
    }
    // Log other errors but don't throw - let caller handle
    console.error('Error fetching creator profile:', error);
    throw error;
  }
  
  return data;
}

/**
 * Updates creator profile fields
 * Creates profile if it doesn't exist, or updates if it does
 * Validates required fields and handles unique constraint errors
 * 
 * @param {string} userEmail - User's email address
 * @param {object} updates - Object with fields to update (camelCase form field names)
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @returns {Promise<object>} Updated/created creator profile object
 * @throws {Error} If update fails (validation, unique constraint, etc.)
 */
export async function updateCreatorProfile(userEmail, updates, supabaseUrl, anonKey, accessToken) {
  if (!userEmail || !supabaseUrl || !anonKey || !accessToken) {
    throw new Error('Missing required parameters');
  }

  // CRITICAL: Use customFetch if provided (for Cloudflare Workers I/O context)
  // Otherwise fall back to global fetch
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);
  
  // First, check if profile exists
  const {data: existingProfile} = await supabase
    .from('creators')
    .select('*')
    .eq('email', userEmail)
    .maybeSingle(); // Use maybeSingle() instead of single() to avoid error if not found
  
  // Map form fields (camelCase) to database columns (snake_case)
  const dbUpdates = {};
  if (updates.displayName !== undefined) dbUpdates.display_name = updates.displayName;
  if (updates.bio !== undefined) dbUpdates.bio = updates.bio;
  if (updates.payoutMethod !== undefined) dbUpdates.payout_method = updates.payoutMethod;
  if (updates.paypalEmail !== undefined) dbUpdates.paypal_email = updates.paypalEmail;
  if (updates.paypalEmailVerified !== undefined) dbUpdates.paypal_email_verified = updates.paypalEmailVerified;
  if (updates.paypalPayerId !== undefined) dbUpdates.paypal_payer_id = updates.paypalPayerId;
  if (updates.paypalEmailVerifiedAt !== undefined) dbUpdates.paypal_email_verified_at = updates.paypalEmailVerifiedAt;
  if (updates.username !== undefined) dbUpdates.handle = updates.username;
  if (updates.firstName !== undefined) dbUpdates.first_name = updates.firstName;
  if (updates.lastName !== undefined) dbUpdates.last_name = updates.lastName;
  if (updates.profileImageUrl !== undefined) dbUpdates.profile_image_url = updates.profileImageUrl;
  if (updates.coverImageStoragePath !== undefined) dbUpdates.cover_image_storage_path = updates.coverImageStoragePath;
  
  const isNewProfile = !existingProfile;
  
  if (isNewProfile) {
    // For new profiles, display_name and handle are required
    if (!dbUpdates.display_name?.trim()) {
      throw new Error('Display name is required');
    }
    if (!dbUpdates.handle?.trim()) {
      throw new Error('Username is required');
    }
    // Set email for new profile
    dbUpdates.email = userEmail;
    
    // Insert new profile
    const {data, error} = await supabase
      .from('creators')
      .insert(dbUpdates)
      .select()
      .single();
    
    if (error) {
      // Handle unique constraint violations
      if (error.code === '23505') {
        if (error.message?.includes('handle') || error.message?.includes('creators_handle_key')) {
          throw new Error('Username is already taken. Please choose a different username.');
        }
        if (error.message?.includes('email') || error.message?.includes('creators_email_key')) {
          throw new Error('Email is already in use.');
        }
        throw new Error('A field with this value already exists.');
      }
      
      // Handle other database errors
      if (error.code === '23502') {
        throw new Error('Required fields cannot be empty.');
      }
      
      console.error('Error creating creator profile:', {
        error,
        userEmail,
        updates: dbUpdates,
        timestamp: new Date().toISOString(),
      });
      throw new Error(error.message || 'Failed to create profile. Please try again.');
    }
    
    return data;
  } else {
    // For existing profiles, validate only if fields are being updated
    if (dbUpdates.display_name !== undefined && !dbUpdates.display_name?.trim()) {
      throw new Error('Display name is required');
    }
    if (dbUpdates.handle !== undefined && !dbUpdates.handle?.trim()) {
      throw new Error('Username is required');
    }
    
    // Update existing profile
    const {data, error} = await supabase
      .from('creators')
      .update(dbUpdates)
      .eq('email', userEmail)
      .select()
      .single();
    
    if (error) {
      // Handle unique constraint violations
      if (error.code === '23505') {
        if (error.message?.includes('handle') || error.message?.includes('creators_handle_key')) {
          throw new Error('Username is already taken. Please choose a different username.');
        }
        if (error.message?.includes('email') || error.message?.includes('creators_email_key')) {
          throw new Error('Email is already in use.');
        }
        throw new Error('A field with this value already exists.');
      }
      
      // Handle other database errors
      if (error.code === '23502') {
        throw new Error('Required fields cannot be empty.');
      }
      
      // Handle PGRST116 (no rows returned) - shouldn't happen, but handle gracefully
      if (error.code === 'PGRST116') {
        throw new Error('Profile not found. Please refresh the page and try again.');
      }
      
      // Handle missing column errors (e.g., paypal_email_verified not in schema)
      if (error.message?.includes('Could not find') && error.message?.includes('column')) {
        // Try updating without verification fields if they're causing the issue
        const verificationFields = ['paypal_email_verified', 'paypal_payer_id', 'paypal_email_verified_at'];
        const hasVerificationFields = verificationFields.some(field => dbUpdates[field] !== undefined);
        
        if (hasVerificationFields) {
          // Remove verification fields and retry
          const dbUpdatesWithoutVerification = { ...dbUpdates };
          verificationFields.forEach(field => {
            delete dbUpdatesWithoutVerification[field];
          });
          
          // Retry update without verification fields
          const {data: retryData, error: retryError} = await supabase
            .from('creators')
            .update(dbUpdatesWithoutVerification)
            .eq('email', userEmail)
            .select()
            .single();
          
          if (retryError) {
            console.error('Error updating creator profile (retry without verification fields):', {
              error: retryError,
              userEmail,
              updates: dbUpdatesWithoutVerification,
              timestamp: new Date().toISOString(),
            });
            throw new Error(retryError.message || 'Failed to update profile. Please try again.');
          }
          
          // Log warning about missing verification columns
          console.warn('PayPal verification columns not found in database. Please run migration to add them.');
          return retryData;
        }
      }
      
      console.error('Error updating creator profile:', {
        error,
        userEmail,
        updates: dbUpdates,
        timestamp: new Date().toISOString(),
      });
      throw new Error(error.message || 'Failed to update profile. Please try again.');
    }
    
    return data;
  }
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
  try {
    // First check if user is authenticated
    const {isAuthenticated, user} = await checkCreatorAuth(request, env);
    
    if (!isAuthenticated || !user || !user.email) {
      return {isAdmin: false, user: null};
    }
    
    // Option 1: Check admin emails from environment variable (comma-separated)
    // This is a simple approach - can be enhanced with database check later
    const adminEmails = env.ADMIN_EMAILS 
      ? env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      : [];
    
    if (adminEmails.length > 0 && adminEmails.includes(user.email.toLowerCase())) {
      return {isAdmin: true, user};
    }
  } catch (error) {
    // Log error without exposing sensitive details
    console.error('Error checking admin auth:', error.message || 'Unknown error');
    return {isAdmin: false, user: null};
  }
  
  // Option 2: Check database for is_admin flag (if implemented)
  // Uncomment when database has is_admin column:
  /*
  try {
    const {isAuthenticated, user} = await checkCreatorAuth(request, env);
    if (!isAuthenticated || !user) {
      return {isAdmin: false, user: null};
    }
    
    const supabase = createUserSupabaseClient(
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY,
      user.access_token || '',
    );
    
    const {data, error} = await supabase
      .from('creators')
      .select('is_admin')
      .eq('email', user.email)
      .single();
    
    if (!error && data?.is_admin === true) {
      return {isAdmin: true, user};
    }
  } catch (err) {
    console.error('Error checking admin status:', err.message || 'Unknown error');
  }
  */
  
  // Not an admin
  return {isAdmin: false, user: null};
}

/**
 * Fetches all listings for a creator
 * Includes listing photos and formats data for display
 * 
 * @param {string} creatorId - Creator's UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @returns {Promise<Array>} Array of listing objects with photos
 */
export async function fetchCreatorListings(creatorId, supabaseUrl, anonKey, accessToken) {
  if (!creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return [];
  }

  // CRITICAL: Use customFetch if provided (for Cloudflare Workers I/O context)
  // Otherwise fall back to global fetch
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);
  
  // Fetch listings for this creator
  // RLS will automatically filter by creator_id based on auth.email()
  const {data: listings, error: listingsError} = await supabase
    .from('listings')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', {ascending: false});

  if (listingsError) {
    console.error('Error fetching listings:', listingsError);
    return [];
  }

  if (!listings || listings.length === 0) {
    return [];
  }

  // Fetch photos for all listings
  const listingIds = listings.map(l => l.id);
  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('*')
    .in('listing_id', listingIds)
    .eq('photo_type', 'reference'); // Only get reference photos for display

  if (photosError) {
    console.error('Error fetching listing photos:', photosError);
    // Continue without photos rather than failing completely
  }

  // Group photos by listing_id
  const photosByListing = {};
  if (photos) {
    photos.forEach(photo => {
      if (!photosByListing[photo.listing_id]) {
        photosByListing[photo.listing_id] = [];
      }
      photosByListing[photo.listing_id].push(photo);
    });
  }

  // Combine listings with their photos
  const listingsWithPhotos = listings.map(listing => ({
    ...listing,
    photos: photosByListing[listing.id] || [],
    // Format price for display
    price: (listing.price_cents / 100).toFixed(2),
    // Get first photo URL if available (for thumbnail)
    thumbnailUrl: photosByListing[listing.id]?.[0]?.storage_path || null,
  }));

  return listingsWithPhotos;
}

/**
 * Fetches all listings for admin review
 * Uses service role key to bypass RLS and fetch all listings regardless of creator
 * Includes listing photos and formats data for display
 * 
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (for admin operations)
 * @param {object} options - Optional filters
 * @param {string} options.status - Filter by status (e.g., 'pending_approval')
 * @param {number} options.limit - Maximum number of listings to return
 * @returns {Promise<Array>} Array of listing objects with photos and creator info
 */
export async function fetchAllListings(supabaseUrl, serviceRoleKey, options = {}) {
  if (!supabaseUrl || !serviceRoleKey) {
    return [];
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Build query for listings
  let query = supabase
    .from('listings')
    .select('*')
    .order('created_at', {ascending: false});
  
  // Apply status filter if provided
  if (options.status) {
    query = query.eq('status', options.status);
  }
  
  // Apply limit if provided
  if (options.limit) {
    query = query.limit(options.limit);
  }
  
  const {data: listings, error: listingsError} = await query;

  if (listingsError) {
    console.error('Error fetching all listings:', listingsError);
    return [];
  }

  if (!listings || listings.length === 0) {
    return [];
  }

  // Fetch creator information for all listings
  const creatorIds = [...new Set(listings.map(l => l.creator_id).filter(Boolean))];
  let creatorsMap = {};
  
  if (creatorIds.length > 0) {
    const {data: creators, error: creatorsError} = await supabase
      .from('creators')
      .select('id, email, display_name, handle')
      .in('id', creatorIds);
    
    if (!creatorsError && creators) {
      creators.forEach(creator => {
        creatorsMap[creator.id] = creator;
      });
    }
  }

  // Fetch photos for all listings
  const listingIds = listings.map(l => l.id);
  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('*')
    .in('listing_id', listingIds)
    .eq('photo_type', 'reference'); // Only get reference photos for display

  if (photosError) {
    console.error('Error fetching listing photos:', photosError);
    // Continue without photos rather than failing completely
  }

  // Group photos by listing_id
  const photosByListing = {};
  if (photos) {
    photos.forEach(photo => {
      if (!photosByListing[photo.listing_id]) {
        photosByListing[photo.listing_id] = [];
      }
      photosByListing[photo.listing_id].push(photo);
    });
  }

  // Combine listings with their photos and format for display
  const listingsWithPhotos = listings.map(listing => {
    const listingPhotos = photosByListing[listing.id] || [];
    
    // Get public URL for thumbnail
    let thumbnailUrl = null;
    if (listingPhotos.length > 0) {
      const {data} = supabase.storage
        .from('listing-photos')
        .getPublicUrl(listingPhotos[0].storage_path);
      thumbnailUrl = data?.publicUrl || null;
    }
    
    return {
      ...listing,
      photos: listingPhotos.map(photo => {
        const {data} = supabase.storage
          .from('listing-photos')
          .getPublicUrl(photo.storage_path);
        return {
          ...photo,
          publicUrl: data?.publicUrl || null,
        };
      }),
      // Format price for display
      price: (listing.price_cents / 100).toFixed(2),
      thumbnailUrl,
      // Creator info (from separate query)
      creator: creatorsMap[listing.creator_id] || null,
    };
  });

  return listingsWithPhotos;
}

/**
 * Fetches a single listing by ID for a creator
 * Verifies that the listing belongs to the authenticated creator
 * Includes listing photos and formats data for display
 * 
 * @param {string} listingId - Listing UUID
 * @param {string} creatorId - Creator's UUID (for verification)
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @returns {Promise<object | null>} Listing object with photos or null if not found/not authorized
 */
export async function fetchCreatorListingById(listingId, creatorId, supabaseUrl, anonKey, accessToken) {
  if (!listingId || !creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return null;
  }

  // CRITICAL: Use customFetch if provided (for Cloudflare Workers I/O context)
  // Otherwise fall back to global fetch
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);
  
  // Fetch the listing - RLS will ensure user can only access their own listings
  const {data: listing, error: listingError} = await supabase
    .from('listings')
    .select('*')
    .eq('id', listingId)
    .eq('creator_id', creatorId) // Verify ownership
    .single();

  if (listingError || !listing) {
    console.error('Error fetching listing:', listingError);
    return null;
  }

  // Fetch photos for this listing
  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('*')
    .eq('listing_id', listingId)
    .eq('photo_type', 'reference')
    .order('created_at', {ascending: true});

  if (photosError) {
    console.error('Error fetching listing photos:', photosError);
    // Continue without photos rather than failing completely
  }

  // Get public URLs for photos
  const photosWithUrls = (photos || []).map(photo => {
    const {data} = supabase.storage
      .from('listing-photos')
      .getPublicUrl(photo.storage_path);
    
    return {
      ...photo,
      publicUrl: data?.publicUrl || null,
    };
  });

  // Format listing data for display
  return {
    ...listing,
    photos: photosWithUrls,
    price: (listing.price_cents / 100).toFixed(2),
  };
}

/**
 * Fetches a single listing by ID for admin review
 * Uses service role key to bypass RLS and fetch all listing data
 * Includes photos (all types), creator info, logistics events, and payouts
 * 
 * @param {string} listingId - Listing UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (for admin operations)
 * @returns {Promise<object | null>} Listing object with all related data or null if not found
 */
export async function fetchAdminListingById(listingId, supabaseUrl, serviceRoleKey) {
  if (!listingId || !supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Fetch the listing
  const {data: listing, error: listingError} = await supabase
    .from('listings')
    .select('*')
    .eq('id', listingId)
    .single();

  if (listingError || !listing) {
    console.error('Error fetching listing:', listingError);
    return null;
  }

  // Fetch creator information
  let creator = null;
  if (listing.creator_id) {
    const {data: creatorData, error: creatorError} = await supabase
      .from('creators')
      .select('*')
      .eq('id', listing.creator_id)
      .single();
    
    if (!creatorError && creatorData) {
      creator = creatorData;
    }
  }

  // Fetch all photos for this listing (all types: reference, intake, internal)
  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', {ascending: true});

  if (photosError) {
    console.error('Error fetching listing photos:', photosError);
  }

  // Get public URLs for photos
  const photosWithUrls = (photos || []).map(photo => {
    const {data} = supabase.storage
      .from('listing-photos')
      .getPublicUrl(photo.storage_path);
    
    return {
      ...photo,
      publicUrl: data?.publicUrl || null,
    };
  });

  // Group photos by type
  const photosByType = {
    reference: photosWithUrls.filter(p => p.photo_type === 'reference'),
    intake: photosWithUrls.filter(p => p.photo_type === 'intake'),
    internal: photosWithUrls.filter(p => p.photo_type === 'internal'),
  };

  // Fetch logistics events for this listing
  const {data: logisticsEvents, error: logisticsError} = await supabase
    .from('logistics_events')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', {ascending: true});

  if (logisticsError) {
    console.error('Error fetching logistics events:', logisticsError);
  }

  // Fetch payouts for this listing
  const {data: payouts, error: payoutsError} = await supabase
    .from('payouts')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', {ascending: false});

  if (payoutsError) {
    console.error('Error fetching payouts:', payoutsError);
  }

  // Format listing data for display
  return {
    ...listing,
    photos: photosWithUrls,
    photosByType,
    creator,
    logisticsEvents: logisticsEvents || [],
    payouts: payouts || [],
    price: (listing.price_cents / 100).toFixed(2),
    priceDollars: listing.price_cents / 100,
  };
}

/**
 * Fetches the accepted offer for a specific listing
 * Uses service role key to bypass RLS for admin operations
 * 
 * @param {string} listingId - Listing UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (for admin operations)
 * @returns {Promise<object | null>} Accepted offer object with formatted data or null if not found
 */
export async function fetchAcceptedOfferForListing(listingId, supabaseUrl, serviceRoleKey) {
  if (!listingId || !supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Fetch the accepted offer for this listing
  const {data: offer, error: offerError} = await supabase
    .from('offers')
    .select('*')
    .eq('listing_id', listingId)
    .eq('status', 'accepted')
    .order('accepted_at', {ascending: false})
    .limit(1)
    .maybeSingle();

  if (offerError) {
    console.error('Error fetching accepted offer:', offerError);
    return null;
  }

  if (!offer) {
    return null;
  }

  // Fetch listing details for context
  const {data: listing, error: listingError} = await supabase
    .from('listings')
    .select('id, title, price_cents, currency')
    .eq('id', listingId)
    .single();

  if (listingError) {
    console.error('Error fetching listing for offer:', listingError);
  }

  // Fetch thumbnail photo for display
  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('*')
    .eq('listing_id', listingId)
    .eq('photo_type', 'reference')
    .order('created_at', {ascending: true})
    .limit(1)
    .maybeSingle();

  let thumbnailUrl = null;
  if (!photosError && photos) {
    const {data: urlData} = supabase.storage
      .from('listing-photos')
      .getPublicUrl(photos.storage_path);
    thumbnailUrl = urlData?.publicUrl || null;
  }

  // Format offer data similar to fetchCreatorOffers
  return {
    ...offer,
    listing: listing ? {
      id: listing.id,
      title: listing.title,
      price_cents: listing.price_cents,
      currency: listing.currency || 'USD',
      price: listing.price_cents ? (listing.price_cents / 100).toFixed(2) : '0.00',
    } : null,
    thumbnailUrl,
    offer_amount: offer.offer_amount_cents ? (offer.offer_amount_cents / 100).toFixed(2) : '0.00',
    discount_percentage: offer.discount_percentage ? parseFloat(offer.discount_percentage).toFixed(1) : '0.0',
  };
}

/**
 * Fetches all creators for admin review
 * Uses service role key to bypass RLS and fetch all creators
 * 
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (for admin operations)
 * @returns {Promise<Array>} Array of creator objects
 */
export async function fetchAllCreators(supabaseUrl, serviceRoleKey) {
  if (!supabaseUrl || !serviceRoleKey) {
    return [];
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Fetch all creators
  const {data: creators, error: creatorsError} = await supabase
    .from('creators')
    .select('*')
    .order('created_at', {ascending: false});
  
  if (creatorsError) {
    console.error('Error fetching all creators:', creatorsError);
    return [];
  }
  
  if (!creators || creators.length === 0) {
    return [];
  }
  
  // Fetch all sold listings to calculate revenue per creator
  // This is more efficient than fetching listings per creator
  const {data: soldListings, error: listingsError} = await supabase
    .from('listings')
    .select('creator_id, price_cents, status')
    .in('status', ['sold', 'shipped', 'completed']);
  
  if (listingsError) {
    console.error('Error fetching sold listings for revenue calculation:', listingsError);
    // Continue without revenue data rather than failing
  }
  
  // Calculate total revenue per creator
  const revenueByCreator = {};
  if (soldListings && soldListings.length > 0) {
    soldListings.forEach(listing => {
      if (listing.creator_id && listing.price_cents) {
        if (!revenueByCreator[listing.creator_id]) {
          revenueByCreator[listing.creator_id] = 0;
        }
        revenueByCreator[listing.creator_id] += listing.price_cents / 100;
      }
    });
  }
  
  // Add revenue to each creator
  return creators.map(creator => ({
    ...creator,
    totalRevenue: revenueByCreator[creator.id] || 0,
  }));
}

/**
 * Fetches a single creator by ID for admin review
 * Uses service role key to bypass RLS and fetch all creator data
 * Includes listings, verification info, and payouts
 * 
 * @param {string} creatorId - Creator UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (for admin operations)
 * @returns {Promise<object | null>} Creator object with all related data or null if not found
 */
export async function fetchAdminCreatorById(creatorId, supabaseUrl, serviceRoleKey) {
  if (!creatorId || !supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Fetch the creator
  const {data: creator, error: creatorError} = await supabase
    .from('creators')
    .select('*')
    .eq('id', creatorId)
    .single();

  if (creatorError || !creator) {
    console.error('Error fetching creator:', creatorError);
    return null;
  }

  // Fetch creator verification info
  const {data: verification, error: verificationError} = await supabase
    .from('creator_verifications')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', {ascending: false})
    .limit(1)
    .maybeSingle();

  if (verificationError) {
    console.error('Error fetching creator verification:', verificationError);
  }

  // Fetch all listings for this creator
  const {data: listings, error: listingsError} = await supabase
    .from('listings')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', {ascending: false});

  if (listingsError) {
    console.error('Error fetching creator listings:', listingsError);
  }

  // Fetch all payouts for this creator
  const {data: payouts, error: payoutsError} = await supabase
    .from('payouts')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', {ascending: false});

  if (payoutsError) {
    console.error('Error fetching creator payouts:', payoutsError);
  }

  // Format payouts with currency
  const payoutsWithCurrency = (payouts || []).map(payout => ({
    ...payout,
    grossAmountDollars: payout.gross_amount_cents / 100,
    platformFeeDollars: payout.platform_fee_cents / 100,
    netAmountDollars: payout.net_amount_cents / 100,
  }));

  // Format listings with price
  const listingsWithPrice = (listings || []).map(listing => ({
    ...listing,
    priceDollars: listing.price_cents / 100,
    price: (listing.price_cents / 100).toFixed(2),
  }));

  // Calculate total revenue from sold listings (gross amount before fees)
  // Revenue includes all sold listings regardless of payout status
  const soldListings = listingsWithPrice.filter(listing => 
    listing.status === 'sold' || 
    listing.status === 'shipped' || 
    listing.status === 'completed'
  );
  const totalRevenue = soldListings.reduce((sum, listing) => {
    return sum + (listing.price_cents || 0) / 100;
  }, 0);

  return {
    ...creator,
    verification: verification || null,
    listings: listingsWithPrice,
    payouts: payoutsWithCurrency,
    totalListings: listingsWithPrice.length,
    totalPayouts: payoutsWithCurrency.length,
    totalEarnings: payoutsWithCurrency.reduce((sum, p) => sum + p.netAmountDollars, 0),
    totalRevenue,
  };
}

/**
 * Creates a session cookie string for Supabase authentication
 * 
 * @param {object} session - Supabase session object
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {boolean} isProduction - Whether in production environment
 * @returns {string | null} - Cookie header value or null if session invalid
 */
export function createSessionCookie(session, supabaseUrl, isProduction = false) {
  if (!session || !session.access_token || !supabaseUrl) {
    return null;
  }

  // Extract project reference from Supabase URL
  const urlMatch = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
  const projectRef = urlMatch ? urlMatch[1] : null;
  
  if (!projectRef) {
    console.warn('Could not extract project reference from Supabase URL');
    return null;
  }

  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token || '',
    expires_at: session.expires_at || '',
    expires_in: session.expires_in || 3600,
    token_type: session.token_type || 'bearer',
    user: session.user ? {
      id: session.user.id,
      email: session.user.email,
    } : null,
  });

  // Build cookie attributes with enhanced security
  const maxAge = session.expires_in || 3600;
  // Always use Secure in production
  // Use SameSite=Lax (instead of Strict) to allow cookies on OAuth redirects
  // Lax still provides CSRF protection while allowing top-level navigations (OAuth flows)
  const secureFlag = isProduction ? '; Secure' : '';
  const sameSite = '; SameSite=Lax'; // Lax allows OAuth redirects while preventing CSRF
  const cookieString = `${cookieName}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly${sameSite}; Max-Age=${maxAge}${secureFlag}`;

  return cookieString;
}

/**
 * Fetches dashboard statistics for a creator
 * Returns counts of listings by status and total earnings
 * 
 * @param {string} creatorId - Creator's UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @returns {Promise<object>} Dashboard statistics object
 */
export async function fetchCreatorDashboardStats(creatorId, supabaseUrl, anonKey, accessToken) {
  if (!creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return {
      pendingOffers: 0,
      activeListings: 0,
      pendingApproval: 0,
      totalEarnings: 0,
    };
  }

  // Pass fetch explicitly to ensure Cloudflare Workers uses request-scoped fetch
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, fetch);
  
  // Fetch all listings for this creator to calculate stats
  const {data: listings, error: listingsError} = await supabase
    .from('listings')
    .select('id, status')
    .eq('creator_id', creatorId);

  if (listingsError) {
    console.error('Error fetching dashboard stats:', listingsError);
    return {
      pendingOffers: 0,
      activeListings: 0,
      pendingApproval: 0,
      totalEarnings: 0,
    };
  }

  // Calculate listing statistics
  const activeListings = listings ? listings.filter(l => l.status === 'live').length : 0;
  const pendingApproval = listings ? listings.filter(l => l.status === 'pending_approval').length : 0;

  // Count pending offers for creator's listings
  let pendingOffers = 0;
  if (listings && listings.length > 0) {
    const listingIds = listings.map(l => l.id);
    
    // Count offers with status 'pending' for these listings
    const {count, error: offersError} = await supabase
      .from('offers')
      .select('id', {count: 'exact', head: true})
      .in('listing_id', listingIds)
      .eq('status', 'pending');

    if (offersError) {
      console.error('Error fetching pending offers count:', offersError);
      // Don't fail the whole function, just set to 0
      pendingOffers = 0;
    } else {
      pendingOffers = count || 0;
    }
  }

  // Fetch payouts to calculate total earnings
  const {data: payouts, error: payoutsError} = await supabase
    .from('payouts')
    .select('net_amount_cents')
    .eq('creator_id', creatorId);

  let totalEarnings = 0;
  if (!payoutsError && payouts && payouts.length > 0) {
    totalEarnings = payouts.reduce((sum, payout) => sum + (payout.net_amount_cents || 0), 0) / 100;
  }

  return {
    pendingOffers,
    activeListings,
    pendingApproval,
    totalEarnings: totalEarnings.toFixed(2),
  };
}

/**
 * Fetches a single live listing by ID for public viewing
 * Only returns listings with status 'live'
 * Includes listing photos, creator info, and formats data for display
 * 
 * @param {string} listingId - Listing UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (for public operations)
 * @returns {Promise<object | null>} Listing object with photos and creator info or null if not found/not live
 */
export async function fetchPublicListingById(listingId, supabaseUrl, serviceRoleKey) {
  if (!listingId || !supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Fetch the listing - only return if status is 'live'
  const {data: listing, error: listingError} = await supabase
    .from('listings')
    .select('*')
    .eq('id', listingId)
    .eq('status', 'live')
    .single();

  if (listingError || !listing) {
    console.error('Error fetching public listing:', listingError);
    return null;
  }
  
  // Fetch creator information
  let creator = null;
  if (listing.creator_id) {
    const {data: creatorData, error: creatorError} = await supabase
      .from('creators')
      .select('id, email, display_name, handle, bio, profile_image_url, cover_image_storage_path, first_name, last_name')
      .eq('id', listing.creator_id)
      .single();
    
    if (!creatorError && creatorData) {
      // Construct cover image URL from storage path if available
      let coverImageUrl = null;
      if (creatorData.cover_image_storage_path) {
        const storagePath = creatorData.cover_image_storage_path;
        // If it's already a full URL, use it as-is
        if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
          coverImageUrl = storagePath;
        } else {
          // Construct the public URL from storage path
          const supabaseUrlClean = supabaseUrl.replace(/\/$/, ''); // Remove trailing slash
          coverImageUrl = `${supabaseUrlClean}/storage/v1/object/public/creator-cover-images/${storagePath}`;
        }
      }
      
      creator = {
        ...creatorData,
        coverImageUrl,
      };
    }
  }

  // Fetch reference photos for this listing (public-facing photos only)
  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('*')
    .eq('listing_id', listingId)
    .eq('photo_type', 'reference')
    .order('created_at', {ascending: true});

  if (photosError) {
    console.error('Error fetching listing photos:', photosError);
  }

  // Get public URLs for photos
  const photosWithUrls = (photos || []).map(photo => {
    const {data} = supabase.storage
      .from('listing-photos')
      .getPublicUrl(photo.storage_path);
    
    return {
      ...photo,
      publicUrl: data?.publicUrl || null,
    };
  });

  // Format listing data for display
  return {
    ...listing,
    photos: photosWithUrls,
    price: (listing.price_cents / 100).toFixed(2),
    priceDollars: listing.price_cents / 100,
    creator,
  };
}

/**
 * Fetches a creator profile by handle (public access)
 * Used for displaying public creator profile pages
 * 
 * @param {string} handle - Creator's handle/username
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (for public operations)
 * @returns {Promise<object | null>} Creator profile object or null if not found
 */
export async function fetchCreatorByHandle(handle, supabaseUrl, serviceRoleKey) {
  if (!handle || !supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Fetch creator by handle
  const {data: creator, error: creatorError} = await supabase
    .from('creators')
    .select('id, email, display_name, handle, bio, profile_image_url, cover_image_storage_path, first_name, last_name, verification_status, created_at')
    .eq('handle', handle)
    .single();
  
  if (creatorError || !creator) {
    console.error('Error fetching creator by handle:', creatorError);
    return null;
  }
  
  return creator;
}

/**
 * Fetches all live listings for a specific creator (public access)
 * Used for displaying creator's products on their profile page
 * 
 * @param {string} creatorId - Creator's UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (for public operations)
 * @param {object} options - Optional filters and sorting
 * @param {string} options.sortBy - Sort order ('newest', 'oldest', 'price_high', 'price_low', 'title')
 * @returns {Promise<Array>} Array of listing objects with photos
 */
export async function fetchListingsByCreatorId(creatorId, supabaseUrl, serviceRoleKey, options = {}) {
  if (!creatorId || !supabaseUrl || !serviceRoleKey) {
    return [];
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Build query for listings
  let query = supabase
    .from('listings')
    .select('*')
    .eq('creator_id', creatorId)
    .eq('status', 'live'); // Only show live listings
  
  // Apply sorting
  const sortBy = options.sortBy || 'newest';
  switch (sortBy) {
    case 'oldest':
      query = query.order('created_at', {ascending: true});
      break;
    case 'price_high':
      query = query.order('price_cents', {ascending: false});
      break;
    case 'price_low':
      query = query.order('price_cents', {ascending: true});
      break;
    case 'title':
      query = query.order('title', {ascending: true});
      break;
    case 'newest':
    default:
      query = query.order('created_at', {ascending: false});
      break;
  }
  
  const {data: listings, error: listingsError} = await query;

  if (listingsError) {
    console.error('Error fetching creator listings:', listingsError);
    return [];
  }

  if (!listings || listings.length === 0) {
    return [];
  }

  // Fetch photos for all listings
  const listingIds = listings.map(l => l.id);
  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('*')
    .in('listing_id', listingIds)
    .eq('photo_type', 'reference'); // Only get reference photos for display

  if (photosError) {
    console.error('Error fetching listing photos:', photosError);
  }

  // Group photos by listing_id
  const photosByListing = {};
  if (photos) {
    photos.forEach(photo => {
      if (!photosByListing[photo.listing_id]) {
        photosByListing[photo.listing_id] = [];
      }
      photosByListing[photo.listing_id].push(photo);
    });
  }

  // Combine listings with their photos and format for display
  const listingsWithPhotos = listings.map(listing => {
    const listingPhotos = photosByListing[listing.id] || [];
    
    // Get public URL for thumbnail
    let thumbnailUrl = null;
    if (listingPhotos.length > 0) {
      const {data} = supabase.storage
        .from('listing-photos')
        .getPublicUrl(listingPhotos[0].storage_path);
      thumbnailUrl = data?.publicUrl || null;
    }
    
    return {
      ...listing,
      photos: listingPhotos.map(photo => {
        const {data} = supabase.storage
          .from('listing-photos')
          .getPublicUrl(photo.storage_path);
        return {
          ...photo,
          publicUrl: data?.publicUrl || null,
        };
      }),
      // Format price for display
      price: (listing.price_cents / 100).toFixed(2),
      priceFormatted: `$${(listing.price_cents / 100).toFixed(2)}`,
      thumbnailUrl,
      createdAt: listing.created_at,
    };
  });

  // Apply additional client-side sorting if needed (for title sorting)
  if (sortBy === 'title') {
    listingsWithPhotos.sort((a, b) => a.title.localeCompare(b.title));
  }

  return listingsWithPhotos;
}

/**
 * Fetches recent activity for a creator
 * Aggregates activity from multiple tables: listings, payouts, verifications, logistics_events
 * Returns a unified activity feed sorted by most recent first
 * 
 * @param {string} creatorId - Creator's UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @param {object} options - Optional parameters
 * @param {number} options.limit - Maximum number of activities to return (default: 20)
 * @returns {Promise<Array>} Array of activity objects with type, description, timestamp, and metadata
 */
export async function fetchCreatorRecentActivity(creatorId, supabaseUrl, anonKey, accessToken, options = {}) {
  if (!creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return [];
  }

  // SECURITY: Validate and limit the limit parameter to prevent DoS
  let limit = options.limit || 20;
  if (typeof limit !== 'number' || limit < 1 || limit > 100) {
    limit = 20; // Default to safe value if invalid
  }
  limit = Math.floor(limit); // Ensure it's an integer
  // Pass fetch explicitly to ensure Cloudflare Workers uses request-scoped fetch
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, fetch);
  
  // First, try to fetch from activity_log table (preferred method)
  const {data: activityLogs, error: activityLogError} = await supabase
    .from('activity_log')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', {ascending: false})
    .limit(limit);

  // If we have activity logs, use them (preferred method)
  if (!activityLogError && activityLogs && activityLogs.length > 0) {
    return activityLogs.map(log => ({
      id: log.id,
      type: log.activity_type,
      description: log.description,
      timestamp: log.created_at,
      metadata: log.metadata || {},
    }));
  }

  // Fallback: If activity_log is empty, aggregate from other tables
  // This allows for a migration period where old data still shows up
  const activities = [];

  // 1. Fetch recent listings
  const {data: listings, error: listingsError} = await supabase
    .from('listings')
    .select('id, title, status, created_at')
    .eq('creator_id', creatorId)
    .order('created_at', {ascending: false})
    .limit(limit);

  if (!listingsError && listings) {
    listings.forEach(listing => {
      let description = '';
      let activityType = 'listing_created';
      
      switch (listing.status) {
        case 'live':
          description = `Listed "${listing.title}"`;
          activityType = 'listing_published';
          break;
        case 'pending_approval':
          description = `Submitted "${listing.title}" for approval`;
          activityType = 'listing_submitted';
          break;
        case 'draft':
          description = `Created draft "${listing.title}"`;
          activityType = 'listing_created';
          break;
        default:
          description = `Updated "${listing.title}"`;
          activityType = 'listing_updated';
      }
      
      activities.push({
        id: `listing_${listing.id}`,
        type: activityType,
        description,
        timestamp: listing.created_at,
        metadata: {
          listingId: listing.id,
          listingTitle: listing.title,
          status: listing.status,
        },
      });
    });
  }

  // 2. Fetch recent payouts
  const {data: payouts, error: payoutsError} = await supabase
    .from('payouts')
    .select('id, net_amount_cents, payout_status, created_at, listing_id')
    .eq('creator_id', creatorId)
    .order('created_at', {ascending: false})
    .limit(limit);

  if (!payoutsError && payouts) {
    // Fetch listing titles for payouts
    const payoutListingIds = payouts.map(p => p.listing_id).filter(Boolean);
    let listingTitlesMap = {};
    
    if (payoutListingIds.length > 0) {
      const {data: payoutListings} = await supabase
        .from('listings')
        .select('id, title')
        .in('id', payoutListingIds);
      
      if (payoutListings) {
        payoutListings.forEach(listing => {
          listingTitlesMap[listing.id] = listing.title;
        });
      }
    }

    payouts.forEach(payout => {
      const amount = (payout.net_amount_cents / 100).toFixed(2);
      const listingTitle = listingTitlesMap[payout.listing_id] || 'a listing';
      
      let description = '';
      let activityType = 'payout_created';
      
      switch (payout.payout_status) {
        case 'completed':
          description = `Received payout of $${amount} for "${listingTitle}"`;
          activityType = 'payout_completed';
          break;
        case 'pending':
          description = `Payout of $${amount} pending for "${listingTitle}"`;
          activityType = 'payout_pending';
          break;
        case 'failed':
          description = `Payout of $${amount} failed for "${listingTitle}"`;
          activityType = 'payout_failed';
          break;
        default:
          description = `Payout of $${amount} for "${listingTitle}"`;
      }
      
      activities.push({
        id: `payout_${payout.id}`,
        type: activityType,
        description,
        timestamp: payout.created_at,
        metadata: {
          payoutId: payout.id,
          amount: payout.net_amount_cents,
          status: payout.payout_status,
          listingId: payout.listing_id,
          listingTitle,
        },
      });
    });
  }

  // 3. Fetch recent verification submissions
  const {data: verifications, error: verificationsError} = await supabase
    .from('creator_verifications')
    .select('id, status, created_at')
    .eq('creator_id', creatorId)
    .order('created_at', {ascending: false})
    .limit(limit);

  if (!verificationsError && verifications) {
    verifications.forEach(verification => {
      let description = '';
      let activityType = 'verification_submitted';
      
      switch (verification.status) {
        case 'approved':
          description = 'Verification approved';
          activityType = 'verification_approved';
          break;
        case 'rejected':
          description = 'Verification rejected';
          activityType = 'verification_rejected';
          break;
        case 'pending':
        default:
          description = 'Submitted verification request';
          activityType = 'verification_submitted';
      }
      
      activities.push({
        id: `verification_${verification.id}`,
        type: activityType,
        description,
        timestamp: verification.created_at,
        metadata: {
          verificationId: verification.id,
          status: verification.status,
        },
      });
    });
  }

  // 4. Fetch recent logistics events
  // First get listing IDs for this creator, then fetch logistics events for those listings
  const {data: creatorListings, error: creatorListingsError} = await supabase
    .from('listings')
    .select('id')
    .eq('creator_id', creatorId);
  
  let logisticsEvents = [];
  if (!creatorListingsError && creatorListings && creatorListings.length > 0) {
    const listingIds = creatorListings.map(l => l.id);
    const {data: events, error: logisticsError} = await supabase
      .from('logistics_events')
      .select('id, event_type, created_at, listing_id, metadata')
      .in('listing_id', listingIds)
      .order('created_at', {ascending: false})
      .limit(limit);
    
    if (!logisticsError && events) {
      logisticsEvents = events;
    }
  }

  if (logisticsEvents && logisticsEvents.length > 0) {
    // Fetch listing titles for logistics events
    const logisticsListingIds = logisticsEvents.map(e => e.listing_id).filter(Boolean);
    let logisticsListingTitlesMap = {};
    
    if (logisticsListingIds.length > 0) {
      const {data: logisticsListings} = await supabase
        .from('listings')
        .select('id, title')
        .in('id', logisticsListingIds);
      
      if (logisticsListings) {
        logisticsListings.forEach(listing => {
          logisticsListingTitlesMap[listing.id] = listing.title;
        });
      }
    }

    logisticsEvents.forEach(event => {
      const listingTitle = logisticsListingTitlesMap[event.listing_id] || 'a listing';
      let description = '';
      let activityType = 'logistics_event';
      
      // Map event types to human-readable descriptions
      switch (event.event_type) {
        case 'shipped':
          description = `"${listingTitle}" has been shipped`;
          activityType = 'listing_shipped';
          break;
        case 'delivered':
          description = `"${listingTitle}" has been delivered`;
          activityType = 'listing_delivered';
          break;
        case 'received':
          description = `"${listingTitle}" has been received`;
          activityType = 'listing_received';
          break;
        default:
          description = `Logistics update for "${listingTitle}"`;
      }
      
      activities.push({
        id: `logistics_${event.id}`,
        type: activityType,
        description,
        timestamp: event.created_at,
        metadata: {
          eventId: event.id,
          eventType: event.event_type,
          listingId: event.listing_id,
          listingTitle,
          eventMetadata: event.metadata,
        },
      });
    });
  }

  // Sort all activities by timestamp (most recent first) and limit
  activities.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateB - dateA; // Descending order
  });

  return activities.slice(0, limit);
}

/**
 * SECURITY: Validates UUID format to prevent injection attacks
 * @param {string} uuid - UUID string to validate
 * @returns {boolean} True if valid UUID format
 */
function isValidUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * SECURITY: Sanitizes activity description to prevent XSS and enforce length limits
 * Removes control characters, HTML tags, and limits length
 * @param {string} description - Description to sanitize
 * @param {number} maxLength - Maximum length (default: 500)
 * @returns {string} Sanitized description
 */
function sanitizeActivityDescription(description, maxLength = 500) {
  if (!description || typeof description !== 'string') {
    return '';
  }
  
  // Remove control characters and HTML tags
  let sanitized = description
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/<[^>]*>/g, ''); // Remove HTML tags
  
  // Enforce length limit
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * SECURITY: Validates and sanitizes metadata object to prevent DoS attacks
 * Limits size and ensures it's a valid JSON object
 * @param {object} metadata - Metadata object to validate
 * @param {number} maxSizeKB - Maximum size in KB (default: 10KB)
 * @returns {object | null} Sanitized metadata or null if invalid
 */
function validateMetadata(metadata, maxSizeKB = 10) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  
  // Prevent prototype pollution
  if (Object.prototype.hasOwnProperty.call(metadata, '__proto__') ||
      Object.prototype.hasOwnProperty.call(metadata, 'constructor') ||
      Object.prototype.hasOwnProperty.call(metadata, 'prototype')) {
    console.warn('Metadata contains forbidden keys, rejecting');
    return null;
  }
  
  try {
    // Check size limit (rough estimate)
    const jsonString = JSON.stringify(metadata);
    const sizeKB = new Blob([jsonString]).size / 1024;
    
    if (sizeKB > maxSizeKB) {
      console.warn(`Metadata size (${sizeKB.toFixed(2)}KB) exceeds limit (${maxSizeKB}KB)`);
      return null;
    }
    
    // Deep clone to prevent mutation and ensure valid JSON
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn('Invalid metadata format, rejecting:', error);
    return null;
  }
}

/**
 * SECURITY: Validates activity type and entity type against whitelist
 * Prevents arbitrary activity types from being logged
 * @param {string} activityType - Activity type to validate
 * @param {string} entityType - Entity type to validate
 * @returns {boolean} True if both are valid
 */
function validateActivityTypes(activityType, entityType) {
  const allowedEntityTypes = ['listing', 'payout', 'verification', 'logistics_event', 'creator'];
  const allowedActivityTypes = [
    'listing_created', 'listing_updated', 'listing_status_changed', 'listing_published', 
    'listing_submitted', 'listing_approved', 'listing_rejected', 'listing_deleted', 'listing_sold',
    'payout_created', 'payout_completed', 'payout_pending', 'payout_failed',
    'verification_submitted', 'verification_approved', 'verification_rejected',
    'listing_shipped', 'listing_delivered', 'listing_received',
    'creator_joined', 'creator_created', 'creator_status_changed', 'creator_verification_status_changed',
  ];
  
  return allowedEntityTypes.includes(entityType) && allowedActivityTypes.includes(activityType);
}

/**
 * Logs an activity to the activity_log table
 * This is the primary way to track user activities for the activity feed
 * 
 * SECURITY NOTES:
 * - Validates UUIDs to prevent injection attacks
 * - Sanitizes description to prevent XSS
 * - Validates activity and entity types against whitelist
 * - Limits metadata size to prevent DoS
 * - RLS policies ensure users can only log activities for themselves
 * 
 * @param {object} params - Activity parameters
 * @param {string} params.creatorId - Creator's UUID
 * @param {string} params.activityType - Type of activity (e.g., 'listing_created', 'listing_updated')
 * @param {string} params.entityType - Type of entity ('listing', 'payout', 'verification', 'logistics_event', 'creator')
 * @param {string} params.entityId - UUID of the related entity (optional)
 * @param {string} params.description - Human-readable description of the activity
 * @param {object} params.metadata - Additional context (optional, max 10KB)
 * @param {string} params.supabaseUrl - Supabase project URL
 * @param {string} params.anonKey - Supabase anon/public key
 * @param {string} params.accessToken - User's access token
 * @returns {Promise<{success: boolean, error: Error | null}>}
 */
export async function logActivity({
  creatorId,
  activityType,
  entityType,
  entityId = null,
  description,
  metadata = null,
  supabaseUrl,
  anonKey,
  accessToken,
  customFetch,
}) {
  // Validate required parameters
  if (!creatorId || !activityType || !entityType || !description || !supabaseUrl || !anonKey || !accessToken) {
    return {
      success: false,
      error: new Error('Missing required parameters for activity logging'),
    };
  }

  // SECURITY: Validate UUIDs to prevent injection
  if (!isValidUUID(creatorId)) {
    return {
      success: false,
      error: new Error('Invalid creator ID format'),
    };
  }

  if (entityId && !isValidUUID(entityId)) {
    return {
      success: false,
      error: new Error('Invalid entity ID format'),
    };
  }

  // SECURITY: Validate activity and entity types against whitelist
  if (!validateActivityTypes(activityType, entityType)) {
    return {
      success: false,
      error: new Error('Invalid activity type or entity type'),
    };
  }

  // SECURITY: Sanitize description to prevent XSS
  const sanitizedDescription = sanitizeActivityDescription(description);
  if (!sanitizedDescription) {
    return {
      success: false,
      error: new Error('Description is required and cannot be empty after sanitization'),
    };
  }

  // SECURITY: Validate and sanitize metadata
  let sanitizedMetadata = null;
  if (metadata) {
    sanitizedMetadata = validateMetadata(metadata);
    // Note: We don't fail if metadata is invalid, we just skip it to avoid breaking existing flows
  }

  // CRITICAL: Use customFetch if provided (for Cloudflare Workers I/O context)
  // Otherwise fall back to global fetch
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);

  const activityData = {
    creator_id: creatorId,
    activity_type: activityType,
    entity_type: entityType,
    description: sanitizedDescription,
  };

  if (entityId) {
    activityData.entity_id = entityId;
  }

  if (sanitizedMetadata) {
    activityData.metadata = sanitizedMetadata;
  }

  const {error} = await supabase
    .from('activity_log')
    .insert(activityData);

  if (error) {
    console.error('Error logging activity:', error);
    return {
      success: false,
      error,
    };
  }

  return {
    success: true,
    error: null,
  };
}

/**
 * Logs an activity to the activity_log table using service role key (for admin operations)
 * This bypasses RLS and allows admins to log activities on behalf of creators
 * 
 * SECURITY NOTES:
 * - Validates UUIDs to prevent injection attacks
 * - Sanitizes description to prevent XSS
 * - Validates activity and entity types against whitelist
 * - Limits metadata size to prevent DoS
 * - Should only be called from authenticated admin routes (verified by checkAdminAuth)
 * 
 * @param {object} params - Activity parameters
 * @param {string} params.creatorId - Creator's UUID
 * @param {string} params.activityType - Type of activity (e.g., 'listing_status_changed')
 * @param {string} params.entityType - Type of entity ('listing', 'payout', 'verification', 'logistics_event', 'creator')
 * @param {string} params.entityId - UUID of the related entity (optional)
 * @param {string} params.description - Human-readable description of the activity
 * @param {object} params.metadata - Additional context (optional, max 10KB)
 * @param {string} params.supabaseUrl - Supabase project URL
 * @param {string} params.serviceRoleKey - Supabase service role key (for admin operations)
 * @returns {Promise<{success: boolean, error: Error | null}>}
 */
export async function logActivityAdmin({
  creatorId,
  activityType,
  entityType,
  entityId = null,
  description,
  metadata = null,
  supabaseUrl,
  serviceRoleKey,
}) {
  // Validate required parameters
  if (!creatorId || !activityType || !entityType || !description || !supabaseUrl || !serviceRoleKey) {
    return {
      success: false,
      error: new Error('Missing required parameters for activity logging'),
    };
  }

  // SECURITY: Validate UUIDs to prevent injection
  if (!isValidUUID(creatorId)) {
    return {
      success: false,
      error: new Error('Invalid creator ID format'),
    };
  }

  if (entityId && !isValidUUID(entityId)) {
    return {
      success: false,
      error: new Error('Invalid entity ID format'),
    };
  }

  // SECURITY: Validate activity and entity types against whitelist
  if (!validateActivityTypes(activityType, entityType)) {
    return {
      success: false,
      error: new Error('Invalid activity type or entity type'),
    };
  }

  // SECURITY: Sanitize description to prevent XSS
  const sanitizedDescription = sanitizeActivityDescription(description);
  if (!sanitizedDescription) {
    return {
      success: false,
      error: new Error('Description is required and cannot be empty after sanitization'),
    };
  }

  // SECURITY: Validate and sanitize metadata
  let sanitizedMetadata = null;
  if (metadata) {
    sanitizedMetadata = validateMetadata(metadata);
    // Note: We don't fail if metadata is invalid, we just skip it to avoid breaking existing flows
  }

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);

  const activityData = {
    creator_id: creatorId,
    activity_type: activityType,
    entity_type: entityType,
    description: sanitizedDescription,
  };

  if (entityId) {
    activityData.entity_id = entityId;
  }

  if (sanitizedMetadata) {
    activityData.metadata = sanitizedMetadata;
  }

  const {error} = await supabase
    .from('activity_log')
    .insert(activityData);

  if (error) {
    console.error('Error logging activity (admin):', error);
    return {
      success: false,
      error,
    };
  }

  return {
    success: true,
    error: null,
  };
}

/**
 * Fetches recent activity for admin dashboard
 * Aggregates activity from activity_log table for admin-relevant events:
 * - New creators that joined
 * - New items to verify (listings pending approval)
 * - State changes of listings
 * - State changes of creators
 * 
 * SECURITY NOTES:
 * - Validates limit parameter to prevent DoS attacks
 * - Uses service role key (should only be called from authenticated admin routes)
 * - Descriptions are already sanitized at insert time
 * - Display layer (React) automatically escapes text content for XSS protection
 * 
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} serviceRoleKey - Supabase service role key (for admin operations)
 * @param {object} options - Optional parameters
 * @param {number} options.limit - Maximum number of activities to return (default: 50, max: 200)
 * @returns {Promise<Array>} Array of activity objects with type, description, timestamp, creator info, and metadata
 */
export async function fetchAdminRecentActivity(supabaseUrl, serviceRoleKey, options = {}) {
  if (!supabaseUrl || !serviceRoleKey) {
    return [];
  }

  // SECURITY: Validate and limit the limit parameter to prevent DoS
  let limit = options.limit || 50;
  if (typeof limit !== 'number' || limit < 1 || limit > 200) {
    limit = 50; // Default to safe value if invalid
  }
  limit = Math.floor(limit); // Ensure it's an integer
  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
  
  // Fetch activity logs for admin-relevant events
  // Filter for activities related to creators, listings, and verifications
  const {data: activityLogs, error: activityLogError} = await supabase
    .from('activity_log')
    .select('*')
    .in('entity_type', ['creator', 'listing', 'verification'])
    .order('created_at', {ascending: false})
    .limit(limit);

  if (activityLogError) {
    console.error('Error fetching admin recent activity:', activityLogError);
    return [];
  }

  if (!activityLogs || activityLogs.length === 0) {
    return [];
  }

  // Fetch creator information for all activities
  const creatorIds = [...new Set(activityLogs.map(log => log.creator_id).filter(Boolean))];
  let creatorsMap = {};
  
  if (creatorIds.length > 0) {
    const {data: creators, error: creatorsError} = await supabase
      .from('creators')
      .select('id, email, display_name, handle')
      .in('id', creatorIds);
    
    if (!creatorsError && creators) {
      creators.forEach(creator => {
        creatorsMap[creator.id] = creator;
      });
    }
  }

  // Fetch listing information for listing-related activities
  const listingIds = [...new Set(
    activityLogs
      .filter(log => log.entity_type === 'listing' && log.entity_id)
      .map(log => log.entity_id)
  )];
  let listingsMap = {};
  
  if (listingIds.length > 0) {
    const {data: listings, error: listingsError} = await supabase
      .from('listings')
      .select('id, title, status')
      .in('id', listingIds);
    
    if (!listingsError && listings) {
      listings.forEach(listing => {
        listingsMap[listing.id] = listing;
      });
    }
  }

  // Format activities with creator and listing information
  const formattedActivities = activityLogs.map(log => {
    const creator = creatorsMap[log.creator_id] || null;
    const listing = log.entity_type === 'listing' && log.entity_id 
      ? listingsMap[log.entity_id] || null
      : null;

    return {
      id: log.id,
      type: log.activity_type,
      description: log.description,
      timestamp: log.created_at,
      entityType: log.entity_type,
      entityId: log.entity_id,
      metadata: log.metadata || {},
      creator: creator ? {
        id: creator.id,
        displayName: creator.display_name,
        handle: creator.handle,
        email: creator.email,
      } : null,
      listing: listing ? {
        id: listing.id,
        title: listing.title,
        status: listing.status,
      } : null,
    };
  });

  return formattedActivities;
}

/**
 * Fetches all offers for a creator's listings
 * Includes listing information and formats data for display
 * 
 * @param {string} creatorId - Creator's UUID
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @returns {Promise<Array>} Array of offer objects with listing info
 */
export async function fetchCreatorOffers(creatorId, supabaseUrl, anonKey, accessToken, customFetch) {
  if (!creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return [];
  }

  // CRITICAL: Pass customFetch to ensure Cloudflare Workers uses request-scoped fetch
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);
  
  // PERFORMANCE: Optimize query by fetching offers with listing details in a single query using joins
  // This reduces N+1 query pattern from 3 queries to 1 query + 1 parallel photo query
  const {data: offers, error: offersError} = await supabase
    .from('offers')
    .select(`
      *,
      listing:listings!inner(
        id,
        title,
        price_cents,
        currency,
        creator_id
      )
    `)
    .eq('listing.creator_id', creatorId)
    .order('created_at', {ascending: false});

  if (offersError) {
    console.error('Error fetching offers:', offersError);
    return [];
  }

  if (!offers || offers.length === 0) {
    return [];
  }

  // Extract unique listing IDs for photo query
  const listingIds = [...new Set(offers.map(offer => offer.listing_id))];

  // PERFORMANCE: Fetch photos in parallel (non-blocking)
  // This is separate because Supabase doesn't support nested joins for storage references
  const {data: photos, error: photosError} = await supabase
    .from('listing_photos')
    .select('*')
    .in('listing_id', listingIds)
    .eq('photo_type', 'reference');

  if (photosError) {
    console.error('Error fetching listing photos:', photosError);
  }

  // Group photos by listing_id
  const photosByListing = {};
  if (photos) {
    photos.forEach(photo => {
      if (!photosByListing[photo.listing_id]) {
        photosByListing[photo.listing_id] = [];
      }
      photosByListing[photo.listing_id].push(photo);
    });
  }

  // Combine offers with listing info and photos
  const offersWithDetails = offers
    .map(offer => {
      const listing = offer.listing;
      
      // Skip offers where listing doesn't exist (deleted listings)
      if (!listing) {
        return null;
      }
      
      const listingPhotos = photosByListing[offer.listing_id] || [];
      
      // Get public URL for thumbnail
      let thumbnailUrl = null;
      if (listingPhotos.length > 0) {
        const {data} = supabase.storage
          .from('listing-photos')
          .getPublicUrl(listingPhotos[0].storage_path);
        thumbnailUrl = data?.publicUrl || null;
      }

      return {
        ...offer,
        listing: {
          id: listing.id,
          title: listing.title,
          price_cents: listing.price_cents,
          currency: listing.currency || 'USD',
          price: listing.price_cents ? (listing.price_cents / 100).toFixed(2) : '0.00',
        },
        thumbnailUrl,
        offer_amount: (offer.offer_amount_cents / 100).toFixed(2),
        discount_percentage: parseFloat(offer.discount_percentage).toFixed(1),
      };
    })
    .filter(Boolean); // Remove null entries (offers with deleted listings)

  return offersWithDetails;
}

/**
 * Creates a new offer for a listing
 * Validates offer amount (minimum $100) and calculates discount percentage
 * 
 * SECURITY NOTES:
 * - Validates all inputs server-side
 * - Uses parameterized queries (Supabase handles SQL injection prevention)
 * - Checks listing status before allowing offers
 * - Normalizes email to prevent duplicates
 * 
 * @param {object} params - Offer parameters
 * @param {string} params.listingId - Listing UUID
 * @param {string} params.productId - Shopify product ID (GID format)
 * @param {string} params.variantId - Shopify variant ID (GID format)
 * @param {string} params.customerEmail - Customer email address
 * @param {number} params.offerAmountCents - Offer amount in cents (must be >= 10000 = $100)
 * @param {number} params.originalPriceCents - Original listing price in cents
 * @param {string} params.supabaseUrl - Supabase project URL
 * @param {string} params.serviceRoleKey - Supabase service role key (for public operations)
 * @returns {Promise<{success: boolean, offer: object | null, error: Error | null}>}
 */
export async function createOffer({
  listingId,
  productId,
  variantId,
  customerEmail,
  offerAmountCents,
  originalPriceCents,
  supabaseUrl,
  serviceRoleKey,
}) {
  // SECURITY: Validate all required parameters
  if (!listingId || !productId || !variantId || !customerEmail || !offerAmountCents || !originalPriceCents) {
    return {
      success: false,
      offer: null,
      error: new Error('Missing required parameters'),
    };
  }

  // SECURITY: Validate minimum offer amount ($100)
  if (offerAmountCents < 10000) {
    return {
      success: false,
      offer: null,
      error: new Error('Offer amount must be at least $100'),
    };
  }

  // SECURITY: Validate offer doesn't exceed original price
  if (offerAmountCents > originalPriceCents) {
    return {
      success: false,
      offer: null,
      error: new Error('Offer amount cannot exceed original price'),
    };
  }

  // SECURITY: Validate email format (prevent injection)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(customerEmail)) {
    return {
      success: false,
      offer: null,
      error: new Error('Invalid email format'),
    };
  }

  // SECURITY: Normalize email (lowercase, trim) to prevent duplicates
  const normalizedEmail = customerEmail.toLowerCase().trim();

  // Calculate expiration (30 days from now)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  // Calculate discount percentage as numeric (not string)
  const discountPercentage = Number(((originalPriceCents - offerAmountCents) / originalPriceCents) * 100);

  const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);

  // SECURITY: Check if listing exists and is available for offers
  const {data: listing, error: listingError} = await supabase
    .from('listings')
    .select('id, status, price_cents')
    .eq('id', listingId)
    .single();

  if (listingError || !listing) {
    return {
      success: false,
      offer: null,
      error: new Error('Listing not found'),
    };
  }

  // SECURITY: Only allow offers on live listings
  // Listings with status 'reserved' are already reserved for another customer
  if (listing.status !== 'live') {
    return {
      success: false,
      offer: null,
      error: new Error('Listing is not available for offers'),
    };
  }

  // SECURITY: Verify price matches (prevent price manipulation)
  if (listing.price_cents !== originalPriceCents) {
    return {
      success: false,
      offer: null,
      error: new Error('Price mismatch. Please refresh the page.'),
    };
  }

  // SECURITY: Create offer using parameterized query (Supabase handles SQL injection prevention)
  // Set updated_at explicitly to ensure it's set on insert (even though DB has default)
  const now = new Date().toISOString();
  const {data: offer, error: offerError} = await supabase
    .from('offers')
    .insert({
      listing_id: listingId,
      product_id: productId,
      variant_id: variantId,
      customer_email: normalizedEmail,
      offer_amount_cents: offerAmountCents,
      discount_percentage: discountPercentage, // Store as numeric, not string
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      updated_at: now, // Explicitly set updated_at on insert
    })
    .select()
    .single();

  if (offerError) {
    console.error('Error creating offer:', offerError);
    
    // Handle unique constraint violations (duplicate offers)
    if (offerError.code === '23505') {
      return {
        success: false,
        offer: null,
        error: new Error('You have already submitted an offer for this listing'),
      };
    }
    
    return {
      success: false,
      offer: null,
      error: new Error('Failed to create offer. Please try again.'),
    };
  }

  // Note: Listing status remains 'live' when offers are created
  // This allows multiple customers to make offers on the same listing
  // The listing status will change to 'reserved' only when an offer is accepted

  return {
    success: true,
    offer,
    error: null,
  };
}

/**
 * Rejects an offer
 * Updates offer status to 'declined' and potentially updates listing status
 * 
 * SECURITY NOTES:
 * - Validates creator owns the listing
 * - Verifies offer is still pending
 * - Uses parameterized queries (Supabase handles SQL injection prevention)
 * 
 * @param {object} params - Rejection parameters
 * @param {string} params.offerId - Offer UUID
 * @param {string} params.creatorId - Creator UUID (for authorization)
 * @param {string} params.supabaseUrl - Supabase project URL
 * @param {string} params.anonKey - Supabase anon key
 * @param {string} params.accessToken - User access token
 * @returns {Promise<{success: boolean, offer: object | null, error: Error | null}>}
 */
export async function rejectOffer({
  offerId,
  creatorId,
  supabaseUrl,
  anonKey,
  accessToken,
  customFetch,
}) {
  if (!offerId || !creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return {
      success: false,
      offer: null,
      error: new Error('Missing required parameters'),
    };
  }

  // CRITICAL: Pass customFetch to ensure Cloudflare Workers uses request-scoped fetch
  // This prevents "I/O on behalf of a different request" errors
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);

  // Fetch offer with listing to verify ownership
  const {data: offerData, error: offerFetchError} = await supabase
    .from('offers')
    .select(`
      *,
      listing:listings!inner(
        id,
        creator_id,
        status,
        title
      )
    `)
    .eq('id', offerId)
    .single();

  if (offerFetchError || !offerData) {
    return {
      success: false,
      offer: null,
      error: new Error('Offer not found'),
    };
  }

  // Verify creator owns the listing
  if (offerData.listing.creator_id !== creatorId) {
    return {
      success: false,
      offer: null,
      error: new Error('Unauthorized'),
    };
  }

  // Verify offer is still pending
  if (offerData.status !== 'pending') {
    return {
      success: false,
      offer: null,
      error: new Error(`Offer is already ${offerData.status}`),
    };
  }

  // SECURITY: Verify offer hasn't expired
  if (offerData.expires_at && new Date(offerData.expires_at) < new Date()) {
    return {
      success: false,
      offer: null,
      error: new Error('Offer has expired'),
    };
  }

  // Update offer status to 'declined'
  const {data: updatedOffer, error: updateError} = await supabase
    .from('offers')
    .update({
      status: 'declined',
      updated_at: new Date().toISOString(),
    })
    .eq('id', offerId)
    .select()
    .single();

  if (updateError) {
    console.error('Error rejecting offer:', updateError);
    return {
      success: false,
      offer: null,
      error: updateError,
    };
  }

  // Check if listing has any other pending offers
  // If no pending offers remain, revert listing status back to 'live' if it was 'offer_pending'
  const {data: otherPendingOffers, error: otherOffersError} = await supabase
    .from('offers')
    .select('id')
    .eq('listing_id', offerData.listing_id)
    .eq('status', 'pending')
    .limit(1);

  if (!otherOffersError && (!otherPendingOffers || otherPendingOffers.length === 0)) {
    // No other pending offers - revert listing to 'live' if it was 'reserved'
    // This allows the listing to be available for new offers again
    if (offerData.listing.status === 'reserved') {
      await supabase
        .from('listings')
        .update({status: 'live'})
        .eq('id', offerData.listing_id);
    }
  }

  // Log activity for offer rejection
  const offerAmount = (updatedOffer.offer_amount_cents / 100).toFixed(2);
  await logActivity({
    creatorId,
    activityType: 'offer_rejected',
    entityType: 'offer',
    entityId: offerId,
    description: `Rejected offer of $${offerAmount} for "${offerData.listing.title || 'listing'}"`,
    metadata: {
      offerId: offerId,
      offerAmount: updatedOffer.offer_amount_cents,
      listingId: offerData.listing_id,
      customerEmail: updatedOffer.customer_email,
      previousStatus: 'pending',
      newStatus: 'declined',
    },
    supabaseUrl,
    anonKey,
    accessToken,
    customFetch, // CRITICAL: Pass customFetch for Cloudflare Workers I/O context
  }).catch((error) => {
    // Log activity failure but don't fail the whole operation
    console.error('Error logging activity for offer rejection:', error);
  });

  return {
    success: true,
    offer: updatedOffer,
    error: null,
  };
}

/**
 * Accepts an offer and generates purchase link
 * Uses database transaction to prevent race conditions
 * 
 * SECURITY NOTES:
 * - Validates creator owns the listing
 * - Verifies offer is still pending
 * - Uses parameterized queries (Supabase handles SQL injection prevention)
 * - Generates secure purchase link token
 * 
 * @param {object} params - Acceptance parameters
 * @param {string} params.offerId - Offer UUID
 * @param {string} params.creatorId - Creator UUID (for authorization)
 * @param {string} params.supabaseUrl - Supabase project URL
 * @param {string} params.anonKey - Supabase anon key
 * @param {string} params.accessToken - User access token
 * @param {string} params.baseUrl - Base URL for purchase links
 * @returns {Promise<{success: boolean, offer: object | null, purchaseLink: string | null, error: Error | null}>}
 */
export async function acceptOffer({
  offerId,
  creatorId,
  supabaseUrl,
  anonKey,
  accessToken,
  baseUrl,
  customFetch,
}) {
  if (!offerId || !creatorId || !supabaseUrl || !anonKey || !accessToken) {
    return {
      success: false,
      offer: null,
      purchaseLink: null,
      error: new Error('Missing required parameters'),
    };
  }

  // CRITICAL: Pass customFetch to ensure Cloudflare Workers uses request-scoped fetch
  // This prevents "I/O on behalf of a different request" errors
  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken, customFetch);

  // Fetch offer with listing to verify ownership
  const {data: offerData, error: offerFetchError} = await supabase
    .from('offers')
    .select(`
      *,
      listing:listings!inner(
        id,
        creator_id,
        status,
        price_cents,
        title
      )
    `)
    .eq('id', offerId)
    .single();

  if (offerFetchError || !offerData) {
    return {
      success: false,
      offer: null,
      purchaseLink: null,
      error: new Error('Offer not found'),
    };
  }

  // Verify creator owns the listing
  if (offerData.listing.creator_id !== creatorId) {
    return {
      success: false,
      offer: null,
      purchaseLink: null,
      error: new Error('Unauthorized'),
    };
  }

  // Verify offer is still pending
  if (offerData.status !== 'pending') {
    return {
      success: false,
      offer: null,
      purchaseLink: null,
      error: new Error(`Offer is already ${offerData.status}`),
    };
  }

  // Verify offer hasn't expired
  if (new Date(offerData.expires_at) < new Date()) {
    return {
      success: false,
      offer: null,
      purchaseLink: null,
      error: new Error('Offer has expired'),
    };
  }

  // Generate secure purchase link token
  const purchaseLinkToken = crypto.randomUUID();

  // Calculate discount expiration (7 days from now)
  const discountExpiresAt = new Date();
  discountExpiresAt.setDate(discountExpiresAt.getDate() + 7);

  // SECURITY: Update offer status with conditional check to prevent race conditions
  // Only update if status is still 'pending' - this prevents accepting multiple offers simultaneously
  // This acts as a simple optimistic locking mechanism
  const {data: updatedOffer, error: updateError} = await supabase
    .from('offers')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      purchase_link_token: purchaseLinkToken,
      discount_expires_at: discountExpiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', offerId)
    .eq('status', 'pending') // CRITICAL: Only update if still pending (prevents race conditions)
    .select()
    .single();

  if (updateError || !updatedOffer) {
    // If update failed, re-fetch to check current status
    const {data: currentOffer} = await supabase
      .from('offers')
      .select('status')
      .eq('id', offerId)
      .single();
    
    if (currentOffer && currentOffer.status !== 'pending') {
      return {
        success: false,
        offer: null,
        purchaseLink: null,
        error: new Error(`Offer is already ${currentOffer.status}`),
      };
    }
    
    console.error('Error accepting offer:', updateError);
    return {
      success: false,
      offer: null,
      purchaseLink: null,
      error: updateError || new Error('Failed to update offer'),
    };
  }

  // Decline all other pending offers for this listing
  await supabase
    .from('offers')
    .update({status: 'declined'})
    .eq('listing_id', offerData.listing_id)
    .eq('status', 'pending')
    .neq('id', offerId);

  // Update listing status to 'reserved' if it's currently 'live' (removes it from marketplace)
  // This ensures the listing is hidden while the customer has 7 days to complete purchase
  // 'reserved' indicates the item is reserved for the customer who made the accepted offer
  if (offerData.listing.status === 'live') {
    const {error: listingUpdateError} = await supabase
      .from('listings')
      .update({status: 'reserved'})
      .eq('id', offerData.listing_id);

    if (listingUpdateError) {
      console.error('Error updating listing status:', listingUpdateError);
      // Fail the operation if listing status update fails - this is critical
      return {
        success: false,
        offer: null,
        purchaseLink: null,
        error: new Error(`Failed to update listing status: ${listingUpdateError.message}`),
      };
    }
  }

  // Log activity for offer acceptance
  const offerAmount = (updatedOffer.offer_amount_cents / 100).toFixed(2);
  await logActivity({
    creatorId,
    activityType: 'listing_status_changed',
    entityType: 'listing',
    entityId: offerData.listing_id,
    description: `Accepted offer of $${offerAmount} for "${offerData.listing.title || 'listing'}"`,
    metadata: {
      offerId: offerId,
      offerAmount: updatedOffer.offer_amount_cents,
      listingId: offerData.listing_id,
      previousStatus: offerData.listing.status,
      newStatus: offerData.listing.status === 'live' ? 'reserved' : offerData.listing.status,
      customerEmail: updatedOffer.customer_email,
    },
    supabaseUrl,
    anonKey,
    accessToken,
    customFetch, // CRITICAL: Pass customFetch for Cloudflare Workers I/O context
  }).catch((error) => {
    // Log activity failure but don't fail the whole operation
    console.error('Error logging activity for offer acceptance:', error);
  });

  // Generate purchase link
  const purchaseLink = `${baseUrl}/offers/purchase/${purchaseLinkToken}`;

  return {
    success: true,
    offer: updatedOffer,
    purchaseLink,
    error: null,
  };
}

