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
    console.error('Error parsing Supabase auth token:', error);
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
 * Fetches creator profile by email
 * Returns full profile data for use in settings page
 * 
 * @param {string} userEmail - User's email address
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} anonKey - Supabase anon/public key
 * @param {string} accessToken - User's access token
 * @returns {Promise<object | null>} Creator profile object or null if not found
 */
export async function fetchCreatorProfile(userEmail, supabaseUrl, anonKey, accessToken) {
  if (!userEmail || !supabaseUrl || !anonKey || !accessToken) {
    return null;
  }

  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
  
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

  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
  
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
  if (updates.username !== undefined) dbUpdates.handle = updates.username;
  if (updates.firstName !== undefined) dbUpdates.first_name = updates.firstName;
  if (updates.lastName !== undefined) dbUpdates.last_name = updates.lastName;
  if (updates.profileImageUrl !== undefined) dbUpdates.profile_image_url = updates.profileImageUrl;
  
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

  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
  
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

  const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);
  
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
  
  return creators;
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

  return {
    ...creator,
    verification: verification || null,
    listings: listingsWithPrice,
    payouts: payoutsWithCurrency,
    totalListings: listingsWithPrice.length,
    totalPayouts: payoutsWithCurrency.length,
    totalEarnings: payoutsWithCurrency.reduce((sum, p) => sum + p.netAmountDollars, 0),
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
  // Always use Secure in production, SameSite=Strict for better CSRF protection
  const secureFlag = isProduction ? '; Secure' : '';
  const sameSite = '; SameSite=Strict'; // More secure than Lax for auth cookies
  const cookieString = `${cookieName}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly${sameSite}; Max-Age=${maxAge}${secureFlag}`;

  return cookieString;
}

