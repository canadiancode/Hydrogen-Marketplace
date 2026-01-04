import {Form, redirect, useActionData, useLoaderData} from 'react-router';
import {checkCreatorAuth, sendMagicLink, initiateGoogleOAuth} from '~/lib/supabase';
import {getClientIP, generateCSRFToken, constantTimeEquals} from '~/lib/auth-helpers';
import {rateLimit} from '~/lib/rate-limit';
import {validateAndSanitizeEmail} from '~/lib/validation';

export const meta = () => {
  return [{title: 'WornVault | Creator Login'}];
};

/**
 * Route handle - login page should show footer (override parent route)
 */
export const handle = {
  hideHeaderFooter: false,
};

export async function loader({context, request}) {
  // Check if already authenticated via Supabase
  const {isAuthenticated} = await checkCreatorAuth(request, context.env);
  if (isAuthenticated) {
    // If authenticated and returnTo is provided, redirect there
    const url = new URL(request.url);
    const returnTo = url.searchParams.get('returnTo');
    if (returnTo && returnTo.startsWith('/')) {
      // Validate it's a safe internal URL
      if (!returnTo.includes('//') && !returnTo.startsWith('http')) {
        return redirect(returnTo);
      }
    }
    return redirect('/creator/dashboard');
  }
  
  // Generate CSRF token for form protection
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  
  // Get returnTo from query params to pass to component
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('returnTo');
  const message = url.searchParams.get('message');
  
  return {csrfToken, returnTo, message};
}

export async function action({request, context}) {
  const formData = await request.formData();
  const email = formData.get('email');
  const authMethod = formData.get('authMethod'); // 'magic-link' or 'google'
  
  const {env} = context;
  
  // Validate environment variables
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.error('Missing Supabase environment variables');
    return {error: 'Server configuration error. Please contact support.'};
  }
  
  // CSRF protection: Validate CSRF token using constant-time comparison
  const csrfToken = formData.get('csrf_token')?.toString();
  const storedCSRFToken = context.session.get('csrf_token');
  
  if (!csrfToken || !storedCSRFToken || !constantTimeEquals(csrfToken, storedCSRFToken)) {
    console.error('CSRF token validation failed', {
      hasCsrfToken: !!csrfToken,
      hasStoredToken: !!storedCSRFToken,
    });
    return {error: 'Invalid security token. Please refresh the page and try again.'};
  }
  
  // Check if CSRF token was already used (prevent replay attacks)
  const csrfUsed = context.session.get('csrf_token_used');
  if (csrfUsed === csrfToken) {
    console.error('CSRF token already used');
    return {error: 'Security token has already been used. Please refresh the page and try again.'};
  }
  
  // Mark CSRF token as used and clear it (one-time use)
  context.session.set('csrf_token_used', csrfToken);
  context.session.unset('csrf_token');
  
  // Rate limiting: 50 requests per 15 minutes per IP (increased for frequent refreshes)
  // ⚠️ PRODUCTION NOTE: This uses in-memory rate limiting which doesn't work
  // in distributed environments (Cloudflare Workers). For production, use:
  // rateLimitWithKV(env.RATE_LIMIT_KV, rateLimitKey, 50, 15 * 60 * 1000)
  const clientIP = getClientIP(request);
  const rateLimitKey = `auth:${clientIP}`;
  if (!(await rateLimit(rateLimitKey, 50, 15 * 60 * 1000))) {
    return {error: 'Too many requests. Please try again in a few minutes.'};
  }
  
  // Preserve returnTo parameter through auth flow
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('returnTo');
  const redirectToUrl = new URL('/creator/auth/callback', request.url);
  if (returnTo) {
    redirectToUrl.searchParams.set('returnTo', returnTo);
  }
  const redirectTo = redirectToUrl.toString();
  
  if (authMethod === 'magic-link') {
    if (!email) {
      return {error: 'Email is required'};
    }
    
    // Validate and sanitize email
    const {valid, sanitized} = validateAndSanitizeEmail(email);
    if (!valid) {
      return {error: 'Please enter a valid email address'};
    }
    
    // Send magic link via Supabase Auth (use sanitized email)
    const {error, data} = await sendMagicLink(
      sanitized,
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY,
      redirectTo,
    );
    
    if (error) {
      // Log error without exposing sensitive details
      console.error('Magic link error:', error.message || 'Unknown error');
      // Return user-friendly error message (don't expose internal error details)
      return {error: 'Failed to send magic link. Please try again.'};
    }
    
    // Success - magic link sent
    // Note: Supabase always returns success even if email doesn't exist
    // (for security - prevents email enumeration)
    return {
      success: true,
      message: 'Check your email for the magic link! If you don\'t see it, check your spam folder.',
    };
  }
  
  if (authMethod === 'google') {
    try {
      // Initiate Google OAuth flow
      const {url, error} = await initiateGoogleOAuth(
        env.SUPABASE_URL,
        env.SUPABASE_ANON_KEY,
        redirectTo,
      );
      
      if (error) {
        // Log error without exposing sensitive details
        console.error('Google OAuth error:', error.message || 'Unknown error');
        return {error: 'Failed to initiate Google sign-in'};
      }
      
      if (url) {
        return redirect(url);
      }
      
      console.error('Google OAuth returned no URL');
      return {error: 'Failed to initiate Google OAuth. Please try again.'};
    } catch (err) {
      // Log error without exposing sensitive details
      console.error('Google OAuth exception:', err.message || 'Unknown error');
      return {error: 'An unexpected error occurred'};
    }
  }
  
  return {error: 'Invalid authentication method'};
}

export default function CreatorLogin() {
  const actionData = useActionData();
  const {csrfToken, returnTo, message} = useLoaderData();
  
  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mx-auto mt-6 max-w-2xl text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-gray-900 sm:text-3xl dark:text-white">
            Welcome to WornVault
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base/7 text-pretty text-gray-600 dark:text-gray-300">
            Sign in or create your creator account to access your private dashboard.
            We'll guide you through setup if you're new.
          </p>
        </div>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]">
        <div className="bg-white dark:bg-gray-800 px-6 py-12 shadow-sm sm:rounded-lg sm:px-12">
          {message && (
            <div className="mb-6 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
              <p className="text-sm text-blue-800 dark:text-blue-300">{message}</p>
            </div>
          )}
          
          {actionData?.error && (
            <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
              <p className="text-sm text-red-800 dark:text-red-300">{actionData.error}</p>
            </div>
          )}
          
          {actionData?.success && (
            <div className="mb-6 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
              <p className="text-sm text-green-800 dark:text-green-300">{actionData.message}</p>
            </div>
          )}
          
          <Form method="post" className="space-y-6">
            <input type="hidden" name="csrf_token" value={csrfToken} />
            <input type="hidden" name="authMethod" value="magic-link" />
            
            <div>
              <label htmlFor="email" className="block text-sm/6 font-medium text-gray-900 dark:text-gray-100">
                Email address
              </label>
              <div className="mt-2">
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="block w-full rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-base text-gray-900 dark:text-white outline-1 -outline-offset-1 outline-gray-300 dark:outline-gray-600 placeholder:text-gray-400 dark:placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 dark:focus:outline-indigo-500 sm:text-sm/6"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                Send magic link
              </button>
            </div>
          </Form>

          <div>
            <div className="mt-10 flex items-center gap-x-6">
              <div className="w-full flex-1 border-t border-gray-200 dark:border-gray-700" />
              <p className="text-sm/6 font-medium text-nowrap text-gray-900 dark:text-gray-100">Or continue with</p>
              <div className="w-full flex-1 border-t border-gray-200 dark:border-gray-700" />
            </div>

            <div className="mt-6">
              <Form method="post">
                <input type="hidden" name="csrf_token" value={csrfToken} />
                <input type="hidden" name="authMethod" value="google" />
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-3 rounded-md bg-white dark:bg-white/15 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white shadow-xs dark:shadow-none inset-ring inset-ring-gray-300 dark:inset-ring-white/5 hover:bg-gray-50 dark:hover:bg-white/20 focus-visible:inset-ring-transparent dark:focus-visible:outline-white"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                    <path
                      d="M12.0003 4.75C13.7703 4.75 15.3553 5.36002 16.6053 6.54998L20.0303 3.125C17.9502 1.19 15.2353 0 12.0003 0C7.31028 0 3.25527 2.69 1.28027 6.60998L5.27028 9.70498C6.21525 6.86002 8.87028 4.75 12.0003 4.75Z"
                      fill="#EA4335"
                    />
                    <path
                      d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L19.945 21.1C22.2 19.01 23.49 15.92 23.49 12.275Z"
                      fill="#4285F4"
                    />
                    <path
                      d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L16.0804 18.095C15.0054 18.82 13.6204 19.245 12.0004 19.245C8.8704 19.245 6.21537 17.135 5.2654 14.29L1.27539 17.385C3.25539 21.31 7.3104 24.0001 12.0004 24.0001Z"
                      fill="#34A853"
                    />
                  </svg>
                  <span className="text-sm/6 font-semibold">Continue with Google</span>
                </button>
              </Form>
            </div>
          </div>

          <p className="mt-8 text-center text-xs/5 text-pretty text-gray-500 dark:text-gray-400">
            Your email is used only for account access and platform communication.
            We never share personal information with buyers.
          </p>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.login').Route} Route */
