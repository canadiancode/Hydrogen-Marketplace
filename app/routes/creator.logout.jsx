import {redirect, data} from 'react-router';
import {createClient} from '@supabase/supabase-js';
import {generateCSRFToken, validateCSRFToken} from '~/lib/auth-helpers';

export async function loader({request, context}) {
  const {env, session} = context;
  
  // Generate CSRF token for logout form
  const csrfToken = await generateCSRFToken(request, env.SESSION_SECRET);
  
  // Store CSRF token in session for validation in action
  // Note: session.set() marks session as pending, and server.js will commit it automatically
  // when session.isPending is true (see server.js line 72-76)
  session.set('csrf_token', csrfToken);
  
  return data({csrfToken}, {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

export async function action({request, context}) {
  const {env, session} = context;
  
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return redirect('/creator/login');
  }
  
  // CSRF protection: Validate CSRF token from session
  const formData = await request.formData();
  const receivedToken = formData.get('csrf_token');
  const storedToken = session.get('csrf_token');
  
  // Validate CSRF token
  if (!receivedToken || !storedToken) {
    return redirect('/creator/login?error=csrf_validation_failed');
  }
  
  // Use proper CSRF validation with signature verification
  const isValid = await validateCSRFToken(request, storedToken, env.SESSION_SECRET);
  
  if (!isValid) {
    return redirect('/creator/login?error=csrf_validation_failed');
  }
  
  // Clear CSRF token from session after successful validation
  session.unset('csrf_token');
  
  // Clear the session cookie
  const projectRef = env.SUPABASE_URL.split('//')[1]?.split('.')[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  
  // Determine if we're in a secure context (production or HTTPS)
  const isSecure = request.url.startsWith('https://') || 
                   request.headers.get('x-forwarded-proto') === 'https' ||
                   env.NODE_ENV === 'production';
  const secureFlag = isSecure ? '; Secure' : '';
  
  // Create response that clears the cookie
  // Use SameSite=Strict to match session cookie settings for consistency
  const response = redirect('/creator/login');
  response.headers.set(
    'Set-Cookie',
    `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`
  );
  
  // Also sign out from Supabase
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  
  // Get the session to sign out
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, ...valueParts] = cookie.trim().split('=');
    if (key && valueParts.length > 0) {
      acc[key.trim()] = decodeURIComponent(valueParts.join('='));
    }
    return acc;
  }, {});
  
  if (cookies[cookieName]) {
    try {
      const sessionData = JSON.parse(cookies[cookieName]);
      if (sessionData?.access_token) {
        // Sign out from Supabase
        await supabase.auth.signOut();
      }
    } catch (err) {
      // Log error without exposing sensitive session data
      console.error('Error during logout:', err.message || 'Unknown error');
    }
  }
  
  return response;
}

/** @typedef {import('./+types/creator.logout').Route} Route */

