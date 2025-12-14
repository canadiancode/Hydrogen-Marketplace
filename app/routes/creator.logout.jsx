import {redirect} from 'react-router';
import {createClient} from '@supabase/supabase-js';

export async function action({request, context}) {
  const {env} = context;
  
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return redirect('/creator/login');
  }
  
  // Clear the session cookie
  const projectRef = env.SUPABASE_URL.split('//')[1]?.split('.')[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  
  // Create response that clears the cookie
  const response = redirect('/creator/login');
  response.headers.set(
    'Set-Cookie',
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
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
      console.error('Error during logout:', err);
    }
  }
  
  return response;
}

/** @typedef {import('./+types/creator.logout').Route} Route */

