import {useLoaderData, Link, redirect, Form, useActionData, useNavigation, useSearchParams} from 'react-router';
import {checkAdminAuth, fetchAdminCreatorById, createServerSupabaseClient} from '~/lib/supabase';
import {decodeHTMLEntities} from '~/lib/html-entities';
import {generateCSRFToken, getClientIP, constantTimeEquals} from '~/lib/auth-helpers';
import {rateLimitMiddleware} from '~/lib/rate-limit';

export const meta = ({data}) => {
  return [{title: `WornVault | Creator ${data?.creator?.display_name ?? data?.creator?.email ?? data?.creator?.id ?? ''}`}];
};

// Ensure loader revalidates after form submission
export const shouldRevalidate = ({formMethod}) => {
  // Revalidate when a mutation is performed (POST, PUT, DELETE, etc.)
  if (formMethod && formMethod !== 'GET') return true;
  return false;
};

export async function loader({params, request, context}) {
  // Require admin authentication
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    throw redirect('/creator/login?error=admin_access_required');
  }
  
  const {id} = params;
  
  // Validate UUID format
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_REGEX.test(id)) {
    throw new Response('Invalid creator ID', {status: 400});
  }
  
  const supabaseUrl = context.env.SUPABASE_URL;
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase configuration for admin creator detail');
    return {
      creator: null,
      error: 'Server configuration error. Please ensure SUPABASE_SERVICE_ROLE_KEY is set.',
    };
  }
  
  // Fetch creator data from Supabase
  const creator = await fetchAdminCreatorById(id, supabaseUrl, serviceRoleKey);
  
  if (!creator) {
    throw new Response('Creator not found', {status: 404});
  }
  
  // Generate CSRF token for form protection
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  
  return {
    creator,
    csrfToken,
  };
}

export async function action({params, request, context}) {
  // Require admin authentication
  const {isAdmin, user} = await checkAdminAuth(request, context.env);
  
  if (!isAdmin || !user) {
    return new Response('Unauthorized', {status: 403});
  }
  
  const {id} = params;
  
  // Validate UUID format
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_REGEX.test(id)) {
    return new Response('Invalid creator ID', {status: 400});
  }
  
  // Rate limiting: max 10 requests per minute per admin
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(
    request,
    `admin-verify-paypal:${user.email}:${clientIP}`,
    {
      maxRequests: 10,
      windowMs: 60000, // 1 minute
    },
  );
  
  if (!rateLimit.allowed) {
    return new Response('Too many requests. Please wait a moment before trying again.', {
      status: 429,
    });
  }
  
  const formData = await request.formData();
  
  // Validate CSRF token
  const csrfToken = formData.get('csrf_token')?.toString();
  const storedCSRFToken = context.session.get('csrf_token');
  
  if (!csrfToken || !storedCSRFToken || !constantTimeEquals(csrfToken, storedCSRFToken)) {
    return new Response('Invalid security token. Please refresh the page and try again.', {
      status: 403,
    });
  }
  
  // Clear CSRF token after use
  context.session.unset('csrf_token');
  
  // Get action type
  const actionType = formData.get('actionType')?.toString();
  
  if (actionType === 'verify_paypal_email') {
    const supabaseUrl = context.env.SUPABASE_URL;
    const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response('Server configuration error', {status: 500});
    }
    
    try {
      const supabase = createServerSupabaseClient(supabaseUrl, serviceRoleKey);
      
      // Update PayPal email verification status
      const {error} = await supabase
        .from('creators')
        .update({
          paypal_email_verified: true,
          paypal_email_verified_at: new Date().toISOString(),
        })
        .eq('id', id);
      
      if (error) {
        console.error('Error verifying PayPal email:', error);
        return new Response(`Failed to verify PayPal email: ${error.message}`, {status: 500});
      }
      
      // Redirect back to creator detail page with success message
      return redirect(`/admin/creators/${id}?paypalVerified=true`);
    } catch (error) {
      console.error('Error in PayPal verification:', error);
      return new Response('An unexpected error occurred', {status: 500});
    }
  }
  
  return new Response('Invalid action', {status: 400});
}

export default function AdminCreatorDetail() {
  const {creator, error, csrfToken} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === 'submitting';
  
  // Check for success message from URL params
  const paypalVerified = searchParams.get('paypalVerified') === 'true';
  
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      </div>
    );
  }
  
  if (!creator) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg p-6">
            <p className="text-gray-700 dark:text-gray-300">Creator not found.</p>
          </div>
        </div>
      </div>
    );
  }
  
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  const formatCurrency = (dollars) => {
    return `$${dollars.toFixed(2)}`;
  };
  
  const VerificationStatusBadge = ({status}) => {
    if (status === 'approved' || status === 'verified') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400">
          Verified
        </span>
      );
    }
    
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-50 text-yellow-800 dark:bg-yellow-400/10 dark:text-yellow-500">
          Pending
        </span>
      );
    }
    
    if (status === 'rejected') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-400">
          Rejected
        </span>
      );
    }
    
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-50 text-gray-600 dark:bg-gray-400/10 dark:text-gray-400">
        Unknown
      </span>
    );
  };
  
  const ListingStatusBadge = ({status}) => {
    const statusConfig = {
      draft: {bg: 'bg-gray-50', text: 'text-gray-600', label: 'Draft'},
      pending_approval: {bg: 'bg-yellow-50', text: 'text-yellow-800', label: 'Pending Approval'},
      live: {bg: 'bg-green-50', text: 'text-green-700', label: 'Live'},
      sold: {bg: 'bg-blue-50', text: 'text-blue-700', label: 'Sold'},
      in_validation: {bg: 'bg-purple-50', text: 'text-purple-700', label: 'In Validation'},
      shipped: {bg: 'bg-indigo-50', text: 'text-indigo-700', label: 'Shipped'},
      completed: {bg: 'bg-green-50', text: 'text-green-700', label: 'Completed'},
      rejected: {bg: 'bg-red-50', text: 'text-red-700', label: 'Rejected'},
    };
    
    const config = statusConfig[status] || statusConfig.draft;
    
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };
  
  const PayoutStatusBadge = ({status}) => {
    const statusConfig = {
      pending: {bg: 'bg-yellow-50', text: 'text-yellow-800', label: 'Pending'},
      processing: {bg: 'bg-blue-50', text: 'text-blue-700', label: 'Processing'},
      paid: {bg: 'bg-green-50', text: 'text-green-700', label: 'Paid'},
    };
    
    const config = statusConfig[status] || statusConfig.pending;
    
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  /**
   * Social Links Display Component
   * Displays social media links with icons in a modern card layout
   */
  const SocialLinksDisplay = ({submittedLinks}) => {
    if (!submittedLinks || typeof submittedLinks !== 'object') {
      return (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">No social media links submitted</p>
      );
    }

    // Extract social links from various possible field names
    const socialLinks = {
      instagram: submittedLinks.instagram_url || submittedLinks.instagram || null,
      facebook: submittedLinks.facebook_url || submittedLinks.facebook || null,
      tiktok: submittedLinks.tiktok_url || submittedLinks.tiktok || null,
      x: submittedLinks.x_url || submittedLinks.x || submittedLinks.twitter_url || submittedLinks.twitter || null,
      youtube: submittedLinks.youtube_url || submittedLinks.youtube || null,
      twitch: submittedLinks.twitch_url || submittedLinks.twitch || null,
    };

    // Filter out null values
    const availableLinks = Object.entries(socialLinks).filter(([_, url]) => url);

    if (availableLinks.length === 0) {
      return (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">No social media links submitted</p>
      );
    }

    const getIcon = (platform) => {
      const iconProps = { className: 'size-5', fill: 'currentColor', viewBox: '0 0 24 24' };
      
      switch (platform) {
        case 'instagram':
          return (
            <svg {...iconProps}>
              <path fillRule="evenodd" d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z" clipRule="evenodd" />
            </svg>
          );
        case 'facebook':
          return (
            <svg {...iconProps}>
              <path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" clipRule="evenodd" />
            </svg>
          );
        case 'tiktok':
          return (
            <svg {...iconProps}>
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
            </svg>
          );
        case 'x':
          return (
            <svg {...iconProps}>
              <path d="M13.6823 10.6218L20.2391 3H18.6854L12.9921 9.61788L8.44486 3H3.2002L10.0765 13.0074L3.2002 21H4.75404L10.7663 14.0113L15.5685 21H20.8131L13.6819 10.6218H13.6823ZM11.5541 13.0956L10.8574 12.0991L5.31391 4.16971H7.70053L12.1742 10.5689L12.8709 11.5655L18.6861 19.8835H16.2995L11.5541 13.096V13.0956Z" />
            </svg>
          );
        case 'youtube':
          return (
            <svg {...iconProps}>
              <path fillRule="evenodd" d="M19.812 5.418c.861.23 1.538.907 1.768 1.768C21.998 8.746 22 12 22 12s0 3.255-.418 4.814a2.504 2.504 0 0 1-1.768 1.768c-1.56.419-7.814.419-7.814.419s-6.255 0-7.814-.419a2.505 2.505 0 0 1-1.768-1.768C2 15.255 2 12 2 12s0-3.255.417-4.814a2.507 2.507 0 0 1 1.768-1.768C5.744 5 11.998 5 11.998 5s6.255 0 7.814.418ZM15.194 12 10 15V9l5.194 3Z" clipRule="evenodd" />
            </svg>
          );
        case 'twitch':
          return (
            <svg {...iconProps}>
              <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
            </svg>
          );
        default:
          return null;
      }
    };

    const getPlatformName = (platform) => {
      const names = {
        instagram: 'Instagram',
        facebook: 'Facebook',
        tiktok: 'TikTok',
        x: 'X (Twitter)',
        youtube: 'YouTube',
        twitch: 'Twitch',
      };
      return names[platform] || platform;
    };

    const getPlatformColor = (platform) => {
      const colors = {
        instagram: 'hover:text-pink-600 dark:hover:text-pink-400',
        facebook: 'hover:text-blue-600 dark:hover:text-blue-400',
        tiktok: 'hover:text-black dark:hover:text-white',
        x: 'hover:text-gray-900 dark:hover:text-white',
        youtube: 'hover:text-red-600 dark:hover:text-red-400',
        twitch: 'hover:text-purple-600 dark:hover:text-purple-400',
      };
      return colors[platform] || '';
    };

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {availableLinks.map(([platform, url]) => (
          <a
            key={platform}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 transition-all hover:shadow-sm"
          >
            <div className={`flex-shrink-0 text-gray-400 dark:text-gray-500 ${getPlatformColor(platform)} transition-colors`}>
              {getIcon(platform)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                {getPlatformName(platform)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                {url.replace(/^https?:\/\//, '').replace(/^www\./, '')}
              </p>
            </div>
            <svg
              className="flex-shrink-0 size-4 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ))}
      </div>
    );
  };
  
  const displayName = creator.display_name || 
    `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || 
    creator.email || 
    'Unknown';
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">{displayName}</h1>
              <VerificationStatusBadge status={creator.verification_status} />
            </div>
            <Link
              to="/admin/creators"
              className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
            >
              ← Back to Creators
            </Link>
          </div>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            View creator details, listings, payouts, and verification information.
          </p>
        </div>
        
        <div className="space-y-6">
          {/* Creator Details */}
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Creator Details</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Creator ID</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{creator.id}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Verification Status</dt>
                <dd className="mt-1">
                  <VerificationStatusBadge status={creator.verification_status} />
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Email</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.email}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Handle</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">@{creator.handle || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Display Name</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.display_name || 'N/A'}</dd>
              </div>
              {creator.first_name && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">First Name</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.first_name}</dd>
                </div>
              )}
              {creator.last_name && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Last Name</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.last_name}</dd>
                </div>
              )}
              {creator.primary_platform && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Primary Platform</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.primary_platform}</dd>
                </div>
              )}
              {creator.payout_method && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Payout Method</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.payout_method}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created At</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatDate(creator.created_at)}</dd>
              </div>
              {creator.profile_image_url && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Profile Image</dt>
                  <dd className="mt-1">
                    <img
                      src={creator.profile_image_url}
                      alt={displayName}
                      className="h-24 w-24 rounded-full object-cover"
                    />
                  </dd>
                </div>
              )}
              {creator.bio && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Bio</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{decodeHTMLEntities(creator.bio)}</dd>
                </div>
              )}
            </dl>
          </section>
          
          {/* PayPal Payout Verification */}
          {creator.payout_method === 'paypal' && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">PayPal Payout Information</h2>
              
              {paypalVerified && (
                <div className="mb-4 rounded-md bg-green-50 dark:bg-green-900/20 p-4 border border-green-200 dark:border-green-800">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    PayPal email has been verified successfully.
                  </p>
                </div>
              )}
              
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">PayPal Email</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {creator.paypal_email || (
                      <span className="text-gray-400 dark:text-gray-500 italic">Not set</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Verification Status</dt>
                  <dd className="mt-1">
                    {creator.paypal_email_verified ? (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400">
                        <svg className="mr-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a1 1 0 00-1.714-1.029L9.5 9.5 8.207 8.207a1 1 0 00-1.414 1.414l1.5 1.5a1 1 0 001.414 0l3-3z" clipRule="evenodd" />
                        </svg>
                        Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-50 text-yellow-800 dark:bg-yellow-400/10 dark:text-yellow-500">
                        <svg className="mr-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        Pending Verification
                      </span>
                    )}
                  </dd>
                </div>
                {creator.paypal_email_verified_at && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Verified At</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatDate(creator.paypal_email_verified_at)}</dd>
                  </div>
                )}
                {creator.paypal_payer_id && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">PayPal Payer ID</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{creator.paypal_payer_id}</dd>
                  </div>
                )}
              </dl>
              
              {creator.paypal_email && !creator.paypal_email_verified && (
                <Form method="post" className="mt-4">
                  <input type="hidden" name="csrf_token" value={csrfToken} />
                  <input type="hidden" name="actionType" value="verify_paypal_email" />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-green-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-green-500 dark:shadow-none dark:hover:bg-green-400 dark:focus-visible:outline-green-400"
                  >
                    {isSubmitting ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Verifying...
                      </>
                    ) : (
                      <>
                        <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a1 1 0 00-1.714-1.029L9.5 9.5 8.207 8.207a1 1 0 00-1.414 1.414l1.5 1.5a1 1 0 001.414 0l3-3z" clipRule="evenodd" />
                        </svg>
                        Verify PayPal Email
                      </>
                    )}
                  </button>
                </Form>
              )}
            </section>
          )}
          
          {/* Stats Summary */}
          <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Statistics</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Listings</dt>
                <dd className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{creator.totalListings || 0}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Payouts</dt>
                <dd className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{creator.totalPayouts || 0}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Earnings</dt>
                <dd className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(creator.totalEarnings || 0)}
                </dd>
              </div>
            </dl>
          </section>
          
          {/* Verification Information */}
          {creator.verification && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Verification Information</h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {creator.verification.reviewed_by && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Reviewed By</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">{creator.verification.reviewed_by}</dd>
                  </div>
                )}
                {creator.verification.internal_notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Internal Notes</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{creator.verification.internal_notes}</dd>
                  </div>
                )}
                {creator.verification.submitted_links && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Social Media Links</dt>
                    <dd className="mt-1">
                      <SocialLinksDisplay submittedLinks={creator.verification.submitted_links} />
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}
          
          {/* Listings */}
          {creator.listings && creator.listings.length > 0 && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Listings ({creator.listings.length})</h2>
              <div className="space-y-3">
                {creator.listings.map((listing) => (
                  <div key={listing.id} className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {listing.id ? (
                            <Link
                              to={`/admin/listings/${listing.id}`}
                              className="text-sm font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
                            >
                              {listing.title}
                            </Link>
                          ) : (
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {listing.title}
                            </span>
                          )}
                          <ListingStatusBadge status={listing.status} />
                        </div>
                        <div className="flex items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>Price: {formatCurrency(listing.priceDollars)}</span>
                          {listing.category && (
                            <>
                              <span>•</span>
                              <span>{listing.category}</span>
                            </>
                          )}
                          <span>•</span>
                          <span>Created: {formatDate(listing.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          
          {/* Payouts */}
          {creator.payouts && creator.payouts.length > 0 && (
            <section className="bg-white dark:bg-white/5 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-white/10">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Payouts ({creator.payouts.length})</h2>
              <div className="space-y-3">
                {creator.payouts.map((payout) => (
                  <div key={payout.id} className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Payout ID</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{payout.id}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Status</dt>
                        <dd className="mt-1">
                          <PayoutStatusBadge status={payout.payout_status} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Gross Amount</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white font-semibold">{formatCurrency(payout.grossAmountDollars)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Platform Fee</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatCurrency(payout.platformFeeDollars)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Net Amount</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white font-semibold">{formatCurrency(payout.netAmountDollars)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Created At</dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatDate(payout.created_at)}</dd>
                      </div>
                      {payout.payout_reference && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Reference</dt>
                          <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{payout.payout_reference}</dd>
                        </div>
                      )}
                      {payout.listing_id && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Listing</dt>
                          <dd className="mt-1">
                            <Link
                              to={`/admin/listings/${payout.listing_id}`}
                              className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                            >
                              View Listing
                            </Link>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/admin.creators.$id').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
