/**
 * Image Upload Utilities for Supabase Storage
 * 
 * Handles uploading creator profile images to Supabase Storage
 */

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
    
    const magicBytes12 = Array.from(bytes.slice(0, 12))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    
    // Magic byte signatures:
    // JPEG: FF D8 FF
    // PNG: 89 50 4E 47
    // GIF: 47 49 46 38 (GIF89a or GIF87a)
    // WebP: RIFF...WEBP (starts with RIFF at bytes 0-3, WEBP at bytes 8-11)
    const isValidImage = 
      magicBytes.startsWith('FFD8FF') || // JPEG
      magicBytes.startsWith('89504E47') || // PNG
      magicBytes.startsWith('47494638') || // GIF
      (magicBytes.startsWith('52494646') && magicBytes12.includes('57454250')); // WebP (RIFF...WEBP)
    
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
      'image/webp';
    
    if (file.type !== expectedMimeType && 
        !(file.type === 'image/jpeg' && magicBytes.startsWith('FFD8FF')) && // Allow jpeg/jpg
        !(file.type === 'image/png' && magicBytes.startsWith('89504E47')) &&
        !(file.type === 'image/gif' && magicBytes.startsWith('47494638')) &&
        !(file.type === 'image/webp' && magicBytes.startsWith('52494646'))) {
      return {
        url: null,
        error: new Error('File type mismatch. The file extension does not match the file content.'),
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
