/**
 * HTML Sanitization Utility
 * 
 * Uses DOMPurify to sanitize HTML content and prevent XSS attacks.
 * 
 * Note: Install isomorphic-dompurify before using:
 * npm install isomorphic-dompurify
 */

let DOMPurify;

/**
 * Lazy load DOMPurify to handle SSR gracefully
 */
function getDOMPurify() {
  if (typeof window === 'undefined') {
    // Server-side: use isomorphic-dompurify
    try {
      // eslint-disable-next-line import/no-unresolved
      DOMPurify = require('isomorphic-dompurify');
      return DOMPurify;
    } catch (e) {
      // If DOMPurify is not installed, return a no-op sanitizer
      console.warn('DOMPurify not installed. HTML will not be sanitized. Run: npm install isomorphic-dompurify');
      return null;
    }
  } else {
    // Client-side: use regular DOMPurify if available
    if (!DOMPurify) {
      try {
        // eslint-disable-next-line import/no-unresolved
        DOMPurify = require('isomorphic-dompurify');
      } catch (e) {
        console.warn('DOMPurify not available. HTML will not be sanitized.');
        return null;
      }
    }
    return DOMPurify;
  }
}

/**
 * Sanitizes HTML content to prevent XSS attacks
 * @param {string} html - HTML string to sanitize
 * @returns {string} - Sanitized HTML string
 */
export function sanitizeHTML(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const purify = getDOMPurify();
  
  if (!purify) {
    // Fallback: basic HTML entity encoding if DOMPurify not available
    // This is not as secure but better than nothing
    return html
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  // Configure DOMPurify with safe defaults
  return purify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'div', 'span', 'table', 'thead',
      'tbody', 'tr', 'td', 'th', 'hr', 'pre', 'code',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'alt', 'src', 'width', 'height', 'class', 'id',
      'target', 'rel', 'style', 'colspan', 'rowspan',
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    KEEP_CONTENT: true,
  });
}
