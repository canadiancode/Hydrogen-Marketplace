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
    const sanitizedEmail = userEmail.replace(/[@.]/g, '_');
    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    // Ensure valid extension
    const validExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    const finalExt = validExts.includes(fileExt) ? fileExt : 'jpg';
    const fileName = `profile.${finalExt}`;
    const filePath = `${sanitizedEmail}/${fileName}`;

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

    console.log('Generated public URL:', {
      filePath,
      publicUrl: urlData?.publicUrl,
      urlData,
      fullResponse: JSON.stringify(urlData),
    });

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

    console.log('Image upload successful:', {
      filePath,
      publicUrl,
      urlLength: publicUrl.length,
    });

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

    // List files in user's folder
    const {data: files, error: listError} = await supabase.storage
      .from('creator-profile-images')
      .list(userEmail);

    if (listError) {
      return {
        success: false,
        error: new Error(listError.message || 'Failed to list images'),
      };
    }

    // Delete all files in user's folder (usually just one profile image)
    const filePaths = files.map((file) => `${sanitizedEmail}/${file.name}`);
    
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
