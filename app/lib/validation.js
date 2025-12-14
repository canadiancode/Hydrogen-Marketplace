/**
 * Input Validation Utilities
 * 
 * Provides validation and sanitization functions for user input
 */

/**
 * Validates email format and length
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if valid
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false; // RFC 5321 limit
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.toLowerCase().trim());
}

/**
 * Sanitizes a string input
 * @param {string} input - Input string
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} - Sanitized string
 */
export function sanitizeString(input, maxLength = 1000) {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, maxLength);
}

/**
 * Validates and sanitizes email
 * @param {string} email - Email to validate and sanitize
 * @returns {{valid: boolean, sanitized: string}} - Validation result
 */
export function validateAndSanitizeEmail(email) {
  const sanitized = sanitizeString(email, 254).toLowerCase().trim();
  const valid = validateEmail(sanitized);
  return {valid, sanitized: valid ? sanitized : ''};
}

/**
 * Validates handle/username format (alphanumeric, underscore, dash)
 * @param {string} handle - Handle to validate
 * @param {number} minLength - Minimum length
 * @param {number} maxLength - Maximum length
 * @returns {boolean} - True if valid
 */
export function validateHandle(handle, minLength = 3, maxLength = 50) {
  if (!handle || typeof handle !== 'string') return false;
  const trimmed = handle.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) return false;
  const handleRegex = /^[a-zA-Z0-9_-]+$/;
  return handleRegex.test(trimmed);
}

/**
 * Sanitizes handle/username
 * @param {string} handle - Handle to sanitize
 * @returns {string} - Sanitized handle
 */
export function sanitizeHandle(handle) {
  if (typeof handle !== 'string') return '';
  return handle.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);
}

/**
 * Validates password strength
 * @param {string} password - Password to validate
 * @param {number} minLength - Minimum length
 * @returns {{valid: boolean, errors: string[]}} - Validation result
 */
export function validatePassword(password, minLength = 8) {
  const errors = [];
  
  if (!password || typeof password !== 'string') {
    errors.push('Password is required');
    return {valid: false, errors};
  }
  
  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters`);
  }
  
  if (password.length > 128) {
    errors.push('Password is too long');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
