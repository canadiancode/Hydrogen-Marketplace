import {Form, useLoaderData, redirect} from 'react-router';
import {checkAdminAuth} from '~/lib/supabase';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {generateCSRFToken, getClientIP} from '~/lib/auth-helpers';
import {sanitizeHTML} from '~/lib/sanitize';

export const meta = ({data}) => {
  return [{title: `WornVault | Review Listing ${data?.listing.id ?? ''}`}];
};

export async function loader({params, request, context}) {
  // Require admin authentication
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  const {id} = params;
  
  // Generate CSRF token for form protection
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  
  // Fetch listing data from Supabase
  // const listing = await fetchListingById(context, id);
  
  return {
    listing: {
      id,
      title: 'Listing Title',
      referencePhotos: [],
      creatorInfo: {},
    },
    csrfToken,
  };
}

export async function action({request, params, context}) {
  // Require admin authentication
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    return new Response('Unauthorized', {status: 403});
  }
  
  // Rate limiting: max 20 admin actions per minute
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(
    request,
    `admin-action:${user.email}:${clientIP}`,
    {
      maxRequests: 20,
      windowMs: 60000, // 1 minute
    },
  );
  
  if (!rateLimit.allowed) {
    return new Response('Rate limit exceeded. Please wait a moment before trying again.', {
      status: 429,
      headers: {
        'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
      },
    });
  }
  
  // CSRF protection with constant-time validation to prevent timing attacks
  const formData = await request.formData();
  const csrfToken = formData.get('csrf_token');
  const storedToken = context.session.get('csrf_token');
  
  if (!csrfToken || !storedToken) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  // Constant-time comparison to prevent timing attacks
  if (csrfToken.length !== storedToken.length) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  let result = 0;
  for (let i = 0; i < csrfToken.length; i++) {
    result |= csrfToken.charCodeAt(i) ^ storedToken.charCodeAt(i);
  }
  
  if (result !== 0) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  // Clear CSRF token after use (one-time use)
  context.session.unset('csrf_token');
  
  // Validate and sanitize action parameter
  const actionValue = formData.get('action');
  const validActions = ['approve', 'reject'];
  const sanitizedAction = String(actionValue || '').trim().toLowerCase();
  
  if (!validActions.includes(sanitizedAction)) {
    return new Response('Invalid action. Must be "approve" or "reject".', {status: 400});
  }
  
  // Validate and sanitize notes - prevent XSS
  const rawNotes = formData.get('notes')?.toString() || '';
  const MAX_NOTES_LENGTH = 1000;
  const sanitizedNotes = sanitizeHTML(rawNotes.trim()).substring(0, MAX_NOTES_LENGTH);
  
  // Validate listing ID parameter - prevent injection
  const {id} = params;
  if (!id || typeof id !== 'string') {
    return new Response('Invalid listing ID', {status: 400});
  }
  
  // Validate UUID format (36 chars with hyphens or 32 without)
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const sanitizedId = id.trim();
  
  if (sanitizedId.length < 32 || sanitizedId.length > 36 || !UUID_REGEX.test(sanitizedId)) {
    return new Response('Invalid listing ID format', {status: 400});
  }
  
  // Update listing status in Supabase
  // await updateListingStatus(context, params.id, {
  //   status: actionValue === 'approve' ? 'approved' : 'rejected',
  //   adminNotes: sanitizedNotes,
  // });
  
  return redirect('/admin');
}

export default function AdminListingReview() {
  const {listing, csrfToken} = useLoaderData();
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Review Listing</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Review listing details, reference photos, and creator information. Approve or reject listings with internal notes.
          </p>
        </div>
        
        <div className="space-y-6">
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Listing Details</h2>
            <div className="space-y-2">
              <p className="text-gray-700 dark:text-gray-300"><span className="font-medium">ID:</span> {listing.id}</p>
              <p className="text-gray-700 dark:text-gray-300"><span className="font-medium">Title:</span> {listing.title}</p>
            </div>
          </section>
          
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Reference Photos</h2>
            {/* Display reference photos */}
          </section>
          
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Creator Info</h2>
            {/* Display creator information */}
          </section>
          
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <Form method="post" className="space-y-6">
              <input type="hidden" name="csrf_token" value={csrfToken} />
              <div>
                <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Internal Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={4}
                  maxLength={1000}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-white/10 rounded-md shadow-sm bg-white dark:bg-white/5 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-indigo-500 dark:focus:border-indigo-400"
                />
              </div>
              
              <div className="flex gap-4">
                <button
                  type="submit"
                  name="action"
                  value="approve"
                  className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 dark:focus:ring-offset-gray-900 dark:focus:ring-green-400"
                >
                  Approve
                </button>
                <button
                  type="submit"
                  name="action"
                  value="reject"
                  className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 dark:focus:ring-offset-gray-900 dark:focus:ring-red-400"
                >
                  Reject
                </button>
              </div>
            </Form>
          </section>
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/admin.listings.$id').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

