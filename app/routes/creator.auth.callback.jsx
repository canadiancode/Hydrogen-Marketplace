import {redirect, useLoaderData} from 'react-router';
import {useEffect, useState} from 'react';

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
    return {mode: 'oauth', code};
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
  
  // Set session cookie
  const urlMatch = env.SUPABASE_URL.match(/https?:\/\/([^.]+)\.supabase\.co/);
  const projectRef = urlMatch ? urlMatch[1] : null;
  
  if (!projectRef) {
    return redirect('/creator/login?error=config_error');
  }
  
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken || '',
    expires_at: expiresAt || '',
    expires_in: expiresIn || 3600,
    token_type: tokenType || 'bearer',
    user: {
      id: userId || '',
      email: userEmail,
    },
  });
  
  // Always redirect to dashboard after successful authentication
  // Profile creation can be handled on the dashboard if needed
  const redirectUrl = '/creator/dashboard';
  
  // Create response with cookie
  const response = redirect(redirectUrl);
  response.headers.set(
    'Set-Cookie',
    `${cookieName}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expiresIn || 3600}${request.url.startsWith('https://') ? '; Secure' : ''}`
  );
  
  return response;
}

export default function AuthCallback() {
  const {mode} = useLoaderData();
  const [error, setError] = useState(null);
  
  useEffect(() => {
    // Handle client-side hash fragment (Supabase magic links)
    if (mode === 'client') {
      const hash = window.location.hash.substring(1); // Remove #
      const params = new URLSearchParams(hash);
      
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const expiresAt = params.get('expires_at');
      const expiresIn = params.get('expires_in');
      const tokenType = params.get('token_type');
      const type = params.get('type');
      
      if (accessToken && type === 'magiclink') {
        // Extract user info from token (basic JWT decode)
        try {
          const payload = JSON.parse(atob(accessToken.split('.')[1]));
          const userEmail = payload.email;
          const userId = payload.sub;
          
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
          setError('Failed to process authentication. Please try again.');
          setTimeout(() => {
            window.location.href = '/creator/login?error=token_parse_error';
          }, 2000);
        }
      } else {
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

