/**
 * HTML Entity Decoding Utility
 * 
 * Decodes HTML entities in strings for safe display.
 * Since React automatically escapes HTML when rendering text content,
 * we need to decode entities that were previously encoded.
 * 
 * This is safe because React will re-escape any HTML when rendering as text.
 */

/**
 * Decodes HTML entities in a string
 * Works both client-side and server-side
 * 
 * @param {string} str - String containing HTML entities
 * @returns {string} - Decoded string
 */
export function decodeHTMLEntities(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  // Use browser's built-in decoder if available (client-side)
  if (typeof window !== 'undefined' && window.document) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = str;
    return textarea.value;
  }

  // Server-side fallback: decode common HTML entities
  // This covers the entities we're seeing: &#x27; (apostrophe) and &#x2F; (slash)
  return str
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x2f;/gi, '/'); // Case-insensitive variant
}

