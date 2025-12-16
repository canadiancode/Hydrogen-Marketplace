/**
 * Image Upload Utilities for Supabase Storage
 * 
 * Handles uploading creator profile images to Supabase Storage
 */

/**
 * Validates image dimensions from file buffer
 * Prevents DoS attacks from extremely large images
 * 
 * @param {ArrayBuffer} buffer - Image file buffer
 * @param {string} mimeType - Image MIME type
 * @returns {Promise<{valid: boolean, width?: number, height?: number, error?: string}>}
 */
async function validateImageDimensions(buffer, mimeType) {
  const MAX_DIMENSION = 5000; // Maximum width or height in pixels
  const MAX_PIXELS = 25000000; // Maximum total pixels (5000x5000)
  
  try {
    const bytes = new Uint8Array(buffer);
    let width = 0;
    let height = 0;
    
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      // JPEG: Dimensions are in SOF (Start of Frame) markers
      // Look for SOF markers (0xFFC0, 0xFFC1, 0xFFC2, etc.)
      for (let i = 0; i < bytes.length - 8; i++) {
        if (bytes[i] === 0xFF && (bytes[i + 1] >= 0xC0 && bytes[i + 1] <= 0xC3)) {
          height = (bytes[i + 5] << 8) | bytes[i + 6];
          width = (bytes[i + 7] << 8) | bytes[i + 8];
          break;
        }
      }
    } else if (mimeType === 'image/png') {
      // PNG: Dimensions are in IHDR chunk (bytes 16-23)
      if (bytes.length >= 24) {
        width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      }
    } else if (mimeType === 'image/gif') {
      // GIF: Dimensions are in bytes 6-9
      if (bytes.length >= 10) {
        width = bytes[7] << 8 | bytes[6];
        height = bytes[9] << 8 | bytes[8];
      }
    } else if (mimeType === 'image/webp') {
      // WebP: More complex format, check VP8 or VP8L header
      // VP8: bytes 12-15 contain width/height
      // VP8L: bytes 21-24 contain width/height
      if (bytes.length >= 30) {
        // Check for VP8 format (starts with VP8)
        if (bytes[12] === 0x9D && bytes[13] === 0x01 && bytes[14] === 0x2A) {
          width = ((bytes[15] | (bytes[16] << 8)) & 0x3FFF) * 2;
          height = ((bytes[17] | (bytes[18] << 8)) & 0x3FFF) * 2;
        }
        // Check for VP8L format
        else if (bytes[12] === 0x2F) {
          const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
          width = (bits & 0x3FFF) + 1;
          height = ((bits >> 14) & 0x3FFF) + 1;
        }
      }
    }
    
    // Validate dimensions
    if (width === 0 || height === 0) {
      // If we couldn't read dimensions, allow the file but log a warning
      // This is safer than rejecting valid files we can't parse
      console.warn('Could not determine image dimensions, proceeding with caution');
      return {valid: true};
    }
    
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      return {
        valid: false,
        width,
        height,
        error: `Image dimensions (${width}x${height}) exceed maximum allowed size of ${MAX_DIMENSION}x${MAX_DIMENSION} pixels.`,
      };
    }
    
    const totalPixels = width * height;
    if (totalPixels > MAX_PIXELS) {
      return {
        valid: false,
        width,
        height,
        error: `Image is too large (${width}x${height} = ${totalPixels.toLocaleString()} pixels). Maximum allowed is ${MAX_PIXELS.toLocaleString()} pixels.`,
      };
    }
    
    return {valid: true, width, height};
  } catch (error) {
    // If dimension validation fails, log but don't block upload
    // This prevents breaking valid uploads due to parsing errors
    console.warn('Error validating image dimensions:', error);
    return {valid: true};
  }
}

/**
 * Uploads a profile image to Supabase Storage
 * 
 * @param {File} file - The image file to upload
 * @param {string} userEmail - User's email (used for folder organization)
 * @param {string} supabaseUrl - Supabase project URL
 * @param {string} anonKey - Supabase anon key
 * @param {string} accessToken - User's access token
 * @returns {Promise<{url: string | null, error: Error | null}>}
 */
export async function uploadProfileImage(file, userEmail, supabaseUrl, anonKey, accessToken) {
  if (!file || !userEmail || !supabaseUrl || !anonKey || !accessToken) {
    return {
      url: null,
      error: new Error('Missing required parameters'),
    };
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return {
      url: null,
      error: new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'),
    };
  }

  // Validate file size (5MB max)
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    return {
      url: null,
      error: new Error('File size exceeds 5MB limit.'),
    };
  }

  // Validate file content using magic bytes (file signature)
  // This prevents MIME type spoofing attacks
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer.slice(0, 12)); // Read first 12 bytes for all formats
    
    // Check magic bytes for different image formats
    const magicBytes = Array.from(bytes.slice(0, 4))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    
    // For WebP, check bytes 8-11 for "WEBP"
    const webpBytes = bytes.length >= 12 
      ? Array.from(bytes.slice(8, 12))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()
      : '';
    
    // Magic byte signatures:
    // JPEG: FF D8 FF
    // PNG: 89 50 4E 47
    // GIF: 47 49 46 38 (GIF89a or GIF87a)
    // WebP: RIFF...WEBP (starts with RIFF at bytes 0-3, WEBP at bytes 8-11)
    const isWebP = magicBytes.startsWith('52494646') && webpBytes === '57454250';
    const isValidImage = 
      magicBytes.startsWith('FFD8FF') || // JPEG
      magicBytes.startsWith('89504E47') || // PNG
      magicBytes.startsWith('47494638') || // GIF
      isWebP; // WebP (RIFF at 0-3, WEBP at 8-11)
    
    if (!isValidImage) {
      return {
        url: null,
        error: new Error('File content does not match file type. The file may be corrupted or malicious.'),
      };
    }
    
    // Additional validation: ensure MIME type matches magic bytes
    const expectedMimeType = 
      magicBytes.startsWith('FFD8FF') ? 'image/jpeg' :
      magicBytes.startsWith('89504E47') ? 'image/png' :
      magicBytes.startsWith('47494638') ? 'image/gif' :
      isWebP ? 'image/webp' :
      null;
    
    // Fixed logic: Use OR instead of AND for the fallback checks
    // If file type matches expected OR matches magic bytes directly, it's valid
    const typeMatches = file.type === expectedMimeType ||
      (file.type === 'image/jpeg' && magicBytes.startsWith('FFD8FF')) ||
      (file.type === 'image/png' && magicBytes.startsWith('89504E47')) ||
      (file.type === 'image/gif' && magicBytes.startsWith('47494638')) ||
      (file.type === 'image/webp' && isWebP);
    
    if (!typeMatches) {
      return {
        url: null,
        error: new Error('File type mismatch. The file extension does not match the file content.'),
      };
    }
    
    // Validate image dimensions to prevent DoS attacks
    const dimensionCheck = await validateImageDimensions(buffer, file.type);
    if (!dimensionCheck.valid) {
      return {
        url: null,
        error: new Error(dimensionCheck.error || 'Image dimensions exceed maximum allowed size.'),
      };
    }
  } catch (magicByteError) {
    console.error('Error validating file magic bytes:', magicByteError);
    return {
      url: null,
      error: new Error('Unable to validate file. Please try a different image.'),
    };
  }

  try {
    // Import Supabase client creation function
    const {createUserSupabaseClient} = await import('~/lib/supabase');
    
    // Create Supabase client with user authentication
    // This client includes the Authorization header needed for Storage RLS
    const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

    // Verify the user is authenticated (this also ensures the token is valid)
    const {data: {user}, error: userError} = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Error verifying user authentication:', userError);
      return {
        url: null,
        error: new Error('Authentication failed. Please log in again.'),
      };
    }

    // Generate file path: {user-email}/profile.{ext}
    // Sanitize email for use in file path (replace @ and . with safe characters)
    // Also remove any path traversal attempts
    const sanitizedEmail = userEmail
      .replace(/[@.]/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '') // Remove any other unsafe characters
      .substring(0, 100); // Limit length
    
    // Determine extension from validated file type (not filename to prevent spoofing)
    let finalExt = 'jpg';
    if (file.type === 'image/png') finalExt = 'png';
    else if (file.type === 'image/gif') finalExt = 'gif';
    else if (file.type === 'image/webp') finalExt = 'webp';
    else if (file.type === 'image/jpeg' || file.type === 'image/jpg') finalExt = 'jpg';
    
    // Use fixed filename to prevent path traversal
    const fileName = `profile.${finalExt}`;
    const filePath = `${sanitizedEmail}/${fileName}`;
    
    // Final security check: ensure no path traversal in final path
    if (filePath.includes('..') || filePath.includes('//') || filePath.startsWith('/')) {
      return {
        url: null,
        error: new Error('Invalid file path. Please try again.'),
      };
    }

    // Upload file to Supabase Storage
    const {data, error} = await supabase.storage
      .from('creator-profile-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true, // Replace existing file if it exists
      });

    if (error) {
      console.error('Error uploading image:', error);
      return {
        url: null,
        error: new Error(error.message || 'Failed to upload image'),
      };
    }

    // Get public URL
    // Note: getPublicUrl returns { data: { publicUrl: string } }
    const {data: urlData} = supabase.storage
      .from('creator-profile-images')
      .getPublicUrl(filePath);

    // Check if publicUrl exists - it should be in urlData.publicUrl
    const publicUrl = urlData?.publicUrl;
    
    if (!publicUrl || typeof publicUrl !== 'string') {
      console.error('Failed to get public URL - invalid format:', {
        filePath,
        urlData,
        publicUrl,
        type: typeof publicUrl,
      });
      return {
        url: null,
        error: new Error('Failed to get image URL - invalid format returned'),
      };
    }

    // Validate URL format
    try {
      new URL(publicUrl);
    } catch (urlError) {
      console.error('Invalid URL format:', {
        publicUrl,
        error: urlError,
      });
      return {
        url: null,
        error: new Error('Invalid image URL format'),
      };
    }

    return {
      url: publicUrl,
      error: null,
    };
  } catch (err) {
    console.error('Unexpected error uploading image:', err);
    return {
      url: null,
      error: new Error('An unexpected error occurred while uploading the image'),
    };
  }
}

/**
 * Uploads a cover image to Supabase Storage
 * 
 * @param {File} file - The image file to upload
 * @param {string} userEmail - User's email (used for folder organization)
 * @param {string} supabaseUrl - Supabase project URL
 * @param {string} anonKey - Supabase anon key
 * @param {string} accessToken - User's access token
 * @returns {Promise<{url: string | null, error: Error | null}>}
 */
export async function uploadCoverImage(file, userEmail, supabaseUrl, anonKey, accessToken) {
  if (!file || !userEmail || !supabaseUrl || !anonKey || !accessToken) {
    return {
      url: null,
      error: new Error('Missing required parameters'),
    };
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return {
      url: null,
      error: new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'),
    };
  }

  // Validate file size (5MB max)
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    return {
      url: null,
      error: new Error('File size exceeds 5MB limit.'),
    };
  }

  // Validate file content using magic bytes (file signature)
  // This prevents MIME type spoofing attacks
  try {
    const buffer = await file.arrayBuffer();
    // Read more bytes for WebP validation (need at least 12 bytes)
    const bytes = new Uint8Array(buffer.slice(0, Math.max(12, buffer.byteLength)));
    
    // Check magic bytes for different image formats
    const magicBytes = Array.from(bytes.slice(0, 4))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    
    // For WebP, check bytes 8-11 for "WEBP"
    // WebP format: RIFF (4 bytes) + file size (4 bytes) + WEBP (4 bytes)
    const webpBytes = bytes.length >= 12 
      ? Array.from(bytes.slice(8, 12))
          .map(b => String.fromCharCode(b))
          .join('')
      : '';
    const webpBytesHex = bytes.length >= 12
      ? Array.from(bytes.slice(8, 12))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()
      : '';
    
    // Magic byte signatures:
    // JPEG: FF D8 FF
    // PNG: 89 50 4E 47
    // GIF: 47 49 46 38 (GIF89a or GIF87a)
    // WebP: RIFF...WEBP (starts with RIFF at bytes 0-3, WEBP at bytes 8-11)
    // Check both ASCII and hex representations for WebP
    const isWebP = magicBytes.startsWith('52494646') && (webpBytes === 'WEBP' || webpBytesHex === '57454250');
    
    const isValidImage = 
      magicBytes.startsWith('FFD8FF') || // JPEG
      magicBytes.startsWith('89504E47') || // PNG
      magicBytes.startsWith('47494638') || // GIF
      isWebP; // WebP (RIFF at 0-3, WEBP at 8-11)
    
    if (!isValidImage) {
      return {
        url: null,
        error: new Error('File content does not match file type. The file may be corrupted or malicious.'),
      };
    }
    
    // Additional validation: ensure MIME type matches magic bytes
    const expectedMimeType = 
      magicBytes.startsWith('FFD8FF') ? 'image/jpeg' :
      magicBytes.startsWith('89504E47') ? 'image/png' :
      magicBytes.startsWith('47494638') ? 'image/gif' :
      isWebP ? 'image/webp' :
      null;
    
    // Fixed logic: Use OR instead of AND for the fallback checks
    // If file type matches expected OR matches magic bytes directly, it's valid
    const typeMatches = file.type === expectedMimeType ||
      (file.type === 'image/jpeg' && magicBytes.startsWith('FFD8FF')) ||
      (file.type === 'image/png' && magicBytes.startsWith('89504E47')) ||
      (file.type === 'image/gif' && magicBytes.startsWith('47494638')) ||
      (file.type === 'image/webp' && isWebP);
    
    if (!typeMatches) {
      return {
        url: null,
        error: new Error('File type mismatch. The file extension does not match the file content.'),
      };
    }
    
    // Validate image dimensions to prevent DoS attacks
    const dimensionCheck = await validateImageDimensions(buffer, file.type);
    if (!dimensionCheck.valid) {
      return {
        url: null,
        error: new Error(dimensionCheck.error || 'Image dimensions exceed maximum allowed size.'),
      };
    }
  } catch (magicByteError) {
    console.error('Error validating file magic bytes:', magicByteError);
    return {
      url: null,
      error: new Error('Unable to validate file. Please try a different image.'),
    };
  }

  try {
    // Import Supabase client creation function
    const {createUserSupabaseClient} = await import('~/lib/supabase');
    
    // Create Supabase client with user authentication
    // This client includes the Authorization header needed for Storage RLS
    const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

    // Verify the user is authenticated (this also ensures the token is valid)
    const {data: {user}, error: userError} = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Error verifying user authentication:', userError);
      return {
        url: null,
        error: new Error('Authentication failed. Please log in again.'),
      };
    }

    // Generate file path: {user-email}/cover.{ext}
    // Sanitize email for use in file path (replace @ and . with safe characters)
    // Also remove any path traversal attempts
    const sanitizedEmail = userEmail
      .replace(/[@.]/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '') // Remove any other unsafe characters
      .substring(0, 100); // Limit length
    
    // Determine extension from validated file type (not filename to prevent spoofing)
    let finalExt = 'jpg';
    if (file.type === 'image/png') finalExt = 'png';
    else if (file.type === 'image/gif') finalExt = 'gif';
    else if (file.type === 'image/webp') finalExt = 'webp';
    else if (file.type === 'image/jpeg' || file.type === 'image/jpg') finalExt = 'jpg';
    
    // Use fixed filename to prevent path traversal
    const fileName = `cover.${finalExt}`;
    const filePath = `${sanitizedEmail}/${fileName}`;
    
    // Final security check: ensure no path traversal in final path
    if (filePath.includes('..') || filePath.includes('//') || filePath.startsWith('/')) {
      return {
        url: null,
        error: new Error('Invalid file path. Please try again.'),
      };
    }

    // Upload file to Supabase Storage
    const {data, error} = await supabase.storage
      .from('creator-cover-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true, // Replace existing file if it exists
      });

    if (error) {
      console.error('Error uploading cover image:', error);
      
      // Provide more helpful error message for RLS policy violations
      if (error.message?.includes('row-level security') || error.message?.includes('RLS') || error.statusCode === 403) {
        return {
          url: null,
          error: new Error('Storage bucket permissions error. Please ensure the creator-cover-images bucket exists and has proper RLS policies configured in Supabase.'),
        };
      }
      
      return {
        url: null,
        error: new Error(error.message || 'Failed to upload image'),
      };
    }

    // Get public URL
    // Note: getPublicUrl returns { data: { publicUrl: string } }
    const {data: urlData} = supabase.storage
      .from('creator-cover-images')
      .getPublicUrl(filePath);

    // Check if publicUrl exists - it should be in urlData.publicUrl
    const publicUrl = urlData?.publicUrl;
    
    if (!publicUrl || typeof publicUrl !== 'string') {
      console.error('Failed to get public URL - invalid format:', {
        filePath,
        urlData,
        publicUrl,
        type: typeof publicUrl,
      });
      return {
        url: null,
        error: new Error('Failed to get image URL - invalid format returned'),
      };
    }

    // Validate URL format
    try {
      new URL(publicUrl);
    } catch (urlError) {
      console.error('Invalid URL format:', {
        publicUrl,
        error: urlError,
      });
      return {
        url: null,
        error: new Error('Invalid image URL format'),
      };
    }

    return {
      url: publicUrl,
      error: null,
    };
  } catch (err) {
    console.error('Unexpected error uploading cover image:', err);
    return {
      url: null,
      error: new Error('An unexpected error occurred while uploading the image'),
    };
  }
}

/**
 * Deletes a profile image from Supabase Storage
 * 
 * @param {string} userEmail - User's email
 * @param {string} supabaseUrl - Supabase project URL
 * @param {string} anonKey - Supabase anon key
 * @param {string} accessToken - User's access token
 * @returns {Promise<{success: boolean, error: Error | null}>}
 */
export async function deleteProfileImage(userEmail, supabaseUrl, anonKey, accessToken) {
  if (!userEmail || !supabaseUrl || !anonKey || !accessToken) {
    return {
      success: false,
      error: new Error('Missing required parameters'),
    };
  }

  try {
    const {createUserSupabaseClient} = await import('~/lib/supabase');
    const supabase = createUserSupabaseClient(supabaseUrl, anonKey, accessToken);

    // Sanitize email for use in file path (same as upload function)
    const sanitizedEmail = userEmail
      .replace(/[@.]/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '') // Remove any other unsafe characters
      .substring(0, 100); // Limit length
    
    // List files in user's folder
    const {data: files, error: listError} = await supabase.storage
      .from('creator-profile-images')
      .list(sanitizedEmail);

    if (listError) {
      return {
        success: false,
        error: new Error(listError.message || 'Failed to list images'),
      };
    }

    // Delete all files in user's folder (usually just one profile image)
    const filePaths = files.map((file) => {
      const filePath = `${sanitizedEmail}/${file.name}`;
      // Security check: ensure no path traversal
      if (filePath.includes('..') || filePath.includes('//') || filePath.startsWith('/')) {
        return null;
      }
      return filePath;
    }).filter(Boolean);
    
    if (filePaths.length > 0) {
      const {error: deleteError} = await supabase.storage
        .from('creator-profile-images')
        .remove(filePaths);

      if (deleteError) {
        return {
          success: false,
          error: new Error(deleteError.message || 'Failed to delete image'),
        };
      }
    }

    return {
      success: true,
      error: null,
    };
  } catch (err) {
    console.error('Unexpected error deleting image:', err);
    return {
      success: false,
      error: new Error('An unexpected error occurred while deleting the image'),
    };
  }
}
