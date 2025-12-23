/**
 * File Validation Utilities
 * 
 * Provides secure file validation including magic byte detection,
 * image dimension checks, and MIME type verification.
 * 
 * Security: Validates file content, not just file extensions or MIME types
 * which can be spoofed by attackers.
 */

/**
 * Magic bytes (file signatures) for allowed image types
 * These are the actual bytes at the start of valid image files
 */
const IMAGE_SIGNATURES = {
  'image/jpeg': [
    [0xFF, 0xD8, 0xFF], // JPEG
  ],
  'image/png': [
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], // PNG
  ],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
  'image/webp': [
    // WebP files start with RIFF header, then WEBP
    // We check for RIFF at 0 and WEBP at 8
    [0x52, 0x49, 0x46, 0x46], // RIFF (we'll check WEBP separately)
  ],
};

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_DIMENSION = 5000; // Max width or height in pixels
const MIN_IMAGE_DIMENSION = 1; // Min width or height in pixels

/**
 * Validates file signature (magic bytes) against expected image types
 * This prevents MIME type spoofing attacks
 * 
 * @param {ArrayBuffer} buffer - File buffer to check
 * @param {string} expectedMimeType - Expected MIME type
 * @returns {boolean} - True if signature matches
 */
function validateFileSignature(buffer, expectedMimeType) {
  if (!buffer || buffer.byteLength < 12) {
    return false;
  }

  const bytes = new Uint8Array(buffer);
  const signatures = IMAGE_SIGNATURES[expectedMimeType];

  if (!signatures) {
    return false;
  }

  // Check each signature pattern
  for (const signature of signatures) {
    let matches = true;
    
    if (expectedMimeType === 'image/webp') {
      // WebP: Check for RIFF at start and WEBP at position 8
      if (bytes.length < 12) return false;
      const riffMatch = bytes[0] === 0x52 && bytes[1] === 0x49 && 
                        bytes[2] === 0x46 && bytes[3] === 0x46;
      const webpMatch = bytes[8] === 0x57 && bytes[9] === 0x45 && 
                        bytes[10] === 0x42 && bytes[11] === 0x50;
      if (riffMatch && webpMatch) {
        return true;
      }
    } else {
      // For other formats, check signature from start
      for (let i = 0; i < signature.length; i++) {
        if (bytes[i] !== signature[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Gets image dimensions from buffer
 * Supports JPEG, PNG, GIF, and WebP
 * 
 * @param {ArrayBuffer} buffer - Image file buffer
 * @param {string} mimeType - MIME type of the image
 * @returns {Promise<{width: number, height: number} | null>} - Image dimensions or null if invalid
 */
async function getImageDimensions(buffer, mimeType) {
  const bytes = new Uint8Array(buffer);

  try {
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      return getJPEGDimensions(bytes);
    } else if (mimeType === 'image/png') {
      return getPNGDimensions(bytes);
    } else if (mimeType === 'image/gif') {
      return getGIFDimensions(bytes);
    } else if (mimeType === 'image/webp') {
      return getWebPDimensions(bytes);
    }
  } catch (error) {
    console.error('Error reading image dimensions:', error);
    return null;
  }

  return null;
}

/**
 * Extracts dimensions from JPEG file
 */
function getJPEGDimensions(bytes) {
  let i = 2; // Skip FF D8

  while (i < bytes.length - 1) {
    // Find next marker
    if (bytes[i] === 0xFF && bytes[i + 1] !== 0xFF && bytes[i + 1] !== 0x00) {
      const marker = bytes[i + 1];
      
      // SOF markers (Start of Frame) contain dimensions
      if (marker >= 0xC0 && marker <= 0xC3) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        return {width, height};
      }
      
      // Skip segment
      const segmentLength = (bytes[i + 2] << 8) | bytes[i + 3];
      i += 2 + segmentLength;
    } else {
      i++;
    }
  }

  return null;
}

/**
 * Extracts dimensions from PNG file
 */
function getPNGDimensions(bytes) {
  // PNG dimensions are at bytes 16-23 (after PNG signature)
  if (bytes.length < 24) return null;
  
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  
  return {width, height};
}

/**
 * Extracts dimensions from GIF file
 */
function getGIFDimensions(bytes) {
  // GIF dimensions are at bytes 6-9 (after GIF signature)
  if (bytes.length < 10) return null;
  
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  
  return {width, height};
}

/**
 * Extracts dimensions from WebP file
 * WebP can be VP8, VP8L, or VP8X format
 */
function getWebPDimensions(bytes) {
  if (bytes.length < 30) return null;
  
  // Check for VP8 format (lossy)
  if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) {
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3FFF;
    const height = ((bytes[28] | (bytes[29] << 8)) & 0x3FFF);
    return {width, height};
  }
  
  // Check for VP8L format (lossless)
  if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x4C) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    const width = (bits & 0x3FFF) + 1;
    const height = ((bits >> 14) & 0x3FFF) + 1;
    return {width, height};
  }
  
  // Check for VP8X format (extended)
  if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return {width, height};
  }
  
  return null;
}

/**
 * Validates an image file comprehensively
 * Checks: file size, MIME type, magic bytes, and dimensions
 * 
 * @param {File} file - File object to validate
 * @returns {Promise<{valid: boolean, error?: string, mimeType?: string, dimensions?: {width: number, height: number}}>}
 */
export async function validateImageFile(file) {
  // Basic file checks
  if (!file || !(file instanceof File)) {
    return {valid: false, error: 'Invalid file object'};
  }

  if (file.size === 0) {
    return {valid: false, error: 'File is empty'};
  }

  if (file.size > MAX_FILE_SIZE) {
    return {valid: false, error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`};
  }

  // Check MIME type
  const mimeType = file.type?.toLowerCase();
  if (!mimeType || !ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    return {valid: false, error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed'};
  }

  // Normalize jpg to jpeg
  const normalizedMimeType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;

  // Read file buffer for magic byte validation
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    return {valid: false, error: 'Failed to read file'};
  }

  // Validate magic bytes (file signature)
  if (!validateFileSignature(buffer, normalizedMimeType)) {
    return {valid: false, error: 'File content does not match declared type. File may be corrupted or malicious'};
  }

  // Validate image dimensions
  const dimensions = await getImageDimensions(buffer, normalizedMimeType);
  if (!dimensions) {
    return {valid: false, error: 'Unable to read image dimensions. File may be corrupted'};
  }

  if (dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION) {
    return {valid: false, error: 'Image dimensions are too small'};
  }

  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    return {valid: false, error: `Image dimensions exceed ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}px limit`};
  }

  // Check for suspicious aspect ratios (potential polyglot files)
  const aspectRatio = dimensions.width / dimensions.height;
  if (aspectRatio > 100 || aspectRatio < 0.01) {
    return {valid: false, error: 'Image has suspicious dimensions'};
  }

  return {
    valid: true,
    mimeType: normalizedMimeType,
    dimensions,
  };
}

/**
 * Gets safe file extension from MIME type
 * 
 * @param {string} mimeType - MIME type
 * @returns {string} - File extension (without dot)
 */
export function getExtensionFromMimeType(mimeType) {
  const mimeToExt = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  
  return mimeToExt[mimeType?.toLowerCase()] || 'jpg';
}

