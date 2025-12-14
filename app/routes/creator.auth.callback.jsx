import {redirect, useLoaderData} from 'react-router';
import {useEffect, useState} from 'react';
import {exchangeOAuthCode, createSessionCookie} from '~/lib/supabase';

/**
 * Callback route for Supabase Auth
 * Handles magic link verification and OAuth callbacks
 * 
 * Supabase magic links return tokens in URL hash fragments (client-side only)
 * Query parameters:
 * - token_hash: Magic link token (for server-side verification)
 * - type: Token type (usually 'magiclink')
 * - code: OAuth code (for OAuth providers)
 */
export async function loader({request, context}) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const code = url.searchParams.get('code');
  
  const {env} = context;
  
  // Handle server-side token verification (if tokens are in query params)
  if (tokenHash && type) {
    // This path is for server-side verification
    // Most magic links use hash fragments, so this may not be used
    return {mode: 'server', tokenHash, type};
  }
  
  // Handle OAuth callback (Google, etc.)
  if (code) {
    // Validate environment variables
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      console.error('Missing Supabase environment variables');
      return redirect('/creator/login?error=config_error');
    }

    // Exchange OAuth code for session
    const {session, user, error} = await exchangeOAuthCode(
      code,
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY,
    );
    
    if (error || !session || !user) {
      console.error('OAuth code exchange error:', error);
      return redirect('/creator/login?error=oauth_failed');
    }
    
    // Determine if we're in a secure context
    const isSecure = request.url.startsWith('https://') || 
                     request.headers.get('x-forwarded-proto') === 'https' ||
                     env.NODE_ENV === 'production';
    
    // Create session cookie using helper function
    const sessionWithUser = {
      ...session,
      user,
    };
    const cookieHeader = createSessionCookie(sessionWithUser, env.SUPABASE_URL, isSecure);
    
    if (!cookieHeader) {
      return redirect('/creator/login?error=config_error');
    }
    
    // Redirect to dashboard
    const response = redirect('/creator/dashboard');
    response.headers.set('Set-Cookie', cookieHeader);
    
    return response;
  }
  
  // Default: client-side hash fragment handling
  // Hash fragments are not sent to server, so we handle them client-side
  return {mode: 'client'};
}

export async function action({request, context}) {
  const formData = await request.formData();
  const accessToken = formData.get('access_token');
  const refreshToken = formData.get('refresh_token');
  const expiresAt = formData.get('expires_at');
  const expiresIn = formData.get('expires_in');
  const tokenType = formData.get('token_type');
  const userEmail = formData.get('user_email');
  const userId = formData.get('user_id');
  
  const {env} = context;
  
  if (!accessToken || !userEmail) {
    return redirect('/creator/login?error=invalid_token');
  }
  
  // Validate environment variables
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.error('Missing Supabase environment variables');
    return redirect('/creator/login?error=config_error');
  }
  
  // Determine if we're in a secure context
  const isSecure = request.url.startsWith('https://') || 
                   request.headers.get('x-forwarded-proto') === 'https' ||
                   env.NODE_ENV === 'production';
  
  // Create session object for cookie creation
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken || '',
    expires_at: expiresAt || '',
    expires_in: parseInt(expiresIn, 10) || 3600,
    token_type: tokenType || 'bearer',
    user: {
      id: userId || '',
      email: userEmail,
    },
  };
  
  // Create session cookie using helper function
  const cookieHeader = createSessionCookie(session, env.SUPABASE_URL, isSecure);
  
  if (!cookieHeader) {
    return redirect('/creator/login?error=config_error');
  }
  
  // Always redirect to dashboard after successful authentication
  // Profile creation can be handled on the dashboard if needed
  const redirectUrl = '/creator/dashboard';
  
  // Create response with cookie
  const response = redirect(redirectUrl);
  response.headers.set('Set-Cookie', cookieHeader);
  
  return response;
}

export default function AuthCallback() {
  const {mode} = useLoaderData();
  const [error, setError] = useState(null);
  
  useEffect(() => {
    // Handle client-side hash fragment (Supabase magic links and OAuth)
    if (mode === 'client') {
      // First check query params for OAuth code (server-side exchange)
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      
      if (code) {
        // OAuth code - reload page to trigger server-side exchange in loader
        // Remove hash to avoid double processing
        window.location.href = window.location.pathname + '?code=' + code;
        return;
      }
      
      // Check hash fragments for tokens (magic links or OAuth tokens)
      const hash = window.location.hash.substring(1); // Remove #
      const params = new URLSearchParams(hash);
      
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const expiresAt = params.get('expires_at');
      const expiresIn = params.get('expires_in');
      const tokenType = params.get('token_type');
      const type = params.get('type');
      
      // Handle both magic links and OAuth (both can have access_token in hash)
      if (accessToken) {
        // Extract user info from token (basic JWT decode)
        try {
          const payload = JSON.parse(atob(accessToken.split('.')[1]));
          const userEmail = payload.email;
          const userId = payload.sub;
          
          if (!userEmail || !userId) {
            throw new Error('Missing email or user ID in token payload');
          }
          
          // Submit form to set session cookie
          const form = document.createElement('form');
          form.method = 'POST';
          form.style.display = 'none';
          
          form.appendChild(createInput('access_token', accessToken));
          form.appendChild(createInput('refresh_token', refreshToken || ''));
          form.appendChild(createInput('expires_at', expiresAt || ''));
          form.appendChild(createInput('expires_in', expiresIn || '3600'));
          form.appendChild(createInput('token_type', tokenType || 'bearer'));
          form.appendChild(createInput('user_email', userEmail));
          form.appendChild(createInput('user_id', userId));
          
          document.body.appendChild(form);
          form.submit();
        } catch (err) {
          console.error('Error processing auth callback:', err);
          console.error('Hash:', hash);
          console.error('Access token present:', !!accessToken);
          setError('Failed to process authentication. Please try again.');
          setTimeout(() => {
            window.location.href = '/creator/login?error=token_parse_error';
          }, 2000);
        }
      } else {
        // No tokens found - log for debugging
        console.error('No access token found in hash or query params');
        console.error('Hash:', hash);
        console.error('Query params:', window.location.search);
        setError('Invalid authentication token.');
        setTimeout(() => {
          window.location.href = '/creator/login?error=invalid_token';
        }, 2000);
      }
    }
  }, [mode]);
  
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error}</p>
          <p className="mt-2 text-sm text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <p className="text-gray-600">Completing authentication...</p>
      </div>
    </div>
  );
}

function createInput(name, value) {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  return input;
}

/** @typedef {import('./+types/creator.auth.callback').Route} Route */

