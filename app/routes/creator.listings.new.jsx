import {useState, useRef, useEffect, useMemo} from 'react';
import {Form, redirect, useSubmit, useLoaderData, useNavigation, useActionData, data} from 'react-router';
import {requireAuth, generateCSRFToken, getClientIP, constantTimeEquals} from '~/lib/auth-helpers';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {sanitizeHTML} from '~/lib/sanitize';
import {ALL_CATEGORIES} from '~/lib/categories';
import {createShopifyProduct} from '~/lib/shopify-admin';
import {validateImageFile, getExtensionFromMimeType} from '~/lib/file-validation';
import {ChevronDownIcon, ChevronUpIcon, XMarkIcon} from '@heroicons/react/16/solid';
import {PhotoIcon} from '@heroicons/react/24/solid';

export const meta = () => {
  return [{title: 'WornVault | Create Listing'}];
};

export async function loader({context, request}) {
  // Require authentication
  const {user, session} = await requireAuth(request, context.env);
  
  // Generate CSRF token for form protection
  const csrfToken = await generateCSRFToken(request, context.env.SESSION_SECRET);
  context.session.set('csrf_token', csrfToken);
  
  return {user, csrfToken};
}

export async function action({request, context}) {
  // Declare variables in outer scope for cleanup in catch block
  let listingId = null;
  let uploadedFilePaths = [];
  let supabase = null;
  let supabaseUrl = null;
  let anonKey = null;
  let accessToken = null;
  
  try {
    // Require authentication
    const {user, session} = await requireAuth(request, context.env);
    
    if (!user?.email || !session?.access_token) {
      return data({error: 'Unauthorized'}, {status: 401});
    }

    // Rate limiting: max 10 requests per minute per user
    const clientIP = getClientIP(request);
    const rateLimitKey = `create-listing:${user.email}:${clientIP}`;
    const rateLimit = await rateLimitMiddleware(request, rateLimitKey, {
      maxRequests: 10,
      windowMs: 60000, // 1 minute
    });
    
    if (!rateLimit.allowed) {
      return new Response(
        `Too many requests. Please wait a moment before trying again. You can try again after ${new Date(rateLimit.resetAt).toLocaleTimeString()}.`,
        {status: 429}
      );
    }

    const formData = await request.formData();
    
    // Validate CSRF token using constant-time comparison to prevent timing attacks
    const csrfToken = formData.get('csrf_token')?.toString();
    const storedCSRFToken = context.session.get('csrf_token');
    
    // Debug logging for CSRF token issues (only in development)
    if (context.env.NODE_ENV !== 'production') {
      console.log('CSRF Token Validation:', {
        hasCsrfToken: !!csrfToken,
        hasStoredToken: !!storedCSRFToken,
        tokensMatch: csrfToken && storedCSRFToken ? constantTimeEquals(csrfToken, storedCSRFToken) : false,
      });
    }
    
    if (!csrfToken || !storedCSRFToken || !constantTimeEquals(csrfToken, storedCSRFToken)) {
      console.error('CSRF token validation failed', {
        hasCsrfToken: !!csrfToken,
        hasStoredToken: !!storedCSRFToken,
      });
      return data({error: 'Invalid security token. Please refresh the page and try again.'}, {status: 403});
    }
    
    // Check if CSRF token was already used (prevent replay attacks)
    const csrfUsed = context.session.get('csrf_token_used');
    if (csrfUsed === csrfToken) {
      console.error('CSRF token already used');
      return data({error: 'Security token has already been used. Please refresh the page and try again.'}, {status: 403});
    }
    
    // Mark CSRF token as used and clear it (one-time use)
    context.session.set('csrf_token_used', csrfToken);
    context.session.unset('csrf_token');
    
    // Extract form data
    const title = formData.get('title')?.toString().trim();
    const category = formData.get('category')?.toString().trim();
    const condition = formData.get('condition')?.toString().trim();
    const story = formData.get('description')?.toString().trim();
    const price = formData.get('price')?.toString();
    const photos = formData.getAll('photos');

    // Sanitize inputs
    const MAX_TITLE_LENGTH = 200;
    const MAX_STORY_LENGTH = 5000;
    const sanitizedTitle = title
      ? title.replace(/[\x00-\x1F\x7F]/g, '').substring(0, MAX_TITLE_LENGTH)
      : '';
    const sanitizedCategory = category
      ? category.replace(/[^a-zA-Z0-9\s&'-]/g, '').substring(0, 100)
      : '';
    const sanitizedStory = story
      ? sanitizeHTML(story).substring(0, MAX_STORY_LENGTH)
      : '';

    // Validate required fields with sanitized values
    if (!sanitizedTitle || !sanitizedCategory || !sanitizedStory || !price) {
      return data({error: 'Missing required fields'}, {status: 400});
    }

    // Validate category against allowed list
    const {VALID_CATEGORIES} = await import('~/lib/categories');
    
    if (!VALID_CATEGORIES.includes(sanitizedCategory)) {
      return data({error: 'Invalid category selected'}, {status: 400});
    }

    // Validate condition
    const VALID_CONDITIONS = ['Barely worn', 'Lightly worn', 'Heavily worn'];
    const sanitizedCondition = condition
      ? condition.replace(/[^a-zA-Z0-9\s]/g, '').substring(0, 50).trim()
      : '';
    
    if (!sanitizedCondition || !VALID_CONDITIONS.includes(sanitizedCondition)) {
      return data({error: 'Invalid condition selected'}, {status: 400});
    }

    // Validate price
    const priceFloat = parseFloat(price);
    if (isNaN(priceFloat) || priceFloat <= 0) {
      return data({error: 'Invalid price'}, {status: 400});
    }
    
    // Validate minimum price of $100
    const MIN_PRICE = 100;
    if (priceFloat < MIN_PRICE) {
      return data({error: `Price must be at least $${MIN_PRICE}. Please enter a price of $${MIN_PRICE} or higher.`}, {status: 400});
    }

    // Convert price to cents
    const priceCents = Math.round(priceFloat * 100);

    // Validate photos with comprehensive security checks (magic bytes, dimensions, etc.)
    const validatedPhotos = [];
    const photoValidationErrors = [];
    
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      
      if (!photo || !(photo instanceof File)) {
        photoValidationErrors.push(`Photo ${i + 1}: Invalid file object`);
        continue;
      }
      
      // Comprehensive file validation (magic bytes, dimensions, MIME type, size)
      const validation = await validateImageFile(photo);
      
      if (!validation.valid) {
        photoValidationErrors.push(`Photo ${i + 1}: ${validation.error}`);
        continue;
      }
      
      validatedPhotos.push({
        file: photo,
        mimeType: validation.mimeType,
        dimensions: validation.dimensions,
      });
    }

    if (validatedPhotos.length === 0) {
      const errorMessage = photoValidationErrors.length > 0
        ? `Photo validation failed: ${photoValidationErrors.join('; ')}`
        : 'At least one valid photo is required';
      return data({error: errorMessage}, {status: 400});
    }

    const {createUserSupabaseClient} = await import('~/lib/supabase');
    const {fetchCreatorProfile} = await import('~/lib/supabase');
    
    supabaseUrl = context.env.SUPABASE_URL;
    anonKey = context.env.SUPABASE_ANON_KEY;
    accessToken = session.access_token;

    if (!supabaseUrl || !anonKey || !accessToken) {
      console.error('Action: Missing Supabase configuration', {
        hasUrl: !!supabaseUrl,
        hasKey: !!anonKey,
        hasToken: !!accessToken,
      });
      return new Response('Server configuration error', {status: 500});
    }

    // Create Supabase client
    supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

    // Get creator_id from email and verify authorization
    const creatorProfile = await fetchCreatorProfile(user.email, supabaseUrl, anonKey, accessToken);
    if (!creatorProfile || !creatorProfile.id) {
      // Log without exposing email in production
      const isProduction = context.env.NODE_ENV === 'production';
      console.error('Action: Creator profile not found', isProduction ? {} : {email: user.email});
      return new Response('Creator profile not found. Please complete your profile first.', {status: 404});
    }

    // Explicit authorization check: verify creator profile belongs to authenticated user
    // This prevents authorization bypass if RLS policies are misconfigured
    if (creatorProfile.user_id && user.id && creatorProfile.user_id !== user.id) {
      const isProduction = context.env.NODE_ENV === 'production';
      console.error('Action: Authorization mismatch', isProduction ? {} : {
        creatorUserId: creatorProfile.user_id,
        authenticatedUserId: user.id,
      });
      return new Response('Unauthorized access', {status: 403});
    }

    const creatorId = creatorProfile.id;

    // Validate and sanitize vendor name for Shopify
    const MAX_VENDOR_NAME_LENGTH = 255; // Shopify limit
    let vendorName = creatorProfile.display_name || creatorProfile.email || 'Unknown Creator';
    
    // Sanitize vendor name: remove control characters, limit length
    vendorName = vendorName
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .trim()
      .substring(0, MAX_VENDOR_NAME_LENGTH);
    
    if (!vendorName || vendorName.length === 0) {
      vendorName = 'Unknown Creator';
    }

    // Create listing record (will be cleaned up if Shopify sync fails)
    let listing = null;
    
    const {data: listingData, error: listingError} = await supabase
      .from('listings')
      .insert({
        creator_id: creatorId,
        title: sanitizedTitle,
        category: sanitizedCategory,
        condition: sanitizedCondition,
        story: sanitizedStory,
        price_cents: priceCents,
        currency: 'USD',
        status: 'pending_approval',
      })
      .select()
      .single();

    if (listingError) {
      const isProduction = context.env.NODE_ENV === 'production';
      console.error('Action: Error creating listing:', isProduction ? listingError.message : listingError);
      return new Response('Failed to create listing. Please try again.', {status: 500});
    }

    if (!listingData || !listingData.id) {
      console.error('Action: Listing created but no ID returned');
      return new Response('Failed to create listing. Please try again.', {status: 500});
    }

    listing = listingData;
    listingId = listing.id;

    // Upload photos FIRST so we can include image URLs in Shopify product creation
    // This ensures images are available when creating the product
    const uploadedPhotos = [];
    const photoUploadErrors = [];

    for (let i = 0; i < validatedPhotos.length; i++) {
      const {file: photo, mimeType, dimensions} = validatedPhotos[i];
      
      try {
        // Generate secure file path using UUID-based structure instead of email
        // This prevents path injection and improves security
        const timestamp = Date.now();
        // Use crypto.getRandomValues for secure random generation (available in Cloudflare Workers and Node.js 18+)
        const randomBytes = typeof crypto !== 'undefined' && crypto.getRandomValues
          ? crypto.getRandomValues(new Uint8Array(8))
          : new Uint8Array(8).map(() => Math.floor(Math.random() * 256));
        const random = randomBytes
          .reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
        
        // Get extension from validated MIME type (more secure than filename)
        const fileExt = getExtensionFromMimeType(mimeType);
        
        const fileName = `${timestamp}-${random}.${fileExt}`;
        // Use creator_id instead of email for better security and privacy
        const filePath = `listings/${creatorId}/${listingId}/${fileName}`;

        // Use validated MIME type from file validation (more secure)
        const contentType = mimeType;

        // Upload to storage bucket (photo is already validated File object)
        const {data: uploadData, error: uploadError} = await supabase.storage
          .from('listing-photos')
          .upload(filePath, photo, {
            cacheControl: '3600',
            upsert: false,
            contentType: contentType,
          });

        if (uploadError) {
          const isProduction = context.env.NODE_ENV === 'production';
          console.error(`Action: Error uploading photo ${i + 1}:`, isProduction ? uploadError.message : uploadError);
          
          // Check if this is an RLS policy error
          const isRLSError = uploadError.message?.includes('row-level security policy') || 
                            uploadError.message?.includes('RLS') ||
                            uploadError.statusCode === '42501'; // PostgreSQL permission denied
          
          if (isRLSError) {
            photoUploadErrors.push(`Photo ${i + 1}: Storage permission denied`);
          } else {
            photoUploadErrors.push(`Photo ${i + 1}: Upload failed`);
          }
          continue;
        }
        
        // Track uploaded file for cleanup if needed
        uploadedFilePaths.push(filePath);

        // Create listing_photo record
        const {data: photoRecord, error: photoError} = await supabase
          .from('listing_photos')
          .insert({
            listing_id: listingId,
            storage_path: filePath,
            photo_type: 'reference',
          })
          .select()
          .single();

        if (photoError) {
          const isProduction = context.env.NODE_ENV === 'production';
          console.error(`Action: Error creating photo record ${i + 1}:`, isProduction ? photoError.message : photoError);
          photoUploadErrors.push(`Photo ${i + 1}: Failed to save photo record`);
          // Try to delete uploaded file if record creation failed
          try {
            await supabase.storage.from('listing-photos').remove([filePath]);
          } catch (cleanupError) {
            // Ignore cleanup errors
            console.warn('Action: Error cleaning up failed photo upload:', cleanupError.message);
          }
          // Remove from tracked paths
          const pathIndex = uploadedFilePaths.indexOf(filePath);
          if (pathIndex > -1) {
            uploadedFilePaths.splice(pathIndex, 1);
          }
          continue;
        }

        // Get public URL for Shopify sync
        const {data: urlData} = supabase.storage
          .from('listing-photos')
          .getPublicUrl(filePath);
        const publicUrl = urlData?.publicUrl;
        
        uploadedPhotos.push({
          ...photoRecord,
          publicUrl, // Include public URL for Shopify sync
        });
      } catch (err) {
        const isProduction = context.env.NODE_ENV === 'production';
        console.error(`Action: Unexpected error processing photo ${i + 1}:`, isProduction ? err.message : err);
        photoUploadErrors.push(`Photo ${i + 1}: Processing failed`);
        
        // Cleanup uploaded file if it exists
        const filePath = uploadedFilePaths[uploadedFilePaths.length - 1];
        if (filePath && supabase) {
          try {
            await supabase.storage.from('listing-photos').remove([filePath]);
          } catch (cleanupError) {
            // Ignore cleanup errors
            console.warn('Action: Error cleaning up failed photo upload:', cleanupError.message);
          }
          uploadedFilePaths.pop();
        }
      }
    }

    // If no photos were successfully uploaded, handle based on whether we should continue
    if (uploadedPhotos.length === 0) {
      console.error('Action: No photos uploaded', {listingId});
      
      // Check if errors indicate RLS policy issues
      const hasRLSError = photoUploadErrors.some(err => err.includes('Storage permission denied') || err.includes('row-level security'));
      
      // Cleanup uploaded files
      if (uploadedFilePaths.length > 0 && supabase) {
        try {
          await supabase.storage.from('listing-photos').remove(uploadedFilePaths);
        } catch (cleanupError) {
          // Ignore cleanup errors
          console.warn('Action: Error cleaning up uploaded files:', cleanupError.message);
        }
      }
      
      // Delete listing since no photos were uploaded
      if (supabase && listingId) {
        try {
          await supabase.from('listings').delete().eq('id', listingId);
        } catch (cleanupError) {
          // Ignore cleanup errors
          console.warn('Action: Error cleaning up listing:', cleanupError.message);
        }
      }
      
      // Return appropriate error based on the issue
      if (hasRLSError) {
        return data(
          {error: 'Unable to upload photos due to storage permissions. Please contact support if this issue persists.'},
          {status: 403}
        );
      }
      
      return data(
        {error: 'Failed to upload photos. Please ensure all photos are valid image files.'},
        {status: 400}
      );
    }

    // Extract public URLs from uploaded photos for Shopify
    const imageUrls = uploadedPhotos
      .map(photo => photo.publicUrl)
      .filter(url => url && typeof url === 'string');

    // Create Shopify product with transaction safety
    const shopifyClientId = context.env.SHOPIFY_ADMIN_CLIENT_ID;
    const shopifyClientSecret = context.env.SHOPIFY_ADMIN_CLIENT_SECRET;
    const storeDomain = context.env.PUBLIC_STORE_DOMAIN;

    // Convert price from cents to dollars string (needed for Shopify sync)
    const priceDollars = (priceCents / 100).toFixed(2);

    let shopifyProductId = null;
    let shopifySyncFailed = false;
    
    if (shopifyClientId && shopifyClientSecret && storeDomain) {
      try {
        
        // Create Shopify product WITH images (now that photos are uploaded)
        const {productId, variantId, error: shopifyError} = await createShopifyProduct(
          {
            title: sanitizedTitle,
            productType: sanitizedCategory,
            description: sanitizedStory,
            vendor: vendorName,
            price: priceDollars,
            sku: listingId, // Use listing UUID as SKU
            condition: sanitizedCondition,
            imageUrls: imageUrls, // Include image URLs during creation
          },
          shopifyClientId,
          shopifyClientSecret,
          storeDomain
        );

        // Save productId and variantId if they exist (product was created), even if there's an error
        // This handles cases where product was created but variant update fails
        if (productId) {
          shopifyProductId = productId;
          
          // Update the listing with Shopify product ID and variant ID
          // CRITICAL: This update must succeed to maintain data consistency
          const updateData = {shopify_product_id: shopifyProductId};
          if (variantId) {
            updateData.shopify_variant_id = variantId;
          }
          
          // Retry logic for critical update (up to 3 attempts)
          let updateSuccess = false;
          let lastUpdateError = null;
          const maxRetries = 3;
          
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const {error: updateError, data: updateDataResult} = await supabase
              .from('listings')
              .update(updateData)
              .eq('id', listingId)
              .select('shopify_product_id'); // Select to verify update
            
            if (!updateError) {
              // Verify the update actually succeeded
              if (updateDataResult && updateDataResult[0]?.shopify_product_id === shopifyProductId) {
                updateSuccess = true;
                break;
              } else {
                // Update returned no error but data doesn't match - might be RLS or other issue
                lastUpdateError = new Error('Update succeeded but shopify_product_id not verified');
                if (attempt < maxRetries) {
                  // Wait before retry (exponential backoff)
                  await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                  continue;
                }
              }
            } else {
              lastUpdateError = updateError;
              if (attempt < maxRetries) {
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                continue;
              }
            }
          }
          
          if (!updateSuccess) {
            const isProduction = context.env.NODE_ENV === 'production';
            console.error('Action: CRITICAL - Failed to update listing with Shopify product ID after retries:', {
              listingId,
              shopifyProductId,
              attempts: maxRetries,
              ...(isProduction ? {error: lastUpdateError?.message} : {error: lastUpdateError}),
            });
            
            // This is a critical failure - the Shopify product exists but we can't link it
            // Store in sync queue for manual intervention
            try {
              await supabase.from('shopify_sync_queue').insert({
                listing_id: listingId,
                shopify_product_id: shopifyProductId,
                error_message: `Failed to update listing with shopify_product_id after ${maxRetries} attempts: ${lastUpdateError?.message || 'Unknown error'}`.substring(0, 500),
                retry_count: 0,
                created_at: new Date().toISOString(),
              }).catch(() => {
                // Table might not exist, that's okay
              });
            } catch (queueError) {
              // Ignore queue errors
            }
            
            // Log warning but don't fail listing creation - admin can fix via sync queue
            // In production, you might want to alert monitoring systems here
            shopifySyncFailed = true;
          }
        }

        if (shopifyError) {
          // Log error but don't fail the listing creation
          // Store error for retry queue (if table exists) or manual sync
          const isProduction = context.env.NODE_ENV === 'production';
          console.error('Action: Error creating Shopify product:', isProduction ? shopifyError.message : shopifyError);
          
          // Try to store sync failure in a queue table for retry (non-blocking)
          try {
            // Check if shopify_sync_queue table exists, if not this will fail silently
            await supabase.from('shopify_sync_queue').insert({
              listing_id: listingId,
              error_message: shopifyError.message?.substring(0, 500) || 'Unknown error',
              retry_count: 0,
              created_at: new Date().toISOString(),
            }).catch(() => {
              // Table might not exist, that's okay - we'll handle sync manually
            });
          } catch (queueError) {
            // Ignore queue errors - this is non-critical
          }
          
          shopifySyncFailed = true;
        }
      } catch (shopifySyncException) {
        // Catch any unexpected errors during Shopify sync
        // Don't fail the entire listing creation - the listing is already created
        const isProduction = context.env.NODE_ENV === 'production';
        console.error('Action: Unexpected error during Shopify sync:', isProduction ? shopifySyncException.message : shopifySyncException);
        shopifySyncFailed = true;
        
        // Try to store sync failure in queue (non-blocking)
        try {
          await supabase.from('shopify_sync_queue').insert({
            listing_id: listingId,
            error_message: shopifySyncException.message?.substring(0, 500) || 'Unexpected error during sync',
            retry_count: 0,
            created_at: new Date().toISOString(),
          }).catch(() => {
            // Table might not exist, that's okay
          });
        } catch (queueError) {
          // Ignore queue errors - this is non-critical
        }
      }
    } else {
      console.warn('Action: Shopify Admin API credentials not configured. Product will not be created in Shopify. Required: SHOPIFY_ADMIN_CLIENT_ID, SHOPIFY_ADMIN_CLIENT_SECRET, and PUBLIC_STORE_DOMAIN');
    }

    // If some photos failed but at least one succeeded, log warnings but continue
    if (photoUploadErrors.length > 0) {
      console.warn('Action: Some photos failed to upload:', photoUploadErrors.length, 'errors');
    }

    // Note: Images are now included during product creation, so no separate update is needed
    // However, if product creation failed but we have images, we can log this for debugging
    if (!shopifyProductId && imageUrls.length > 0) {
      console.warn('Action: Images were uploaded but Shopify product was not created. Images will be available when product is created manually or via sync.');
    }

    // Final verification: Ensure shopify_product_id was saved if Shopify product was created
    // This is a critical data integrity check
    if (shopifyProductId && listingId && supabase) {
      try {
        const {data: verifyListing, error: verifyError} = await supabase
          .from('listings')
          .select('shopify_product_id')
          .eq('id', listingId)
          .single();
        
        if (verifyError) {
          const isProduction = context.env.NODE_ENV === 'production';
          console.error('Action: Failed to verify shopify_product_id:', isProduction ? verifyError.message : verifyError);
        } else if (!verifyListing?.shopify_product_id) {
          // Critical: Shopify product was created but shopify_product_id is missing from database
          const isProduction = context.env.NODE_ENV === 'production';
          console.error('Action: CRITICAL - shopify_product_id verification failed:', {
            listingId,
            expectedShopifyProductId: shopifyProductId,
            ...(isProduction ? {} : {listingData: verifyListing}),
          });
          
          // Try one more time to update (last attempt)
          const {error: finalUpdateError} = await supabase
            .from('listings')
            .update({shopify_product_id: shopifyProductId})
            .eq('id', listingId);
          
          if (finalUpdateError) {
            console.error('Action: Final update attempt failed:', isProduction ? finalUpdateError.message : finalUpdateError);
            // Store in sync queue for manual intervention
            try {
              await supabase.from('shopify_sync_queue').insert({
                listing_id: listingId,
                shopify_product_id: shopifyProductId,
                error_message: `Final verification failed - shopify_product_id missing from listing: ${finalUpdateError.message || 'Unknown error'}`.substring(0, 500),
                retry_count: 0,
                created_at: new Date().toISOString(),
              }).catch(() => {
                // Table might not exist
              });
            } catch (queueError) {
              // Ignore queue errors
            }
            shopifySyncFailed = true;
          }
        }
      } catch (verifyException) {
        // Non-critical: verification failed but don't block success
        const isProduction = context.env.NODE_ENV === 'production';
        console.warn('Action: Exception during shopify_product_id verification:', isProduction ? verifyException.message : verifyException);
      }
    }

    // Success - redirect to listings page with success parameter
    // Note: If Shopify sync failed, listing is still created and can be synced later
    const redirectUrl = shopifySyncFailed
      ? '/creator/listings?submitted=true&sync=pending'
      : '/creator/listings?submitted=true';
    
    return redirect(redirectUrl);
  } catch (error) {
    // Log error details server-side only (no stack trace in production)
    const isProduction = context.env.NODE_ENV === 'production';
    if (isProduction) {
      console.error('Action: Unexpected error creating listing:', {
        message: error.message || 'Unknown error',
        name: error.name || 'Error',
        timestamp: new Date().toISOString(),
      });
    } else {
      console.error('Action: Unexpected error creating listing:', error);
    }
    
    // Cleanup: If listing was created but error occurred, try to clean it up
    // Note: listingId and uploadedFilePaths are declared in outer scope
    if (listingId) {
      try {
        // Use existing supabase client if available, otherwise create one
        let cleanupSupabase = supabase;
        if (!cleanupSupabase && supabaseUrl && anonKey && accessToken) {
          const {createUserSupabaseClient: createCleanupClient} = await import('~/lib/supabase');
          cleanupSupabase = createCleanupClient(supabaseUrl, anonKey, accessToken);
        }
        
        if (cleanupSupabase) {
          // Try to delete listing (non-blocking)
          try {
            await cleanupSupabase.from('listings').delete().eq('id', listingId);
          } catch (deleteError) {
            // Ignore cleanup errors
            console.warn('Action: Error deleting listing during cleanup:', deleteError.message);
          }
          
          // Try to cleanup uploaded files if any
          if (uploadedFilePaths && uploadedFilePaths.length > 0) {
            try {
              await cleanupSupabase.storage.from('listing-photos').remove(uploadedFilePaths);
            } catch (storageError) {
              // Ignore cleanup errors
              console.warn('Action: Error cleaning up uploaded files during cleanup:', storageError.message);
            }
          }
        }
      } catch (cleanupError) {
        // Log but don't throw - we're already in error handler
        const isProduction = context.env.NODE_ENV === 'production';
        console.error('Action: Error during cleanup:', isProduction ? cleanupError.message : cleanupError);
      }
    }
    
    // Return generic error message to client (never expose stack traces or internal details)
    return data(
      {error: 'An unexpected error occurred. Please try again later.'},
      {status: 500}
    );
  }
}


export default function CreateListing() {
  const loaderData = useLoaderData();
  const {csrfToken} = loaderData || {};
  const navigation = useNavigation();
  const actionData = useActionData();
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [selectedCondition, setSelectedCondition] = useState('');
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [price, setPrice] = useState('');
  const [priceError, setPriceError] = useState('');
  const [imageErrors, setImageErrors] = useState(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Sync submitting state with navigation state
  // navigation.state will be 'submitting' when form is being submitted, 'idle' when done
  const isSubmitting = navigation.state === 'submitting' && navigation.formMethod === 'POST';
  
  // Track image version for refresh (for consistency, though this page redirects after save)
  const [imageVersion, setImageVersion] = useState(0);
  const categoryRef = useRef(null);
  const dropdownRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  // Filter categories based on search
  const filteredCategories = categorySearch
    ? ALL_CATEGORIES.filter(cat =>
        cat.value.toLowerCase().includes(categorySearch.toLowerCase())
      )
    : ALL_CATEGORIES;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        categoryRef.current &&
        !categoryRef.current.contains(event.target)
      ) {
        setIsCategoryOpen(false);
        setCategorySearch('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Process files (used by both file input and drag & drop)
  const processFiles = (files) => {
    const fileArray = Array.from(files || []);
    if (fileArray.length === 0) return;
    
    // Filter to only image files
    const imageFiles = fileArray.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      console.warn('No image files found in selection');
      return;
    }
    
    // Create preview URLs for all new files
    const newPhotos = imageFiles.map((file) => {
      try {
        // Create blob URL for immediate preview
        const preview = URL.createObjectURL(file);
        
        // Verify the blob URL was created successfully
        if (!preview || typeof preview !== 'string') {
          console.error('Failed to create blob URL for file:', file.name);
          return null;
        }
        
        return {
          file,
          preview,
          id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        };
      } catch (error) {
        console.error('Error creating preview URL:', error, {fileName: file.name, fileType: file.type});
        return null;
      }
    }).filter(Boolean); // Remove any null entries
    
    if (newPhotos.length > 0) {
      setSelectedPhotos((prev) => {
        const updated = [...prev, ...newPhotos];
        return updated;
      });
    } else {
      console.warn('No valid photos were processed from selected files');
    }
  };

  // Handle photo selection from file input
  const handlePhotoChange = (e) => {
    processFiles(e.target.files);
  };

  // Handle drag and drop
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    processFiles(files);
  };

  // Remove photo from selection
  const handleRemovePhoto = (photoId) => {
    setSelectedPhotos((prev) => {
      const photo = prev.find((p) => p.id === photoId);
      if (photo && photo.preview) {
        URL.revokeObjectURL(photo.preview);
      }
      const updated = prev.filter((p) => p.id !== photoId);
      
      // Update the file input to reflect remaining files
      if (fileInputRef.current) {
        const dataTransfer = new DataTransfer();
        updated.forEach((p) => dataTransfer.items.add(p.file));
        fileInputRef.current.files = dataTransfer.files;
      }
      
      return updated;
    });
  };


  // Cleanup object URLs on unmount or when photos change
  useEffect(() => {
    // Store current photos for cleanup
    const currentPhotos = selectedPhotos;
    
    return () => {
      // Clean up all blob URLs when component unmounts or photos change
      currentPhotos.forEach((photo) => {
        if (photo.preview && (photo.preview.startsWith('blob:') || photo.preview.startsWith('http://') || photo.preview.startsWith('https://'))) {
          try {
            URL.revokeObjectURL(photo.preview);
          } catch (error) {
            // Ignore errors when revoking URLs (e.g., already revoked)
            console.warn('Error revoking blob URL:', error);
          }
        }
      });
    };
  }, [selectedPhotos]); // Cleanup when photos change or component unmounts

  // Handle category selection
  const handleCategorySelect = (category) => {
    setSelectedCategory(category);
    setIsCategoryOpen(false);
    setCategorySearch('');
  };

  // Handle price increment/decrement
  const handlePriceIncrement = () => {
    const currentValue = parseFloat(price) || 0;
    const newValue = (currentValue + 1.00).toFixed(2);
    setPrice(newValue);
  };

  const handlePriceDecrement = () => {
    const currentValue = parseFloat(price) || 0;
    const MIN_PRICE = 100;
    if (currentValue > MIN_PRICE) {
      const newValue = Math.max(MIN_PRICE, currentValue - 1.00).toFixed(2);
      setPrice(newValue);
    }
  };

  const submit = useSubmit();

  // Handle form submission with files from state
  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate required fields
    if (!selectedCategory) {
      alert('Please select a category');
      return;
    }
    
    if (!selectedCondition) {
      alert('Please select a condition');
      return;
    }
    
    const MIN_PRICE = 100;
    const priceFloat = parseFloat(price);
    if (!price || isNaN(priceFloat) || priceFloat <= 0) {
      alert('Please enter a valid price');
      return;
    }
    if (priceFloat < MIN_PRICE) {
      alert(`Price must be at least $${MIN_PRICE}. Please enter a price of $${MIN_PRICE} or higher.`);
      return;
    }
    
    // Validate that we have photos
    if (selectedPhotos.length === 0) {
      alert('Please select at least one photo');
      return;
    }

    // Clear any previous error messages
    setErrorMessage('');

    // Manually construct FormData with files from state
    const formData = new FormData();
    
    // Add CSRF token (required for security)
    if (!csrfToken) {
      console.error('CSRF token missing from loader data');
      alert('Security token missing. Please refresh the page and try again.');
      return;
    }
    formData.append('csrf_token', csrfToken);
    
    // Add form fields - use form elements or state values
    const form = e.target;
    const titleInput = form.querySelector('[name="title"]');
    const descriptionInput = form.querySelector('[name="description"]');
    const priceInput = form.querySelector('[name="price"]');
    
    if (titleInput) formData.append('title', titleInput.value);
    formData.append('category', selectedCategory);
    formData.append('condition', selectedCondition);
    if (descriptionInput) formData.append('description', descriptionInput.value);
    if (priceInput) formData.append('price', priceInput.value);
    
    // Add files from selectedPhotos state
    selectedPhotos.forEach((photo) => {
      if (photo.file) {
        formData.append('photos', photo.file);
      }
    });

    // Submit the form with our FormData
    submit(formData, {
      method: 'post',
      encType: 'multipart/form-data',
    });
  };
  
  // Handle action errors
  useEffect(() => {
    if (actionData && typeof actionData === 'object' && actionData.error) {
      setErrorMessage(actionData.error);
    } else {
      setErrorMessage('');
    }
  }, [actionData]);

  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="pb-32 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Form method="post" encType="multipart/form-data" onSubmit={handleSubmit}>
          <input type="hidden" name="csrf_token" value={csrfToken || ''} />
          <div className="space-y-12">
            <div className="border-b border-gray-900/10 pb-12 dark:border-white/10">
              <h2 className="text-base/7 font-semibold text-gray-900 dark:text-white">Listing Details</h2>
              <p className="mt-1 text-sm/6 text-gray-600 dark:text-gray-400">
                Provide information about your item. After submission, your listing will be set to pending
                approval and won't be publicly visible until approved.
              </p>

              {/* Error Message Display */}
              {errorMessage && (
                <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900/20 p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-red-800 dark:text-red-200">{errorMessage}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
                {/* Title Field */}
                <div className="col-span-full">
                  <label htmlFor="title" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Title *
                  </label>
                  <div className="mt-2">
                    <input
                      type="text"
                      id="title"
                      name="title"
                      required
                      placeholder="Enter a title for your listing..."
                      className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                    />
                  </div>
                  <p className="mt-3 text-sm/6 text-gray-600 dark:text-gray-400">A short, descriptive title for your item.</p>
                </div>

                {/* Category Dropdown */}
                <div className="col-span-full">
                  <label htmlFor="category" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Category *
                  </label>
                  <div className="mt-2 relative">
                    <input
                      type="hidden"
                      name="category"
                      value={selectedCategory}
                      required
                    />
                    <div className="grid grid-cols-1">
                      <button
                        type="button"
                        ref={categoryRef}
                        onClick={() => setIsCategoryOpen(!isCategoryOpen)}
                        className={`col-start-1 row-start-1 w-full appearance-none rounded-md bg-white py-1.5 pr-8 pl-3 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:focus:outline-indigo-500 text-left ${
                          !selectedCategory ? 'text-gray-400 dark:text-gray-500' : ''
                        }`}
                      >
                        {selectedCategory || 'Select a category'}
                      </button>
                      <ChevronDownIcon
                        aria-hidden="true"
                        className={`pointer-events-none col-start-1 row-start-1 mr-2 size-5 self-center justify-self-end text-gray-500 sm:size-4 dark:text-gray-400 transition-transform ${
                          isCategoryOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </div>

                    {isCategoryOpen && (
                      <div
                        ref={dropdownRef}
                        className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-white/10 rounded-md shadow-lg max-h-80 overflow-hidden outline-1 -outline-offset-1 outline-gray-300 dark:outline-white/10"
                      >
                        {/* Search input */}
                        <div className="p-2 border-b border-gray-200 dark:border-white/10">
                          <input
                            type="text"
                            value={categorySearch}
                            onChange={(e) => setCategorySearch(e.target.value)}
                            placeholder="Search categories..."
                            className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-gray-800 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                            autoFocus
                          />
                        </div>

                        {/* Category list */}
                        <div className="max-h-64 overflow-y-auto">
                          {filteredCategories.length === 0 ? (
                            <div className="px-4 py-3 text-sm/6 text-gray-500 dark:text-gray-400">
                              No categories found
                            </div>
                          ) : (
                            filteredCategories.map((cat) => (
                              <button
                                key={cat.value}
                                type="button"
                                onClick={() => handleCategorySelect(cat.value)}
                                className={`w-full text-left px-4 py-2 text-sm/6 hover:bg-gray-100 dark:hover:bg-white/10 ${
                                  selectedCategory === cat.value
                                    ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                                    : 'text-gray-900 dark:text-white'
                                }`}
                              >
                                {cat.value}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Condition Dropdown */}
                <div className="col-span-full">
                  <label htmlFor="condition" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Condition *
                  </label>
                  <div className="mt-2">
                    <select
                      id="condition"
                      name="condition"
                      value={selectedCondition}
                      onChange={(e) => setSelectedCondition(e.target.value)}
                      required
                      className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:focus:outline-indigo-500"
                    >
                      <option value="">Select condition...</option>
                      <option value="Barely worn">Barely worn</option>
                      <option value="Lightly worn">Lightly worn</option>
                      <option value="Heavily worn">Heavily worn</option>
                    </select>
                  </div>
                  <p className="mt-3 text-sm/6 text-gray-600 dark:text-gray-400">Select the condition of your item.</p>
                </div>

                {/* Description Field */}
                <div className="col-span-full">
                  <label htmlFor="description" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Description *
                  </label>
                  <div className="mt-2">
                    <textarea
                      id="description"
                      name="description"
                      required
                      rows={6}
                      placeholder="Describe your item..."
                      className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
                    />
                  </div>
                  <p className="mt-3 text-sm/6 text-gray-600 dark:text-gray-400">Write a detailed description of your item.</p>
                </div>

                {/* Price Field */}
                <div className="sm:col-span-3">
                  <label htmlFor="price" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Price (USD) *
                  </label>
                  <div className="mt-2 relative">
                    <div className="absolute inset-y-0 right-0 pr-3 flex flex-col items-center justify-center gap-0.5">
                      <button
                        type="button"
                        onClick={handlePriceIncrement}
                        className="p-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:text-indigo-600 dark:focus:text-indigo-400 transition-colors"
                        aria-label="Increase price"
                      >
                        <ChevronUpIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handlePriceDecrement}
                        className="p-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:text-indigo-600 dark:focus:text-indigo-400 transition-colors"
                        aria-label="Decrease price"
                      >
                        <ChevronDownIcon className="size-4" />
                      </button>
                    </div>
                    <input
                      type="number"
                      id="price"
                      name="price"
                      value={price}
                      onChange={(e) => {
                        const value = e.target.value;
                        setPrice(value);
                        const priceFloat = parseFloat(value);
                        const MIN_PRICE = 100;
                        if (value && !isNaN(priceFloat) && priceFloat < MIN_PRICE) {
                          setPriceError(`Price must be at least $${MIN_PRICE}`);
                        } else {
                          setPriceError('');
                        }
                      }}
                      onBlur={(e) => {
                        const value = e.target.value;
                        const priceFloat = parseFloat(value);
                        const MIN_PRICE = 100;
                        if (value && !isNaN(priceFloat) && priceFloat < MIN_PRICE) {
                          setPriceError(`Price must be at least $${MIN_PRICE}`);
                        } else {
                          setPriceError('');
                        }
                      }}
                      required
                      min="100"
                      step="0.01"
                      placeholder="100.00"
                      className={`block w-full rounded-md bg-white px-3 py-1.5 pr-12 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield] ${
                        priceError 
                          ? 'outline-red-600 dark:outline-red-500 focus:outline-red-600 dark:focus:outline-red-500' 
                          : 'focus:outline-indigo-600 dark:focus:outline-indigo-500'
                      }`}
                    />
                  </div>
                  {priceError ? (
                    <p className="mt-2 text-sm/6 text-red-600 dark:text-red-400">{priceError}</p>
                  ) : (
                    <p className="mt-3 text-sm/6 text-gray-600 dark:text-gray-400">
                      Enter the price in USD. <span className="font-medium text-gray-900 dark:text-white">Minimum price is $100.</span>
                    </p>
                  )}
                </div>

                {/* Photo Upload */}
                <div className="col-span-full">
                  <label htmlFor="photos" className="block text-sm/6 font-medium text-gray-900 dark:text-white">
                    Reference Photos *
                  </label>
                  <div
                    ref={dropZoneRef}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`mt-2 flex justify-center rounded-lg border border-dashed px-6 py-10 transition-colors ${
                      isDragging
                        ? 'border-indigo-600 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-900/20'
                        : 'border-gray-900/25 dark:border-white/25'
                    }`}
                  >
                    <div className="text-center">
                      <PhotoIcon aria-hidden="true" className="mx-auto size-12 text-gray-300 dark:text-gray-600" />
                      <div className="mt-4 flex text-sm/6 text-gray-600 dark:text-gray-400">
                        <label
                          htmlFor="photos"
                          className="relative pr-1 cursor-pointer rounded-md bg-transparent font-semibold text-indigo-600 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:focus-within:outline-indigo-500 dark:hover:text-indigo-300"
                        >
                          <span>Upload files</span>
                          <input
                            ref={fileInputRef}
                            id="photos"
                            name="photos"
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={handlePhotoChange}
                            className="sr-only"
                          />
                        </label>
                        <p className="pl-2">or drag and drop</p>
                      </div>
                      <p className="text-xs/5 text-gray-600 dark:text-gray-400">PNG, JPG, GIF up to 10MB</p>
                    </div>
                  </div>

                  {/* Photo Preview Grid */}
                  {selectedPhotos.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-sm/6 font-medium text-gray-900 dark:text-white mb-4">
                        Selected Photos ({selectedPhotos.length})
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {selectedPhotos.map((photo, index) => {
                          return (
                            <div
                              key={photo.id || `photo-${index}`}
                              className="relative group rounded-lg overflow-hidden border border-gray-300 dark:border-white/10 bg-gray-100 dark:bg-white/5"
                              style={{
                                aspectRatio: '1 / 1',
                                minHeight: '150px',
                                position: 'relative'
                              }}
                            >
                              {photo.preview && !imageErrors.has(photo.id) ? (
                                <>
                                  <img
                                    key={`${photo.id}-${imageVersion}`}
                                    src={photo.preview}
                                    alt={`Preview ${index + 1}: ${photo.file?.name || 'image'}`}
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={{
                                      display: 'block',
                                      maxWidth: '100%',
                                      maxHeight: '100%'
                                    }}
                                    loading="lazy"
                                    onError={(e) => {
                                      console.error('Failed to load image preview:', {
                                        preview: photo.preview,
                                        id: photo.id,
                                        fileName: photo.file?.name,
                                        fileType: photo.file?.type,
                                        fileSize: photo.file?.size,
                                        error: e
                                      });
                                      // Mark this image as having an error
                                      setImageErrors(prev => new Set(prev).add(photo.id));
                                    }}
                                    onLoad={(e) => {
                                      // Image loaded successfully
                                      // Remove from errors if it was there
                                      setImageErrors(prev => {
                                        const next = new Set(prev);
                                        next.delete(photo.id);
                                        return next;
                                      });
                                    }}
                                  />
                                  {/* Loading overlay when submitting */}
                                  {isSubmitting && (
                                    <div className="absolute inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-10">
                                      <div className="flex flex-col items-center gap-1">
                                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <p className="text-xs text-white">Uploading...</p>
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : photo.preview && imageErrors.has(photo.id) ? (
                                // Error fallback - shown when image fails to load
                                <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-gray-200 dark:bg-white/5 text-gray-500 dark:text-gray-400 text-xs p-2">
                                  <div className="text-center">
                                    <p>{photo.file?.name || 'Image'}</p>
                                    <p className="text-red-500 mt-1">Preview unavailable</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-xs">
                                  <div className="text-center">
                                    <p>No preview</p>
                                    <p className="text-xs mt-1">{photo.file?.name || ''}</p>
                                  </div>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemovePhoto(photo.id)}
                                className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-lg"
                                aria-label="Remove photo"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>

          <div className="mt-6 flex items-center justify-end gap-x-6">
            <button
              type="button"
              onClick={() => window.history.back()}
              className="text-sm/6 font-semibold text-gray-900 dark:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:shadow-none dark:focus-visible:outline-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Submitting...
                </>
              ) : (
                'Submit for Approval'
              )}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

/** @typedef {import('./+types/creator.listings.new').Route} Route */
