import {createServerSupabaseClient} from '~/lib/supabase';

/**
 * Stores OAuth state and code verifier in Supabase (instead of session cookie)
 * to avoid cookie size limits (4096 bytes max)
 * 
 * @param {object} params
 * @param {string} params.state - OAuth state token
 * @param {string} params.platform - Platform name (e.g., 'x', 'instagram')
 * @param {string} params.codeVerifier - PKCE code verifier (for platforms that use PKCE)
 * @param {string} params.creatorId - Creator ID
 * @param {string} params.supabaseUrl - Supabase URL
 * @param {string} params.supabaseServiceKey - Supabase service role key
 * @returns {Promise<void>}
 */
export async function storeOAuthState({
  state,
  platform,
  codeVerifier = null,
  creatorId,
  supabaseUrl,
  supabaseServiceKey,
}) {
  const supabase = createServerSupabaseClient(supabaseUrl, supabaseServiceKey);
  
  // Store with 10-minute expiration
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  
  const {error} = await supabase
    .from('oauth_states')
    .insert({
      state_token: state,
      platform,
      code_verifier: codeVerifier,
      creator_id: creatorId,
      expires_at: expiresAt,
    });
  
  if (error) {
    console.error('Error storing OAuth state:', error);
    throw new Error('Failed to store OAuth state');
  }
}

/**
 * Retrieves OAuth state from Supabase WITHOUT deleting it
 * Use this when you need to validate state but may need to redirect for auth
 * 
 * @param {object} params
 * @param {string} params.state - OAuth state token
 * @param {string} params.supabaseUrl - Supabase URL
 * @param {string} params.supabaseServiceKey - Supabase service role key
 * @returns {Promise<{platform: string, codeVerifier: string | null, creatorId: string} | null>}
 */
export async function getOAuthState({
  state,
  supabaseUrl,
  supabaseServiceKey,
}) {
  const supabase = createServerSupabaseClient(supabaseUrl, supabaseServiceKey);
  
  const {data, error: fetchError} = await supabase
    .from('oauth_states')
    .select('platform, code_verifier, creator_id')
    .eq('state_token', state)
    .gt('expires_at', new Date().toISOString()) // Only get non-expired
    .maybeSingle();
  
  if (fetchError) {
    console.error('Error fetching OAuth state:', fetchError);
    return null;
  }
  
  if (!data) {
    return null; // State not found or expired
  }
  
  return {
    platform: data.platform,
    codeVerifier: data.code_verifier,
    creatorId: data.creator_id,
  };
}

/**
 * Retrieves and deletes OAuth state from Supabase
 * 
 * @param {object} params
 * @param {string} params.state - OAuth state token
 * @param {string} params.supabaseUrl - Supabase URL
 * @param {string} params.supabaseServiceKey - Supabase service role key
 * @returns {Promise<{platform: string, codeVerifier: string | null, creatorId: string} | null>}
 */
export async function getAndDeleteOAuthState({
  state,
  supabaseUrl,
  supabaseServiceKey,
}) {
  const supabase = createServerSupabaseClient(supabaseUrl, supabaseServiceKey);
  
  // Get and delete in one transaction-like operation
  const {data, error: fetchError} = await supabase
    .from('oauth_states')
    .select('platform, code_verifier, creator_id')
    .eq('state_token', state)
    .gt('expires_at', new Date().toISOString()) // Only get non-expired
    .maybeSingle();
  
  if (fetchError) {
    console.error('Error fetching OAuth state:', fetchError);
    return null;
  }
  
  if (!data) {
    return null; // State not found or expired
  }
  
  // Delete the state (one-time use)
  const {error: deleteError} = await supabase
    .from('oauth_states')
    .delete()
    .eq('state_token', state);
  
  if (deleteError) {
    console.error('Error deleting OAuth state:', deleteError);
    // Still return data even if delete fails
  }
  
  return {
    platform: data.platform,
    codeVerifier: data.code_verifier,
    creatorId: data.creator_id,
  };
}

/**
 * Deletes OAuth state from Supabase
 * Use this after successfully completing OAuth flow
 * 
 * @param {object} params
 * @param {string} params.state - OAuth state token
 * @param {string} params.supabaseUrl - Supabase URL
 * @param {string} params.supabaseServiceKey - Supabase service role key
 * @returns {Promise<void>}
 */
export async function deleteOAuthState({
  state,
  supabaseUrl,
  supabaseServiceKey,
}) {
  const supabase = createServerSupabaseClient(supabaseUrl, supabaseServiceKey);
  
  const {error} = await supabase
    .from('oauth_states')
    .delete()
    .eq('state_token', state);
  
  if (error) {
    console.error('Error deleting OAuth state:', error);
    // Don't throw - deletion failure shouldn't break the flow
  }
}

/**
 * Cleans up expired OAuth states (call this periodically or on-demand)
 * 
 * @param {string} supabaseUrl - Supabase URL
 * @param {string} supabaseServiceKey - Supabase service role key
 * @returns {Promise<number>} Number of deleted records
 */
export async function cleanupExpiredOAuthStates(supabaseUrl, supabaseServiceKey) {
  const supabase = createServerSupabaseClient(supabaseUrl, supabaseServiceKey);
  
  const {data, error} = await supabase
    .from('oauth_states')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select();
  
  if (error) {
    console.error('Error cleaning up expired OAuth states:', error);
    return 0;
  }
  
  return data?.length || 0;
}

