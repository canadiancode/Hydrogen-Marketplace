/**
 * JSON-LD Structured Data Validation Utility
 * 
 * Provides secure JSON-LD validation and stringification to prevent XSS attacks
 * when using dangerouslySetInnerHTML with structured data.
 */

/**
 * Validates and safely stringifies JSON-LD structured data
 * Prevents XSS attacks through comprehensive script injection detection
 * 
 * @param {object} data - Structured data object to validate
 * @returns {string|null} - Validated JSON string or null if validation fails
 */
export function validateAndEscapeJSONLD(data) {
  try {
    // Validate it's actually valid JSON by stringifying
    const jsonString = JSON.stringify(data);
    
    // Comprehensive script injection detection
    // Check for various encoding and obfuscation attempts
    const dangerousPatterns = [
      /<\/script>/gi,                    // Closing script tag
      /<script/gi,                       // Opening script tag
      /javascript:/gi,                   // JavaScript protocol
      /on\w+\s*=/gi,                     // Event handlers (onclick, onerror, etc.)
      /&#x?[0-9a-f]+;/gi,                // HTML entities that could hide scripts
      /&#\d+;/gi,                        // Numeric HTML entities
      /\\x[0-9a-f]{2}/gi,                // Hex escape sequences
      /\\u[0-9a-f]{4}/gi,                // Unicode escape sequences
      /data:text\/html/gi,               // Data URLs with HTML
      /vbscript:/gi,                     // VBScript protocol
      /expression\s*\(/gi,               // CSS expressions (IE)
      /@import/gi,                       // CSS imports that could load scripts
    ];
    
    // Check for dangerous patterns
    for (const pattern of dangerousPatterns) {
      if (pattern.test(jsonString)) {
        console.error('JSON-LD validation failed: dangerous pattern detected', {
          pattern: pattern.toString(),
        });
        return null;
      }
    }
    
    // Validate schema.org structure
    if (data['@context'] !== 'https://schema.org') {
      console.error('JSON-LD validation failed: invalid schema.org context');
      return null;
    }
    
    // Additional validation: ensure no nested objects contain script-like content
    // This is a recursive check for deeply nested malicious content
    const checkNestedValues = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          // Check string values for script-like content
          const value = obj[key].toLowerCase();
          if (
            value.includes('<script') ||
            value.includes('javascript:') ||
            value.includes('onerror') ||
            value.includes('onclick')
          ) {
            return false;
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          // Recursively check nested objects
          if (!checkNestedValues(obj[key])) {
            return false;
          }
        }
      }
      return true;
    };
    
    if (!checkNestedValues(data)) {
      console.error('JSON-LD validation failed: nested malicious content detected');
      return null;
    }
    
    // All checks passed - return safe JSON string
    return jsonString;
  } catch (error) {
    // If stringification fails, log error and return null
    console.error('JSON-LD validation failed: stringification error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

