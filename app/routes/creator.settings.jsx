import {useState, useEffect, useMemo} from 'react';
import {Form, useLoaderData, useActionData, useNavigation, redirect} from 'react-router';
import {requireAuth, generateCSRFToken, validateCSRFToken, getClientIP, constantTimeEquals} from '~/lib/auth-helpers';
import {fetchCreatorProfile, updateCreatorProfile} from '~/lib/supabase';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {sanitizeHTML} from '~/lib/sanitize';
import {decodeHTMLEntities} from '~/lib/html-entities';
import {ChevronDownIcon} from '@heroicons/react/16/solid';
import {createClient} from '@supabase/supabase-js';
import {verifyPayPalEmail} from '~/lib/paypal-verification';

export const meta = () => {
  return [{title: 'WornVault | Account Settings'}];
};

// Ensure loader revalidates after form submission
export const shouldRevalidate = ({formMethod}) => {
  // Revalidate when a mutation is performed (POST, PUT, DELETE, etc.)
  if (formMethod && formMethod !== 'GET') return true;
  return false;
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  // Fetch creator profile from Supabase
  let profile = null;
  if (user?.email && session?.access_token) {
    try {
      profile = await fetchCreatorProfile(
        user.email,
        context.env.SUPABASE_URL,
        context.env.SUPABASE_ANON_KEY,
        session.access_token,
      );
    } catch (error) {
      console.error('Error fetching creator profile:', error);
      // Continue with null profile - will use defaults
    }
  }
  
  // Generate CSRF token for form protection and store in session
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  // Note: Session will be committed automatically by React Router when isPending is true
  
  // Construct cover image URL from storage path if available
  let coverImageUrl = '';
  if (profile?.cover_image_storage_path) {
    const storagePath = profile.cover_image_storage_path;
    // If it's already a full URL, use it as-is
    if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
      coverImageUrl = storagePath;
    } else if (context.env.SUPABASE_URL) {
      // Construct the public URL from storage path
      // Format: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{path}
      const supabaseUrl = context.env.SUPABASE_URL.replace(/\/$/, ''); // Remove trailing slash
      coverImageUrl = `${supabaseUrl}/storage/v1/object/public/creator-cover-images/${storagePath}`;
    }
  }
  
  // Map database fields to form field names
  return {
    user,
    csrfToken,
    supabaseUrl: context.env.SUPABASE_URL || '',
    profile: profile
      ? {
          firstName: profile.first_name || '',
          lastName: profile.last_name || '',
          email: profile.email || user.email || '',
          username: profile.handle || '',
          displayName: profile.display_name || '',
          bio: profile.bio || '',
          payoutMethod: profile.payout_method || '',
          paypalEmail: profile.paypal_email || '',
          paypalEmailVerified: profile.paypal_email_verified || false,
          paypalPayerId: profile.paypal_payer_id || null,
          paypalEmailVerifiedAt: profile.paypal_email_verified_at || null,
          profileImageUrl: profile.profile_image_url || '',
          coverImageStoragePath: profile.cover_image_storage_path || '',
          coverImageUrl: coverImageUrl,
        }
      : {
          firstName: '',
          lastName: '',
          email: user.email || '',
          username: '',
          displayName: '',
          bio: '',
          payoutMethod: '',
          paypalEmail: '',
          paypalEmailVerified: false,
          paypalPayerId: null,
          paypalEmailVerifiedAt: null,
          profileImageUrl: '',
          coverImageStoragePath: '',
          coverImageUrl: '',
        },
  };
}

export async function action({request, context}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  if (!user?.email || !session?.access_token) {
    return {
      success: false,
      error: 'Authentication required',
    };
  }
  
  const formData = await request.formData();
  
  // Handle delete account action (logout only, no data deletion)
  // Check this BEFORE general rate limiting since it has stricter limits
  const actionType = formData.get('action')?.toString();
  if (actionType === 'deleteAccount') {
    // Rate limiting: stricter for account deletion
    const clientIP = getClientIP(request);
    const rateLimitKey = `delete-account:${user.email}:${clientIP}`;
    const rateLimit = await rateLimitMiddleware(request, rateLimitKey, {
      maxRequests: 3, // Stricter limit for account deletion
      windowMs: 300000, // 5 minutes
    });
    
    if (!rateLimit.allowed) {
      return {
        success: false,
        error: `Too many requests. Please wait before trying again. You can try again after ${new Date(rateLimit.resetAt).toLocaleTimeString()}.`,
        formSection: 'deleteAccount',
      };
    }
    
    // Validate CSRF token
    const csrfToken = formData.get('csrf_token')?.toString();
    const storedCSRFToken = context.session.get('csrf_token');
    
    if (!csrfToken || !storedCSRFToken || !constantTimeEquals(csrfToken, storedCSRFToken)) {
      return {
        success: false,
        error: 'Invalid security token. Please refresh the page and try again.',
        formSection: 'deleteAccount',
      };
    }
    
    // Clear CSRF token
    context.session.unset('csrf_token');
    
    // Logout: Clear Supabase session and redirect to login
    try {
      // Clear the Supabase session cookie
      const projectRef = context.env.SUPABASE_URL?.split('//')[1]?.split('.')[0];
      const cookieName = `sb-${projectRef}-auth-token`;
      
      // Determine if we're in a secure context
      const isSecure = request.url.startsWith('https://') || 
                       request.headers.get('x-forwarded-proto') === 'https' ||
                       context.env.NODE_ENV === 'production';
      const secureFlag = isSecure ? '; Secure' : '';
      
      // Sign out from Supabase
      const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_ANON_KEY, {
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
            await supabase.auth.signOut();
          }
        } catch (err) {
          console.error('Error during logout:', err.message || 'Unknown error');
        }
      }
      
      // Create redirect response that clears the cookie
      const response = redirect('/creator/login?message=account_logged_out');
      response.headers.set(
        'Set-Cookie',
        `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`
      );
      
      return response;
    } catch (error) {
      console.error('Error during account logout:', error);
      return {
        success: false,
        error: 'Failed to log out. Please try again.',
        formSection: 'deleteAccount',
      };
    }
  }
  
  // Rate limiting: max 10 requests per minute per user (for regular updates)
  const clientIP = getClientIP(request);
  const rateLimitKey = `settings:${user.email}:${clientIP}`;
  const rateLimit = await rateLimitMiddleware(request, rateLimitKey, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });
  
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Too many requests. Please wait a moment before trying again. You can try again after ${new Date(rateLimit.resetAt).toLocaleTimeString()}.`,
    };
  }
  
  // Extract form section identifier early (for error context)
  const formSection = formData.get('formSection')?.toString() || 'personal';
  
  // Validate CSRF token using constant-time comparison to prevent timing attacks
  const csrfToken = formData.get('csrf_token')?.toString();
  // Get CSRF token from session (stored during loader)
  const storedCSRFToken = context.session.get('csrf_token');
  
  if (!csrfToken || !storedCSRFToken || !constantTimeEquals(csrfToken, storedCSRFToken)) {
    return {
      success: false,
      error: 'Invalid security token. Please refresh the page and try again.',
      formSection,
    };
  }
  
  // Clear CSRF token after use (one-time use for better security)
  context.session.unset('csrf_token');
  
  try {
    // Handle profile image upload if provided
    const imageFile = formData.get('profileImage');
    let imageUrl = null;
    
    if (imageFile && imageFile instanceof File && imageFile.size > 0) {
      // Validate file before upload
      const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
      const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      
      // Check file size
      if (imageFile.size > MAX_IMAGE_SIZE) {
        return {
          success: false,
          error: 'Image file size exceeds 5MB limit. Please choose a smaller image.',
        };
      }
      
      // Check file is not empty
      if (imageFile.size === 0) {
        return {
          success: false,
          error: 'Image file is empty. Please select a valid image.',
        };
      }
      
      // Validate MIME type
      if (!ALLOWED_IMAGE_TYPES.includes(imageFile.type)) {
        return {
          success: false,
          error: 'Invalid image type. Only JPEG, PNG, WebP, and GIF are allowed.',
        };
      }
      
      try {
        const {uploadProfileImage} = await import('~/lib/image-upload');
        const uploadResult = await uploadProfileImage(
          imageFile,
          user.email,
          context.env.SUPABASE_URL,
          context.env.SUPABASE_ANON_KEY,
          session.access_token,
        );
        
        if (uploadResult.error) {
          return {
            success: false,
            error: uploadResult.error.message || 'Failed to upload image',
          };
        }
        
        imageUrl = uploadResult.url;
      } catch (error) {
        // Log error server-side only (no stack trace in production)
        const isProduction = context.env.NODE_ENV === 'production';
        console.error('Error uploading image:', {
          error: error.message || 'Unknown error',
          errorName: error.name || 'Error',
          fileName: imageFile.name,
          fileSize: imageFile.size,
          fileType: imageFile.type,
          timestamp: new Date().toISOString(),
          ...(isProduction ? {} : {errorStack: error.stack}),
        });
        
        // Return generic error to client
        return {
          success: false,
          error: 'Failed to upload image. Please try again.',
        };
      }
    }
    
    // Handle cover image upload if provided
    const coverImageFile = formData.get('coverImage');
    let coverImageUrl = null;
    
    if (coverImageFile && coverImageFile instanceof File && coverImageFile.size > 0) {
      // Validate file before upload
      const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
      const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      
      // Check file size
      if (coverImageFile.size > MAX_IMAGE_SIZE) {
        return {
          success: false,
          error: 'Cover image file size exceeds 5MB limit. Please choose a smaller image.',
        };
      }
      
      // Check file is not empty
      if (coverImageFile.size === 0) {
        return {
          success: false,
          error: 'Cover image file is empty. Please select a valid image.',
        };
      }
      
      // Validate MIME type
      if (!ALLOWED_IMAGE_TYPES.includes(coverImageFile.type)) {
        return {
          success: false,
          error: 'Invalid cover image type. Only JPEG, PNG, WebP, and GIF are allowed.',
        };
      }
      
      try {
        const {uploadCoverImage} = await import('~/lib/image-upload');
        const uploadResult = await uploadCoverImage(
          coverImageFile,
          user.email,
          context.env.SUPABASE_URL,
          context.env.SUPABASE_ANON_KEY,
          session.access_token,
        );
        
        if (uploadResult.error) {
          return {
            success: false,
            error: uploadResult.error.message || 'Failed to upload cover image',
          };
        }
        
        coverImageUrl = uploadResult.url;
      } catch (error) {
        // Log error server-side only (no stack trace in production)
        const isProduction = context.env.NODE_ENV === 'production';
        console.error('Error uploading cover image:', {
          error: error.message || 'Unknown error',
          errorName: error.name || 'Error',
          fileName: coverImageFile.name,
          fileSize: coverImageFile.size,
          fileType: coverImageFile.type,
          timestamp: new Date().toISOString(),
          ...(isProduction ? {} : {errorStack: error.stack}),
        });
        
        // Return generic error to client
        return {
          success: false,
          error: 'Failed to upload cover image. Please try again.',
        };
      }
    }
    
    // Extract form fields with explicit empty string handling
    const fieldErrors = {};
    const rawUpdates = {
      firstName: formData.get('first-name')?.toString().trim(),
      lastName: formData.get('last-name')?.toString().trim(),
      username: formData.get('username')?.toString().trim(),
      displayName: formData.get('displayName')?.toString().trim(),
      bio: formData.get('bio')?.toString().trim(),
      payoutMethod: formData.get('payoutMethod')?.toString().trim(),
      paypalEmail: formData.get('paypalEmail')?.toString().trim(),
      // Note: email is intentionally excluded - it's read-only and tied to auth
    };
    
    // Add image URLs if uploaded
    if (imageUrl) {
      rawUpdates.profileImageUrl = imageUrl;
    }
    if (coverImageUrl) {
      // Store the storage path, not the full URL
      // Extract path from URL: https://...supabase.co/storage/v1/object/public/creator-cover-images/{path}
      try {
        const urlObj = new URL(coverImageUrl);
        // More specific regex: must match /storage/v1/object/public/creator-cover-images/ followed by valid path
        const pathMatch = urlObj.pathname.match(/^\/storage\/v1\/object\/public\/creator-cover-images\/([^\/]+(?:\/[^\/]+)*)$/);
        if (pathMatch && pathMatch[1]) {
          const extractedPath = pathMatch[1];
          // Additional security: validate path doesn't contain dangerous patterns
          if (!extractedPath.includes('..') && !extractedPath.includes('//') && !extractedPath.startsWith('/')) {
            rawUpdates.coverImageStoragePath = extractedPath;
          } else {
            // Invalid path detected - store full URL as fallback
            rawUpdates.coverImageStoragePath = coverImageUrl;
          }
        } else {
          // Fallback: store the full URL if path extraction fails
          rawUpdates.coverImageStoragePath = coverImageUrl;
        }
      } catch (urlError) {
        // If URL parsing fails, store as-is
        console.error('Error parsing cover image URL:', urlError);
        rawUpdates.coverImageStoragePath = coverImageUrl;
      }
    }
    
    // Input validation constants
    const MAX_FIRST_NAME_LENGTH = 50;
    const MAX_LAST_NAME_LENGTH = 50;
    const MIN_USERNAME_LENGTH = 3;
    const MAX_USERNAME_LENGTH = 30;
    const MAX_DISPLAY_NAME_LENGTH = 100;
    const MAX_BIO_LENGTH = 1000;
    const MAX_EMAIL_LENGTH = 255;
    
    // Sanitize and validate all inputs
    const sanitizeInput = (value, type) => {
      if (!value || value === '') return null;
      
      // Remove leading/trailing whitespace
      let sanitized = value.trim();
      
      // Type-specific sanitization
      switch (type) {
        case 'name':
          // Names: letters, spaces, hyphens, apostrophes only
          sanitized = sanitized.replace(/[^a-zA-Z\s'-]/g, '');
          // Limit length
          if (sanitized.length > MAX_FIRST_NAME_LENGTH) {
            sanitized = sanitized.substring(0, MAX_FIRST_NAME_LENGTH);
          }
          break;
        case 'username':
          // Username: alphanumeric and hyphens only (no underscores)
          sanitized = sanitized.replace(/[^a-zA-Z0-9-]/g, '');
          // Limit length (validated separately below)
          break;
        case 'displayName':
          // Display name: letters, numbers, spaces, basic punctuation
          sanitized = sanitized.replace(/[^a-zA-Z0-9\s'.-]/g, '');
          // Limit length
          if (sanitized.length > MAX_DISPLAY_NAME_LENGTH) {
            sanitized = sanitized.substring(0, MAX_DISPLAY_NAME_LENGTH);
          }
          break;
        case 'bio':
          // Bio: Use HTML sanitization for XSS protection
          // First remove control characters and dangerous patterns
          sanitized = sanitized
            .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
            .replace(/javascript:/gi, '') // Remove javascript: protocol
            .replace(/on\w+\s*=/gi, ''); // Remove event handlers like onclick=
          
          // Apply HTML sanitization (will strip any remaining HTML/script tags)
          sanitized = sanitizeHTML(sanitized);
          
          // Limit length after sanitization
          if (sanitized.length > MAX_BIO_LENGTH) {
            sanitized = sanitized.substring(0, MAX_BIO_LENGTH);
          }
          break;
        case 'payoutMethod':
          // Payout method: only allow 'paypal'
          if (sanitized !== 'paypal') {
            sanitized = 'paypal';
          }
          break;
        case 'email':
          // Email: validate format and limit length
          // Remove control characters and dangerous patterns
          sanitized = sanitized
            .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
            .toLowerCase(); // Normalize to lowercase
          
          // Basic email format validation (RFC 5322 simplified)
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(sanitized)) {
            return null; // Invalid email format
          }
          
          // Limit length
          if (sanitized.length > MAX_EMAIL_LENGTH) {
            sanitized = sanitized.substring(0, MAX_EMAIL_LENGTH);
          }
          break;
        default:
          // Default: remove control characters and limit length
          sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
          if (sanitized.length > 255) {
            sanitized = sanitized.substring(0, 255);
          }
      }
      
      return sanitized === '' ? null : sanitized;
    };
    
    // Convert empty strings to undefined and validate required fields
    const updates = {};
    Object.keys(rawUpdates).forEach((key) => {
      const value = rawUpdates[key];
      // Skip undefined values (fields not present in form submission)
      if (value === undefined) {
        return;
      }
      if (value === '' || value === null) {
        // Skip empty values unless they're required fields
        if (key === 'displayName' || key === 'username') {
          fieldErrors[key] = `${key === 'displayName' ? 'Display name' : 'Username'} is required`;
        }
      } else {
        // Sanitize based on field type
        let sanitized;
        if (key === 'firstName' || key === 'lastName') {
          sanitized = sanitizeInput(value, 'name');
        } else if (key === 'username') {
          sanitized = sanitizeInput(value, 'username');
        } else if (key === 'displayName') {
          sanitized = sanitizeInput(value, 'displayName');
        } else if (key === 'bio') {
          sanitized = sanitizeInput(value, 'bio');
        } else if (key === 'payoutMethod') {
          sanitized = sanitizeInput(value, 'payoutMethod');
        } else if (key === 'paypalEmail') {
          sanitized = sanitizeInput(value, 'email');
          // If PayPal email is provided but invalid, add error
          if (value && !sanitized) {
            fieldErrors.paypalEmail = 'Please enter a valid email address';
          }
        } else if (key === 'profileImageUrl') {
          // Validate image URL format and origin
          try {
            const url = new URL(value);
            // Ensure it's from Supabase Storage
            if (!url.hostname.includes('supabase.co') && !url.hostname.includes('supabase.in')) {
              throw new Error('Invalid image URL origin');
            }
            // Ensure it's HTTPS
            if (url.protocol !== 'https:') {
              throw new Error('Image URL must use HTTPS');
            }
            // Ensure it's a valid image path
            if (!url.pathname.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
              throw new Error('Invalid image URL format');
            }
            sanitized = value;
          } catch (urlError) {
            console.error('Invalid image URL:', urlError);
            fieldErrors.profileImageUrl = 'Invalid image URL. Please upload a new image.';
            sanitized = null;
          }
        } else if (key === 'coverImageStoragePath') {
          // Validate cover image storage path
          // Can be a storage path (e.g., "user_email/cover.jpg") or a full URL
          if (value.includes('http://') || value.includes('https://')) {
            // If it's a URL, validate it
            try {
              const url = new URL(value);
              if (!url.hostname.includes('supabase.co') && !url.hostname.includes('supabase.in')) {
                throw new Error('Invalid cover image URL origin');
              }
              if (url.protocol !== 'https:') {
                throw new Error('Cover image URL must use HTTPS');
              }
              sanitized = value;
            } catch (urlError) {
              console.error('Invalid cover image URL:', urlError);
              fieldErrors.coverImageStoragePath = 'Invalid cover image URL. Please upload a new image.';
              sanitized = null;
            }
          } else {
            // It's a storage path - validate it doesn't contain dangerous characters
            if (value.includes('..') || value.includes('//') || value.startsWith('/')) {
              fieldErrors.coverImageStoragePath = 'Invalid cover image path. Please upload a new image.';
              sanitized = null;
            } else {
              sanitized = value;
            }
          }
        } else {
          sanitized = sanitizeInput(value, 'default');
        }
        
        if (sanitized !== null) {
          updates[key] = sanitized;
        }
      }
    });
    
    // Validate required fields with comprehensive checks (only if they're being updated)
    if (rawUpdates.displayName !== undefined) {
      if (!updates.displayName) {
        fieldErrors.displayName = 'Display name is required';
      } else if (updates.displayName.length === 0) {
        fieldErrors.displayName = 'Display name cannot be empty';
      } else if (updates.displayName.length > MAX_DISPLAY_NAME_LENGTH) {
        fieldErrors.displayName = `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or less.`;
      } else if (updates.displayName.trim().length === 0) {
        fieldErrors.displayName = 'Display name cannot be only whitespace';
      }
    }
    
    // Validate username format (alphanumeric and hyphens only - no underscores) (only if being updated)
    if (rawUpdates.username !== undefined) {
      if (!updates.username) {
        fieldErrors.username = 'Username is required';
      } else if (updates.username.length === 0) {
        fieldErrors.username = 'Username cannot be empty';
      } else {
        // Username validation: only alphanumeric characters and hyphens (no underscores)
        // Must start and end with alphanumeric character
        const usernameRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
        if (!usernameRegex.test(updates.username)) {
          fieldErrors.username = 'Username can only contain letters, numbers, and hyphens. It must start and end with a letter or number.';
        }
        // Additional length validation
        if (updates.username.length < MIN_USERNAME_LENGTH) {
          fieldErrors.username = `Username must be at least ${MIN_USERNAME_LENGTH} characters long.`;
        }
        if (updates.username.length > MAX_USERNAME_LENGTH) {
          fieldErrors.username = `Username must be ${MAX_USERNAME_LENGTH} characters or less.`;
        }
      }
    }
    
    // Validate name fields length
    if (updates.firstName) {
      if (updates.firstName.length > MAX_FIRST_NAME_LENGTH) {
        fieldErrors.firstName = `First name must be ${MAX_FIRST_NAME_LENGTH} characters or less.`;
      } else if (updates.firstName.trim().length === 0 && updates.firstName.length > 0) {
        fieldErrors.firstName = 'First name cannot be only whitespace';
      }
    }
    if (updates.lastName) {
      if (updates.lastName.length > MAX_LAST_NAME_LENGTH) {
        fieldErrors.lastName = `Last name must be ${MAX_LAST_NAME_LENGTH} characters or less.`;
      } else if (updates.lastName.trim().length === 0 && updates.lastName.length > 0) {
        fieldErrors.lastName = 'Last name cannot be only whitespace';
      }
    }
    
    // Validate bio length
    if (updates.bio) {
      if (updates.bio.length > MAX_BIO_LENGTH) {
        fieldErrors.bio = `Bio must be ${MAX_BIO_LENGTH} characters or less.`;
      } else if (updates.bio.trim().length === 0 && updates.bio.length > 0) {
        fieldErrors.bio = 'Bio cannot be only whitespace';
      }
    }
    
    // Validate payout method and PayPal email (only if payout fields are being submitted)
    // Check if payout-related fields are actually present in the form (not undefined)
    const hasPayoutMethodField = rawUpdates.payoutMethod !== undefined && rawUpdates.payoutMethod !== null;
    const hasPaypalEmailField = rawUpdates.paypalEmail !== undefined && rawUpdates.paypalEmail !== null;
    const isPayoutFormSubmission = hasPayoutMethodField || hasPaypalEmailField;
    
    if (isPayoutFormSubmission) {
      // Validate payout method (should only be 'paypal')
      const finalPayoutMethod = updates.payoutMethod || rawUpdates.payoutMethod || 'paypal';
      if (finalPayoutMethod !== 'paypal') {
        updates.payoutMethod = 'paypal'; // Force to paypal for security
      } else {
        updates.payoutMethod = 'paypal';
      }
      
      // Validate PayPal email when payout method is PayPal
      if (finalPayoutMethod === 'paypal') {
        if (!updates.paypalEmail || !updates.paypalEmail.trim()) {
          fieldErrors.paypalEmail = 'PayPal email is required when PayPal is selected as payout method';
        } else {
          // Validate email format (already sanitized, but double-check)
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          const normalizedEmail = updates.paypalEmail.toLowerCase().trim();
          if (!emailRegex.test(normalizedEmail)) {
            fieldErrors.paypalEmail = 'Please enter a valid PayPal email address';
          } else {
            // PayPal API verification (non-blocking)
            // Note: AddressVerify API requires API credentials (USER/PWD/SIGNATURE)
            // OAuth credentials (Client ID/Secret) cannot be used for AddressVerify
            const paypalClientId = context.env.PAYPAL_CLIENT_ID;
            const paypalClientSecret = context.env.PAYPAL_CLIENT_SECRET;
            const paypalApiSignature = context.env.PAYPAL_API_SIGNATURE;
            const isPayPalSandbox = context.env.PAYPAL_SANDBOX === 'true';
            
            // Only verify if PayPal credentials are configured
            if (paypalClientId && paypalClientSecret) {
              try {
                const verification = await verifyPayPalEmail(
                  normalizedEmail,
                  paypalClientId,
                  paypalClientSecret,
                  paypalApiSignature || '',
                  isPayPalSandbox
                );
                
                if (verification.verified) {
                  // Email is verified - store verification status
                  updates.paypalEmailVerified = true;
                  updates.paypalPayerId = verification.payerId || null;
                  updates.paypalEmailVerifiedAt = new Date().toISOString();
                } else {
                  // Email not verified - mark as unverified but don't block submission
                  updates.paypalEmailVerified = false;
                  updates.paypalPayerId = null;
                  updates.paypalEmailVerifiedAt = null;
                  
                  // Log if verification was skipped due to missing API signature
                  if (verification.error && verification.error.includes('API Signature')) {
                    console.log('PayPal email verification skipped:', {
                      reason: 'API Signature not configured',
                      note: 'OAuth credentials (Client ID/Secret) cannot be used for AddressVerify API. API credentials (USER/PWD/SIGNATURE) are required.',
                    });
                  }
                }
              } catch (error) {
                // Log error but don't block submission
                console.error('PayPal verification error:', {
                  error: error.message || 'Unknown error',
                  errorName: error.name || 'Error',
                  timestamp: new Date().toISOString(),
                });
                
                // Mark as unverified on error
                updates.paypalEmailVerified = false;
                updates.paypalPayerId = null;
                updates.paypalEmailVerifiedAt = null;
              }
            } else {
              // PayPal API not configured - mark as unverified
              updates.paypalEmailVerified = false;
              updates.paypalPayerId = null;
              updates.paypalEmailVerifiedAt = null;
            }
          }
        }
      }
    }
    
    // Return field-level errors if any
    if (Object.keys(fieldErrors).length > 0) {
      return {
        success: false,
        error: 'Please fix the errors below',
        fieldErrors,
        formSection,
      };
    }
    
    // Update creator profile in Supabase
    const updatedProfile = await updateCreatorProfile(
      user.email,
      updates,
      context.env.SUPABASE_URL,
      context.env.SUPABASE_ANON_KEY,
      session.access_token,
    );
    
    // Construct cover image URL for response
    let responseCoverImageUrl = null;
    const finalCoverImageStoragePath = updatedProfile?.cover_image_storage_path || (coverImageUrl ? (() => {
      try {
        const urlObj = new URL(coverImageUrl);
        // More specific regex matching the expected storage path structure
        const pathMatch = urlObj.pathname.match(/^\/storage\/v1\/object\/public\/creator-cover-images\/([^\/]+(?:\/[^\/]+)*)$/);
        if (pathMatch && pathMatch[1] && !pathMatch[1].includes('..') && !pathMatch[1].includes('//')) {
          return pathMatch[1];
        }
        return coverImageUrl;
      } catch {
        return coverImageUrl;
      }
    })() : null);
    
    if (finalCoverImageStoragePath && context.env.SUPABASE_URL) {
      if (finalCoverImageStoragePath.startsWith('http://') || finalCoverImageStoragePath.startsWith('https://')) {
        responseCoverImageUrl = finalCoverImageStoragePath;
      } else {
        const supabaseUrl = context.env.SUPABASE_URL.replace(/\/$/, '');
        responseCoverImageUrl = `${supabaseUrl}/storage/v1/object/public/creator-cover-images/${finalCoverImageStoragePath}`;
      }
    }
    
    // Determine success message based on form section
    const successMessage = formSection === 'payouts' 
      ? 'Payout settings updated successfully'
      : 'Profile updated successfully';
    
    // Include PayPal verification status in response if it was updated
    const paypalVerificationStatus = updates.paypalEmailVerified !== undefined ? {
      paypalEmailVerified: updates.paypalEmailVerified,
      paypalPayerId: updates.paypalPayerId || null,
      paypalEmailVerifiedAt: updates.paypalEmailVerifiedAt || null,
    } : {};
    
    return {
      success: true,
      message: successMessage,
      profileImageUrl: updatedProfile?.profile_image_url || imageUrl || null,
      coverImageStoragePath: finalCoverImageStoragePath,
      coverImageUrl: responseCoverImageUrl,
      formSection,
      ...paypalVerificationStatus,
    };
  } catch (error) {
    // Log error details server-side only (no stack trace or email in production)
    const isProduction = context.env.NODE_ENV === 'production';
    console.error('Error updating creator profile:', {
      error: error.message || 'Unknown error',
      errorName: error.name || 'Error',
      errorCode: error.code,
      timestamp: new Date().toISOString(),
      ...(isProduction ? {} : {errorStack: error.stack, userEmail: user.email}),
    });
    
    // Get form section from formData (for error context)
    const errorFormSection = formData.get('formSection')?.toString() || 'personal';
    
    // Sanitize error messages for client - don't expose internal details
    const fieldErrors = {};
    let userFriendlyError = 'Failed to update profile. Please try again.';
    
    // Only expose specific, safe error messages (whitelist approach)
    const errorMessage = (error.message || '').toLowerCase();
    if (errorMessage.includes('username') && errorMessage.includes('taken')) {
      fieldErrors.username = 'Username is already taken. Please choose a different username.';
      userFriendlyError = 'Please fix the errors below';
    } else if (errorMessage.includes('display name') && errorMessage.includes('required')) {
      fieldErrors.displayName = 'Display name is required';
      userFriendlyError = 'Please fix the errors below';
    } else if (errorMessage.includes('username') && errorMessage.includes('required')) {
      fieldErrors.username = 'Username is required';
      userFriendlyError = 'Please fix the errors below';
    } else if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      // Generic validation error - don't expose details
      userFriendlyError = 'Validation error. Please check your input and try again.';
    }
    // For all other errors, use generic message (don't expose database errors, stack traces, etc.)
    
    return {
      success: false,
      error: userFriendlyError,
      fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
      formSection: errorFormSection,
    };
  }
}

export default function CreatorSettings() {
  const loaderData = useLoaderData();
  const {profile, user, csrfToken, supabaseUrl: loaderSupabaseUrl} = loaderData;
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  
  // Track which image is being uploaded
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false);
  const [uploadingCoverImage, setUploadingCoverImage] = useState(false);
  
  // Track preview URLs for newly selected images (before upload)
  const [profileImagePreview, setProfileImagePreview] = useState(null);
  const [coverImagePreview, setCoverImagePreview] = useState(null);
  
  // Track payout method selection to conditionally show PayPal email input
  const [payoutMethod, setPayoutMethod] = useState(profile.payoutMethod || 'paypal');
  
  // Track delete account confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Default placeholder image (SVG data URI - account/user icon)
  // Simple account icon: gray rounded square with user silhouette
  // Using proper URL encoding for SVG data URI
  const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='8' fill='%23E5E7EB'/%3E%3Ccircle cx='48' cy='36' r='12' fill='%236B7280'/%3E%3Cpath d='M48 56C38 56 30 62 26 70V80H70V70C66 62 58 56 48 56Z' fill='%236B7280'/%3E%3C/svg%3E";
  
  // Use preview URL if available (newly selected), otherwise use actionData or profile data
  const currentImageUrl = profileImagePreview || actionData?.profileImageUrl || profile.profileImageUrl;
  
  // State for image error handling - reset when profile image URL changes
  const [imageError, setImageError] = useState(false);
  
  // Track when form submission completes successfully to force image reload
  const [imageVersion, setImageVersion] = useState(0);
  
  // Reset error state and increment version when image URL changes (new image uploaded or profile loaded)
  useEffect(() => {
    if (currentImageUrl) {
      setImageError(false);
      // Increment version to force image reload when URL changes
      setImageVersion(prev => prev + 1);
    }
  }, [currentImageUrl]);
  
  // Also increment version when action completes successfully
  useEffect(() => {
    if (actionData?.success && (actionData?.profileImageUrl || actionData?.coverImageUrl)) {
      setImageVersion(prev => prev + 1);
      setUploadingProfileImage(false);
      setUploadingCoverImage(false);
    }
    // Reset loading states if there's an error or when navigation completes
    if (actionData?.error || navigation.state === 'idle') {
      setUploadingProfileImage(false);
      setUploadingCoverImage(false);
    }
  }, [actionData, navigation.state]);
  
  // Sync payout method state when profile loads or updates
  useEffect(() => {
    if (profile.payoutMethod) {
      setPayoutMethod(profile.payoutMethod);
    }
  }, [profile.payoutMethod]);
  
  // Update profile verification status from action response
  const currentPaypalEmailVerified = actionData?.paypalEmailVerified !== undefined 
    ? actionData.paypalEmailVerified 
    : profile.paypalEmailVerified;
  const currentPaypalPayerId = actionData?.paypalPayerId !== undefined 
    ? actionData.paypalPayerId 
    : profile.paypalPayerId;
  const currentPaypalEmailVerifiedAt = actionData?.paypalEmailVerifiedAt !== undefined 
    ? actionData.paypalEmailVerifiedAt 
    : profile.paypalEmailVerifiedAt;
  
  // Cover image handling - use preview URL if available (newly selected), otherwise use actionData or profile data
  const currentCoverImageUrl = coverImagePreview || actionData?.coverImageUrl || profile.coverImageUrl || '';
  const [coverImageError, setCoverImageError] = useState(false);
  
  // Construct cover image URL if we have storage path but no URL
  const coverImageUrl = currentCoverImageUrl || (profile.coverImageStoragePath && loaderSupabaseUrl
    ? `${loaderSupabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/creator-cover-images/${profile.coverImageStoragePath}`
    : '');
  
  // Reset cover image error state when URL changes
  useEffect(() => {
    if (coverImageUrl) {
      setCoverImageError(false);
    }
  }, [coverImageUrl]);
  
  // Cleanup blob URLs when component unmounts or previews change
  useEffect(() => {
    const profilePreview = profileImagePreview;
    const coverPreview = coverImagePreview;
    
    return () => {
      // Clean up profile image preview blob URL
      if (profilePreview && (profilePreview.startsWith('blob:') || profilePreview.startsWith('http://') || profilePreview.startsWith('https://'))) {
        try {
          URL.revokeObjectURL(profilePreview);
        } catch (error) {
          console.warn('Error revoking profile image blob URL:', error);
        }
      }
      // Clean up cover image preview blob URL
      if (coverPreview && (coverPreview.startsWith('blob:') || coverPreview.startsWith('http://') || coverPreview.startsWith('https://'))) {
        try {
          URL.revokeObjectURL(coverPreview);
        } catch (error) {
          console.warn('Error revoking cover image blob URL:', error);
        }
      }
    };
  }, [profileImagePreview, coverImagePreview]);
  
  // Clear previews when upload completes successfully
  useEffect(() => {
    if (actionData?.success) {
      if (actionData?.profileImageUrl) {
        setProfileImagePreview(null);
      }
      if (actionData?.coverImageUrl) {
        setCoverImagePreview(null);
      }
    }
  }, [actionData]);
  
  // Add cache-busting query parameter to force browser to reload image
  // This helps when the image URL hasn't changed but the file has been updated
  // Include imageVersion to force reload after successful save
  // Don't add cache-busting to blob URLs (previews)
  const imageUrlToDisplay = useMemo(() => {
    if (!currentImageUrl || imageError) return null;
    // Don't modify blob URLs (previews)
    if (currentImageUrl.startsWith('blob:')) {
      return currentImageUrl;
    }
    try {
      const urlObj = new URL(currentImageUrl);
      // Add timestamp and version as cache-busting parameters
      urlObj.searchParams.set('t', Date.now().toString());
      urlObj.searchParams.set('v', imageVersion.toString());
      return urlObj.toString();
    } catch {
      return currentImageUrl;
    }
  }, [currentImageUrl, imageError, imageVersion]);
  
  // Add cache-busting for cover image as well
  // Don't add cache-busting to blob URLs (previews)
  const coverImageUrlToDisplay = useMemo(() => {
    if (!coverImageUrl || coverImageError) return null;
    // Don't modify blob URLs (previews)
    if (coverImageUrl.startsWith('blob:')) {
      return coverImageUrl;
    }
    try {
      const urlObj = new URL(coverImageUrl);
      // Add timestamp and version as cache-busting parameters
      urlObj.searchParams.set('t', Date.now().toString());
      urlObj.searchParams.set('v', imageVersion.toString());
      return urlObj.toString();
    } catch {
      return coverImageUrl;
    }
  }, [coverImageUrl, coverImageError, imageVersion]);
  
  // Input sanitization functions for security
  
  // Filter username input to only allow letters, numbers, and hyphens (no underscores)
  const handleUsernameInput = (e) => {
    const input = e.target.value;
    // Only allow alphanumeric and hyphens (no underscores)
    const filtered = input.replace(/[^a-zA-Z0-9-]/g, '');
    if (filtered !== input) {
      e.target.value = filtered;
    }
  };
  
  // Filter name inputs (first-name, last-name) - allow letters, spaces, hyphens, apostrophes
  const handleNameInput = (e) => {
    const input = e.target.value;
    // Allow letters, spaces, hyphens, apostrophes (for names like O'Brien, Mary-Jane)
    const filtered = input.replace(/[^a-zA-Z\s'-]/g, '');
    if (filtered !== input) {
      e.target.value = filtered;
    }
  };
  
  // Filter display name - allow letters, numbers, spaces, basic punctuation
  const handleDisplayNameInput = (e) => {
    const input = e.target.value;
    // Allow letters, numbers, spaces, hyphens, apostrophes, periods
    const filtered = input.replace(/[^a-zA-Z0-9\s'.-]/g, '');
    if (filtered !== input) {
      e.target.value = filtered;
    }
  };
  
  // Filter bio - allow most characters but remove potentially dangerous ones
  const handleBioInput = (e) => {
    const input = e.target.value;
    // Remove SQL injection patterns and script tags
    // Allow most characters but block: < > { } [ ] ` $ \ and control characters
    const filtered = input.replace(/[<>{}[\]`$\\\x00-\x1F\x7F]/g, '');
    if (filtered !== input) {
      e.target.value = filtered;
    }
  };
  
  return (
    <main className="bg-white dark:bg-gray-900">
      <h1 className="sr-only">Account Settings</h1>

      {/* Settings forms */}
      <div className="divide-y divide-gray-200 dark:divide-white/10 bg-white dark:bg-gray-900">
        {/* Personal Information Section */}
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8 bg-white dark:bg-gray-900">
          <div>
            <h2 className="text-base/7 font-semibold text-gray-900 dark:text-white">Personal Information</h2>
            <p className="mt-1 text-sm/6 text-gray-500 dark:text-gray-300">
              Update your profile information and preferences.
            </p>
          </div>

          <Form method="post" encType="multipart/form-data" className="md:col-span-2">
            <input type="hidden" name="csrf_token" value={csrfToken} />
            <input type="hidden" name="formSection" value="personal" />
            {/* Success/Error Messages - only show for personal form */}
            {actionData?.success && actionData?.formSection === 'personal' && (
              <div className="mb-6 rounded-md bg-green-50 p-4 dark:bg-green-900/20">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  {actionData.message || 'Profile updated successfully'}
                </p>
              </div>
            )}
            
            {actionData?.error && actionData?.formSection === 'personal' && (
              <div className="mb-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {actionData.error}
                </p>
              </div>
            )}
            
            {/* Field-level error messages - only show personal form errors */}
            {actionData?.fieldErrors && actionData?.formSection === 'personal' && Object.keys(actionData.fieldErrors).filter(key => key !== 'payoutMethod' && key !== 'paypalEmail').length > 0 && (
              <div className="mb-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                <ul className="list-disc list-inside space-y-1 text-sm text-red-800 dark:text-red-200">
                  {Object.entries(actionData.fieldErrors)
                    .filter(([field]) => field !== 'payoutMethod' && field !== 'paypalEmail')
                    .map(([field, message]) => (
                      <li key={field}>{message}</li>
                    ))}
                </ul>
              </div>
            )}
            
            <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:max-w-xl sm:grid-cols-6">
              <div className="col-span-full flex items-center gap-x-8">
                <div className="relative">
                  {!currentImageUrl || imageError ? (
                    <div className="size-24 flex-none rounded-lg bg-gray-100 outline -outline-offset-1 outline-black/5 dark:bg-gray-800 dark:outline-white/10 flex items-center justify-center overflow-hidden">
                      <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" className="w-full h-full">
                        <rect width="96" height="96" rx="8" fill="#E5E7EB" className="dark:fill-gray-700"/>
                        <circle cx="48" cy="36" r="12" fill="#6B7280" className="dark:fill-gray-400"/>
                        <path d="M48 56C38 56 30 62 26 70V80H70V70C66 62 58 56 48 56Z" fill="#6B7280" className="dark:fill-gray-400"/>
                      </svg>
                    </div>
                  ) : (
                    <img
                      key={`${currentImageUrl}-${imageVersion}`} // Force React to recreate img element when URL or version changes
                      alt="Profile"
                      src={imageUrlToDisplay || currentImageUrl}
                      onError={() => {
                        // Fallback to default if image fails to load
                        setImageError(true);
                      }}
                      onLoad={() => {
                        setImageError(false);
                      }}
                      className="size-24 flex-none rounded-lg bg-gray-100 object-cover outline -outline-offset-1 outline-black/5 dark:bg-gray-800 dark:outline-white/10"
                    />
                  )}
                  {/* Loading overlay */}
                  {uploadingProfileImage && (
                    <div className="absolute inset-0 bg-black/50 dark:bg-black/70 rounded-lg flex items-center justify-center z-10">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <p className="text-xs text-white">Uploading...</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-4">
                  <label
                    htmlFor="profileImage"
                    className="cursor-pointer rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring-1 inset-ring-gray-300 hover:bg-gray-100 dark:bg-white/10 dark:text-white dark:shadow-none dark:inset-ring-white/5 dark:hover:bg-white/20"
                  >
                    Change avatar
                    <input
                      id="profileImage"
                      name="profileImage"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="sr-only"
                      onChange={(e) => {
                        // Create preview URL for immediate display
                        if (e.target.files && e.target.files[0]) {
                          const file = e.target.files[0];
                          try {
                            // Validate file type
                            const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
                            if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                              alert('Invalid image type. Only JPEG, PNG, WebP, and GIF are allowed.');
                              e.target.value = ''; // Clear the input
                              return;
                            }
                            
                            // Validate file size (5MB max)
                            const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
                            if (file.size > MAX_IMAGE_SIZE) {
                              alert('Image file size exceeds 5MB limit. Please choose a smaller image.');
                              e.target.value = ''; // Clear the input
                              return;
                            }
                            
                            // Create blob URL for preview
                            const preview = URL.createObjectURL(file);
                            if (preview && typeof preview === 'string') {
                              setProfileImagePreview(preview);
                              setImageError(false);
                            } else {
                              console.error('Failed to create blob URL for profile image');
                            }
                          } catch (error) {
                            console.error('Error creating profile image preview:', error);
                          }
                          
                          // Auto-submit form when image is selected
                          setUploadingProfileImage(true);
                          const form = e.target.closest('form');
                          if (form) {
                            form.requestSubmit();
                          }
                        }
                      }}
                    />
                  </label>
                  <p className="text-xs/5 text-gray-500 dark:text-gray-300">
                    JPG, PNG, WebP or GIF. 5MB max.
                  </p>
                </div>
              </div>

              {/* Cover Image Section */}
              <div className="col-span-full">
                <label htmlFor="coverImage" className="block text-sm/6 font-medium text-gray-900 dark:text-white mb-2">
                  Cover Image
                </label>
                <div className="space-y-4">
                  {/* Cover Image Preview - Wide and Short */}
                  <div className="relative w-full h-32 sm:h-48 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-white/10">
                    {coverImageUrl && !coverImageError ? (
                      <img
                        key={`${coverImageUrl}-${imageVersion}`} // Force React to recreate img element when URL or version changes
                        alt="Cover"
                        src={coverImageUrlToDisplay || coverImageUrl}
                        onError={() => {
                          setCoverImageError(true);
                        }}
                        onLoad={() => {
                          setCoverImageError(false);
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 dark:text-gray-500">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <polyline points="21 15 16 10 5 21"/>
                        </svg>
                      </div>
                    )}
                    {/* Loading overlay */}
                    {uploadingCoverImage && (
                      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-10">
                        <div className="flex flex-col items-center gap-2">
                          <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <p className="text-xs text-white">Uploading...</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="coverImage"
                      className="cursor-pointer inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring-1 inset-ring-gray-300 hover:bg-gray-100 dark:bg-white/10 dark:text-white dark:shadow-none dark:inset-ring-white/5 dark:hover:bg-white/20 w-fit"
                    >
                      {coverImageUrl ? 'Change cover image' : 'Upload cover image'}
                      <input
                        id="coverImage"
                        name="coverImage"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="sr-only"
                        onChange={(e) => {
                          // Create preview URL for immediate display
                          if (e.target.files && e.target.files[0]) {
                            const file = e.target.files[0];
                            try {
                              // Validate file type
                              const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
                              if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                                alert('Invalid image type. Only JPEG, PNG, WebP, and GIF are allowed.');
                                e.target.value = ''; // Clear the input
                                return;
                              }
                              
                              // Validate file size (5MB max)
                              const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
                              if (file.size > MAX_IMAGE_SIZE) {
                                alert('Cover image file size exceeds 5MB limit. Please choose a smaller image.');
                                e.target.value = ''; // Clear the input
                                return;
                              }
                              
                              // Create blob URL for preview
                              const preview = URL.createObjectURL(file);
                              if (preview && typeof preview === 'string') {
                                setCoverImagePreview(preview);
                                setCoverImageError(false);
                              } else {
                                console.error('Failed to create blob URL for cover image');
                              }
                            } catch (error) {
                              console.error('Error creating cover image preview:', error);
                            }
                            
                            // Auto-submit form when image is selected
                            setUploadingCoverImage(true);
                            const form = e.target.closest('form');
                            if (form) {
                              form.requestSubmit();
                            }
                          }
                        }}
                      />
                    </label>
                    <p className="text-xs/5 text-gray-500 dark:text-gray-300">
                      JPG, PNG, WebP or GIF. 5MB max. Recommended: 1920x640px (3:1 ratio)
                    </p>
                    {actionData?.fieldErrors?.coverImageStoragePath && (
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {actionData.fieldErrors.coverImageStoragePath}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="first-name" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  First name
                </label>
                <div className="mt-2">
                  <input
                    id="first-name"
                    name="first-name"
                    type="text"
                    autoComplete="given-name"
                    defaultValue={profile.firstName}
                    maxLength={50}
                    onInput={handleNameInput}
                    onKeyDown={(e) => {
                      // Prevent typing invalid characters
                      const key = e.key;
                      const isValidKey = /^[a-zA-Z\s'-]$/.test(key) || 
                                        ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 
                                         'Tab', 'Home', 'End', 'Enter'].includes(key) ||
                                        (e.ctrlKey || e.metaKey);
                      if (!isValidKey && !e.shiftKey) {
                        e.preventDefault();
                      }
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                      const filtered = pastedText.replace(/[^a-zA-Z\s'-]/g, '').substring(0, 50);
                      const input = e.target;
                      const start = input.selectionStart;
                      const end = input.selectionEnd;
                      const currentValue = input.value;
                      input.value = currentValue.substring(0, start) + filtered + currentValue.substring(end);
                      input.setSelectionRange(start + filtered.length, start + filtered.length);
                    }}
                    className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Not displayed publicly
                  </p>
                </div>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="last-name" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Last name
                </label>
                <div className="mt-2">
                  <input
                    id="last-name"
                    name="last-name"
                    type="text"
                    autoComplete="family-name"
                    defaultValue={profile.lastName}
                    maxLength={50}
                    onInput={handleNameInput}
                    onKeyDown={(e) => {
                      // Prevent typing invalid characters
                      const key = e.key;
                      const isValidKey = /^[a-zA-Z\s'-]$/.test(key) || 
                                        ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 
                                         'Tab', 'Home', 'End', 'Enter'].includes(key) ||
                                        (e.ctrlKey || e.metaKey);
                      if (!isValidKey && !e.shiftKey) {
                        e.preventDefault();
                      }
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                      const filtered = pastedText.replace(/[^a-zA-Z\s'-]/g, '').substring(0, 50);
                      const input = e.target;
                      const start = input.selectionStart;
                      const end = input.selectionEnd;
                      const currentValue = input.value;
                      input.value = currentValue.substring(0, start) + filtered + currentValue.substring(end);
                      input.setSelectionRange(start + filtered.length, start + filtered.length);
                    }}
                    className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Not displayed publicly
                  </p>
                </div>
              </div>

              <div className="col-span-full">
                <label htmlFor="email" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Email address
                </label>
                <div className="mt-2">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    defaultValue={profile.email}
                    readOnly
                    className="block w-full rounded-md bg-gray-50 px-3 py-1.5 text-base text-gray-500 outline-1 -outline-offset-1 outline-gray-300 cursor-not-allowed sm:text-sm/6 dark:bg-gray-800 dark:text-gray-400 dark:outline-white/10"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Email cannot be changed as it's tied to your account authentication.
                  </p>
                </div>
              </div>

              <div className="col-span-full">
                <label htmlFor="username" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Username
                </label>
                <div className="mt-2">
                  <input
                    id="username"
                    name="username"
                    type="text"
                    placeholder="janesmith"
                    defaultValue={profile.username}
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]|[a-zA-Z0-9]"
                    minLength={3}
                    maxLength={30}
                    onInput={handleUsernameInput}
                    onKeyDown={(e) => {
                      // Prevent typing invalid characters
                      const key = e.key;
                      // Allow: letters, numbers, hyphen, backspace, delete, arrow keys, etc.
                      const isValidKey = /^[a-zA-Z0-9-]$/.test(key) || 
                                        ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 
                                         'Tab', 'Home', 'End', 'Enter'].includes(key) ||
                                        (e.ctrlKey || e.metaKey); // Allow Ctrl/Cmd combinations (copy, paste, etc.)
                      if (!isValidKey && !e.shiftKey) {
                        e.preventDefault();
                      }
                    }}
                    onPaste={(e) => {
                      // Filter pasted content
                      e.preventDefault();
                      const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                      const filtered = pastedText.replace(/[^a-zA-Z0-9-]/g, '');
                      const input = e.target;
                      const start = input.selectionStart;
                      const end = input.selectionEnd;
                      const currentValue = input.value;
                      input.value = currentValue.substring(0, start) + filtered + currentValue.substring(end);
                      input.setSelectionRange(start + filtered.length, start + filtered.length);
                    }}
                    aria-invalid={actionData?.fieldErrors?.username ? 'true' : 'false'}
                    aria-describedby={actionData?.fieldErrors?.username ? 'username-error' : undefined}
                    className={`block w-full rounded-md bg-white px-3 py-1.5 text-base outline-1 -outline-offset-1 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 sm:text-sm/6 dark:bg-white/5 dark:outline-white/10 dark:placeholder:text-gray-500 ${
                      actionData?.fieldErrors?.username
                        ? 'text-red-900 outline-red-300 focus:outline-red-600 dark:text-red-200 dark:outline-red-500 dark:focus:outline-red-400'
                        : 'text-gray-900 outline-gray-300 focus:outline-indigo-600 dark:text-white dark:focus:outline-indigo-500'
                    }`}
                  />
                  {actionData?.fieldErrors?.username && (
                    <p id="username-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {actionData.fieldErrors.username}
                    </p>
                  )}
                  {!actionData?.fieldErrors?.username && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Only letters, numbers, and hyphens. 3-30 characters.
                    </p>
                  )}
                </div>
              </div>

              <div className="col-span-full">
                <label htmlFor="displayName" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Display Name
                </label>
                <div className="mt-2">
                  <input
                    id="displayName"
                    name="displayName"
                    type="text"
                    defaultValue={profile.displayName ? decodeHTMLEntities(profile.displayName) : ''}
                    required
                    maxLength={100}
                    onInput={handleDisplayNameInput}
                    onKeyDown={(e) => {
                      // Prevent typing invalid characters
                      const key = e.key;
                      const isValidKey = /^[a-zA-Z0-9\s'.-]$/.test(key) || 
                                        ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 
                                         'Tab', 'Home', 'End', 'Enter'].includes(key) ||
                                        (e.ctrlKey || e.metaKey);
                      if (!isValidKey && !e.shiftKey) {
                        e.preventDefault();
                      }
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                      const filtered = pastedText.replace(/[^a-zA-Z0-9\s'.-]/g, '').substring(0, 100);
                      const input = e.target;
                      const start = input.selectionStart;
                      const end = input.selectionEnd;
                      const currentValue = input.value;
                      input.value = currentValue.substring(0, start) + filtered + currentValue.substring(end);
                      input.setSelectionRange(start + filtered.length, start + filtered.length);
                    }}
                    aria-invalid={actionData?.fieldErrors?.displayName ? 'true' : 'false'}
                    aria-describedby={actionData?.fieldErrors?.displayName ? 'displayName-error' : undefined}
                    className={`block w-full rounded-md bg-white px-3 py-1.5 text-base outline-1 -outline-offset-1 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 sm:text-sm/6 dark:bg-white/5 dark:outline-white/10 dark:placeholder:text-gray-500 ${
                      actionData?.fieldErrors?.displayName
                        ? 'text-red-900 outline-red-300 focus:outline-red-600 dark:text-red-200 dark:outline-red-500 dark:focus:outline-red-400'
                        : 'text-gray-900 outline-gray-300 focus:outline-indigo-600 dark:text-white dark:focus:outline-indigo-500'
                    }`}
                  />
                  {actionData?.fieldErrors?.displayName && (
                    <p id="displayName-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {actionData.fieldErrors.displayName}
                    </p>
                  )}
                </div>
              </div>

              <div className="col-span-full">
                <label htmlFor="bio" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Bio
                </label>
                <div className="mt-2">
                  <textarea
                    id="bio"
                    name="bio"
                    rows={4}
                    defaultValue={profile.bio ? decodeHTMLEntities(profile.bio) : ''}
                    maxLength={1000}
                    onInput={handleBioInput}
                    onPaste={(e) => {
                      e.preventDefault();
                      const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                      // Remove dangerous characters and SQL injection patterns
                      const filtered = pastedText
                        .replace(/['"]/g, '')
                        .replace(/[<>{}[\]`$\\\x00-\x1F\x7F]/g, '')
                        .substring(0, 1000);
                      const textarea = e.target;
                      const start = textarea.selectionStart;
                      const end = textarea.selectionEnd;
                      const currentValue = textarea.value;
                      textarea.value = currentValue.substring(0, start) + filtered + currentValue.substring(end);
                      textarea.setSelectionRange(start + filtered.length, start + filtered.length);
                    }}
                    className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                  />
                </div>
              </div>

            </div>

            <div className="mt-8 flex">
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:shadow-none dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </Form>
        </div>

        {/* Payouts Section */}
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8 bg-white dark:bg-gray-900">
          <div>
            <h2 className="text-base/7 font-semibold text-gray-900 dark:text-white">Payouts</h2>
            <p className="mt-1 text-sm/6 text-gray-500 dark:text-gray-300">
              Configure how you receive payments for your listings. Set up your payout method and associated email address.
            </p>
          </div>

          <Form method="post" encType="multipart/form-data" className="md:col-span-2">
            <input type="hidden" name="csrf_token" value={csrfToken} />
            <input type="hidden" name="formSection" value="payouts" />
            
            {/* Success/Error Messages - only show for payouts form */}
            {actionData?.success && actionData?.formSection === 'payouts' && (
              <div className="mb-6 rounded-md bg-green-50 p-4 dark:bg-green-900/20">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  {actionData.message || 'Payout settings updated successfully'}
                </p>
              </div>
            )}
            
            {actionData?.error && actionData?.formSection === 'payouts' && (
              <div className="mb-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {actionData.error}
                </p>
              </div>
            )}
            
            {/* Field-level error messages - only show payout form errors */}
            {actionData?.fieldErrors && actionData?.formSection === 'payouts' && (actionData.fieldErrors.payoutMethod || actionData.fieldErrors.paypalEmail) && (
              <div className="mb-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                <ul className="list-disc list-inside space-y-1 text-sm text-red-800 dark:text-red-200">
                  {actionData.fieldErrors.payoutMethod && (
                    <li>{actionData.fieldErrors.payoutMethod}</li>
                  )}
                  {actionData.fieldErrors.paypalEmail && (
                    <li>{actionData.fieldErrors.paypalEmail}</li>
                  )}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:max-w-xl sm:grid-cols-6">
              <div className="col-span-full">
                <label htmlFor="payoutMethod" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                  Payout Method
                </label>
                <div className="mt-2 grid grid-cols-1">
                  <select
                    id="payoutMethod"
                    name="payoutMethod"
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value)}
                    className="col-start-1 row-start-1 w-full appearance-none rounded-md bg-white py-1.5 pr-8 pl-3 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:*:bg-gray-800 dark:focus:outline-indigo-500"
                  >
                    <option value="paypal">PayPal</option>
                  </select>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="pointer-events-none col-start-1 row-start-1 mr-2 size-5 self-center justify-self-end text-gray-400 dark:text-gray-300 sm:size-4"
                  />
                </div>
              </div>

              {/* PayPal Email Input - shown when PayPal is selected */}
              {payoutMethod === 'paypal' && (
                <div className="col-span-full">
                  <label htmlFor="paypalEmail" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    PayPal Email Address
                  </label>
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <input
                        id="paypalEmail"
                        name="paypalEmail"
                        type="email"
                        autoComplete="email"
                        placeholder="your.email@example.com"
                        defaultValue={profile.paypalEmail || ''}
                        required={payoutMethod === 'paypal'}
                        maxLength={255}
                        aria-invalid={actionData?.fieldErrors?.paypalEmail ? 'true' : 'false'}
                        aria-describedby={actionData?.fieldErrors?.paypalEmail ? 'paypalEmail-error' : undefined}
                        className={`flex-1 rounded-md bg-white px-3 py-1.5 text-base outline-1 -outline-offset-1 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 sm:text-sm/6 dark:bg-white/5 dark:outline-white/10 dark:placeholder:text-gray-500 ${
                          actionData?.fieldErrors?.paypalEmail
                            ? 'text-red-900 outline-red-300 focus:outline-red-600 dark:text-red-200 dark:outline-red-500 dark:focus:outline-red-400'
                            : 'text-gray-900 outline-gray-300 focus:outline-indigo-600 dark:text-white dark:focus:outline-indigo-500'
                        }`}
                      />
                      {/* Verification Status Badge */}
                      {profile.paypalEmail && currentPaypalEmailVerified && (
                        <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-900/20 dark:text-green-400">
                          <svg className="mr-1 h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a1 1 0 00-1.714-1.029L9.5 9.5 8.207 8.207a1 1 0 00-1.414 1.414l1.5 1.5a1 1 0 001.414 0l3-3z" clipRule="evenodd" />
                          </svg>
                          Verified
                        </span>
                      )}
                      {profile.paypalEmail && !currentPaypalEmailVerified && (
                        <span className="inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-700 ring-1 ring-inset ring-yellow-600/20 dark:bg-yellow-900/20 dark:text-yellow-400">
                          <svg className="mr-1 h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          Unverified
                        </span>
                      )}
                    </div>
                    {actionData?.fieldErrors?.paypalEmail && (
                      <p id="paypalEmail-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {actionData.fieldErrors.paypalEmail}
                      </p>
                    )}
                    {!actionData?.fieldErrors?.paypalEmail && (
                      <div className="mt-1 space-y-1">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          The email address associated with your PayPal account for receiving payouts.
                        </p>
                        {profile.paypalEmail && !currentPaypalEmailVerified && (
                          <p className="text-xs text-yellow-600 dark:text-yellow-400">
                            ⚠️ This email hasn't been verified yet. Email verification requires PayPal API credentials (API Signature). Your email will be saved and can be verified manually before processing payouts.
                          </p>
                        )}
                        {profile.paypalEmail && currentPaypalEmailVerified && currentPaypalEmailVerifiedAt && (
                          <p className="text-xs text-green-600 dark:text-green-400">
                            ✓ Verified on {new Date(currentPaypalEmailVerifiedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 flex">
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:shadow-none dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500"
              >
                {isSubmitting ? 'Saving...' : 'Save payout settings'}
              </button>
            </div>
          </Form>
        </div>

        {/* Delete Account Section */}
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8 bg-white dark:bg-gray-900">
          <div>
            <h2 className="text-base/7 font-semibold text-gray-900 dark:text-white">Delete account</h2>
            <p className="mt-1 text-sm/6 text-gray-500 dark:text-gray-300">
              No longer want to use our service? You can log out and disable your account access here.
              Note: Your account data will be preserved but you will be logged out immediately.
            </p>
          </div>

          <div className="md:col-span-2">
            {!showDeleteConfirm ? (
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:bg-red-500 dark:shadow-none dark:hover:bg-red-400 dark:focus-visible:outline-red-400"
                >
                  Log out and disable account access
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md bg-yellow-50 p-4 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                    Are you sure you want to log out?
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    You will be logged out immediately and redirected to the login page. Your account data will be preserved.
                  </p>
                </div>
                
                {actionData?.error && actionData?.formSection === 'deleteAccount' && (
                  <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">
                      {actionData.error}
                    </p>
                  </div>
                )}
                
                <Form method="post" className="flex items-center gap-4">
                  <input type="hidden" name="csrf_token" value={csrfToken} />
                  <input type="hidden" name="action" value="deleteAccount" />
                  <input type="hidden" name="formSection" value="deleteAccount" />
                  
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-red-500 dark:shadow-none dark:hover:bg-red-400 dark:focus-visible:outline-red-400"
                  >
                    {isSubmitting ? 'Logging out...' : 'Yes, log me out'}
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isSubmitting}
                    className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white/10 dark:text-white dark:ring-white/10 dark:hover:bg-white/20"
                  >
                    Cancel
                  </button>
                </Form>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/** @typedef {import('./+types/creator.settings').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */

