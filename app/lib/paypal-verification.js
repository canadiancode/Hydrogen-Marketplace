/**
 * PayPal Email Verification Utility
 * Verifies if an email address is associated with a valid PayPal account
 * 
 * Uses PayPal's AddressVerify API (NVP/SOAP) to check if an email exists
 * in PayPal's system. This is a non-blocking verification that doesn't
 * prevent form submission but marks the email as verified/unverified.
 */

/**
 * Verifies PayPal email using PayPal AddressVerify API (NVP/SOAP)
 * 
 * Note: This API requires PayPal API credentials (Client ID, Secret, and Signature)
 * The AddressVerify API can verify if an email exists even with dummy address data
 * 
 * @param {string} email - Email address to verify
 * @param {string} clientId - PayPal Client ID (or API Username)
 * @param {string} clientSecret - PayPal Client Secret (or API Password)
 * @param {string} apiSignature - PayPal API Signature (required for 3-token auth)
 * @param {boolean} isSandbox - Whether to use sandbox environment
 * @returns {Promise<{valid: boolean, verified: boolean, payerId?: string, error?: string}>}
 */
export async function verifyPayPalEmail(email, clientId, clientSecret, apiSignature, isSandbox = false) {
  if (!email || !clientId || !clientSecret) {
    return {
      valid: false,
      verified: false,
      error: 'Missing required PayPal credentials',
    };
  }

  // Basic email format validation first
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      valid: false,
      verified: false,
      error: 'Invalid email format',
    };
  }

  // Check if we have API Signature (required for AddressVerify API)
  // If not, we can't use AddressVerify API - return unverified but valid
  if (!apiSignature || apiSignature.trim() === '') {
    console.warn('PayPal API Signature not provided. AddressVerify API requires API credentials (USER/PWD/SIGNATURE), not OAuth credentials. Email verification skipped.');
    return {
      valid: true,
      verified: false,
      error: 'API Signature required for verification. Please configure PAYPAL_API_SIGNATURE or use API credentials instead of OAuth credentials.',
    };
  }

  try {
    // PayPal AddressVerify API endpoint (requires API credentials, not OAuth)
    const verifyUrl = isSandbox
      ? 'https://api-3t.sandbox.paypal.com/nvp'
      : 'https://api-3t.paypal.com/nvp';

    // AddressVerify requires email + address, but we can use dummy address
    // The API will still tell us if the email exists in PayPal's system
    // Error code 10736 specifically means "Email address not registered"
    const verifyParams = new URLSearchParams({
      METHOD: 'AddressVerify',
      VERSION: '204.0',
      USER: clientId, // PayPal API Username (NOT OAuth Client ID)
      PWD: clientSecret, // PayPal API Password (NOT OAuth Client Secret)
      SIGNATURE: apiSignature, // PayPal API Signature (REQUIRED)
      EMAIL: email.toLowerCase().trim(),
      STREET: '123 Test St', // Dummy address - API will still verify email existence
      ZIP: '12345', // Dummy ZIP - API will still verify email existence
    });

    const verifyResponse = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: verifyParams.toString(),
    });

    if (!verifyResponse.ok) {
      throw new Error(`PayPal API request failed: ${verifyResponse.status}`);
    }

    const responseText = await verifyResponse.text();
    const responseParams = new URLSearchParams(responseText);
    
    const ack = responseParams.get('ACK');
    const payerId = responseParams.get('PAYERID');
    const errorCode = responseParams.get('L_ERRORCODE0');
    const errorMessage = responseParams.get('L_SHORTMESSAGE0');

    // Success or SuccessWithWarning means email exists
    if (ack === 'Success' || ack === 'SuccessWithWarning') {
      return {
        valid: true,
        verified: true,
        payerId: payerId || null,
      };
    } 
    
    // Failure with error code 10736 means email not found
    if (ack === 'Failure' && errorCode === '10736') {
      return {
        valid: false,
        verified: false,
        error: 'Email not associated with a PayPal account',
      };
    }
    
    // Other failures
    if (ack === 'Failure') {
      // Log the error for debugging but don't expose to user
      console.error('PayPal verification failed:', {
        errorCode,
        errorMessage,
        email: email.substring(0, 3) + '***', // Partial email for logging
      });
      
      return {
        valid: false,
        verified: false,
        error: 'PayPal verification failed. Please try again later.',
      };
    }

    // Unknown response
    return {
      valid: false,
      verified: false,
      error: 'Unknown verification response',
    };
  } catch (error) {
    // Log error but don't expose details to user
    console.error('PayPal verification error:', {
      error: error.message || 'Unknown error',
      errorName: error.name || 'Error',
      // Don't log email or credentials
    });
    
    return {
      valid: false,
      verified: false,
      error: 'PayPal verification service unavailable. Please try again later.',
    };
  }
}

/**
 * Alternative: Verify using PayPal REST API (if you prefer REST over NVP)
 * Note: This requires OAuth token and may have different requirements
 * 
 * @param {string} email - Email address to verify
 * @param {string} accessToken - PayPal OAuth access token
 * @param {boolean} isSandbox - Whether to use sandbox environment
 * @returns {Promise<{valid: boolean, verified: boolean, error?: string}>}
 */
export async function verifyPayPalEmailViaREST(email, accessToken, isSandbox = false) {
  if (!email || !accessToken) {
    return {
      valid: false,
      verified: false,
      error: 'Missing required parameters',
    };
  }

  const baseUrl = isSandbox 
    ? 'https://api.sandbox.paypal.com'
    : 'https://api.paypal.com';

  try {
    // Get user info from PayPal
    const response = await fetch(`${baseUrl}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const userInfo = await response.json();
      // Check if email matches (case-insensitive)
      const verified = userInfo.email?.toLowerCase() === email.toLowerCase();
      
      return {
        valid: true,
        verified,
        payerId: userInfo.payer_id || null,
      };
    }

    return {
      valid: false,
      verified: false,
      error: 'Failed to verify PayPal account',
    };
  } catch (error) {
    console.error('PayPal REST verification error:', error);
    return {
      valid: false,
      verified: false,
      error: error.message || 'Verification service unavailable',
    };
  }
}

