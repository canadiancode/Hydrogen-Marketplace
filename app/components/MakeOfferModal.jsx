import {useState, useEffect, startTransition} from 'react';
import {Form} from 'react-router';
import {useFetcher} from 'react-router';
import {Dialog, DialogBackdrop, DialogPanel, DialogTitle} from '@headlessui/react';
import {XMarkIcon} from '@heroicons/react/24/outline';

// SECURITY: Input validation constants
const MAX_EMAIL_LENGTH = 320; // RFC 5321 maximum email length
const MAX_PRICE_LENGTH = 15; // Prevents extremely large numbers (e.g., 999999999999.99)
const MAX_PRICE_VALUE = 999999999.99; // Maximum reasonable price ($999M)
const MIN_OFFER = 100; // $100 minimum

/**
 * SECURITY: Enhanced email validation
 * Validates email format and length according to RFC 5321
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  // Check length (RFC 5321: max 320 characters total)
  if (email.length > MAX_EMAIL_LENGTH) return false;
  
  // Basic format check (more restrictive than before)
  // Prevents multiple @ signs, leading/trailing dots, etc.
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!emailRegex.test(email)) return false;
  
  // Additional checks
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  
  const [localPart, domain] = parts;
  
  // Local part: max 64 chars, cannot start/end with dot
  if (localPart.length > 64 || localPart.startsWith('.') || localPart.endsWith('.')) {
    return false;
  }
  
  // Domain: max 255 chars, must have at least one dot
  if (domain.length > 255 || !domain.includes('.')) {
    return false;
  }
  
  return true;
}

/**
 * SECURITY: Safe price parsing and validation
 * Prevents Infinity, -Infinity, scientific notation abuse, and overflow
 */
function parseSafePrice(value) {
  if (!value || typeof value !== 'string') return null;
  
  // Remove whitespace
  const trimmed = value.trim();
  if (!trimmed) return null;
  
  // Reject scientific notation (e.g., "1e10") - only allow standard decimal format
  if (/[eE]/.test(trimmed)) return null;
  
  // Parse as float
  const parsed = parseFloat(trimmed);
  
  // Check for invalid values
  if (isNaN(parsed) || !isFinite(parsed)) return null;
  
  // Check for negative values
  if (parsed < 0) return null;
  
  // Check maximum value to prevent overflow
  if (parsed > MAX_PRICE_VALUE) return null;
  
  // Check decimal places (max 2)
  const decimalPlaces = trimmed.includes('.') ? trimmed.split('.')[1].length : 0;
  if (decimalPlaces > 2) return null;
  
  return parsed;
}

/**
 * Make Offer Modal Component
 * Secure modal for customers to submit offers on listings
 * 
 * SECURITY FEATURES:
 * - Client-side validation (UX)
 * - Server-side validation (security)
 * - Input sanitization and length limits
 * - Rate limiting (via API route)
 * - XSS prevention (React auto-escapes)
 * - Safe number parsing (prevents Infinity, overflow)
 */
export function MakeOfferModal({listing, variantIdGid, shopifyVariant, open, onClose}) {
  const fetcher = useFetcher();
  const [email, setEmail] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const originalPrice = listing?.priceDollars || (listing?.price_cents ? listing.price_cents / 100 : 0);
  const minOffer = MIN_OFFER;
  const maxOffer = originalPrice;
  
  // Calculate discount percentage (with safe parsing)
  const parsedOffer = parseSafePrice(offerAmount);
  const discountPercent = parsedOffer && originalPrice && parsedOffer >= minOffer
    ? (((originalPrice - parsedOffer) / originalPrice) * 100).toFixed(1)
    : 0;

  // Reset form when modal closes or submission succeeds
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setSubmitted(true);
    } else if (fetcher.data?.error) {
      setErrors({submit: fetcher.data.error});
    }
  }, [fetcher.data, fetcher.state]);

  // SECURITY: Enhanced client-side validation (UX only - server validates too)
  const validateForm = () => {
    const newErrors = {};

    // Email validation
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      newErrors.email = 'Email is required';
    } else if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
      newErrors.email = `Email must be ${MAX_EMAIL_LENGTH} characters or less`;
    } else if (!isValidEmail(trimmedEmail)) {
      newErrors.email = 'Please enter a valid email address';
    }

    // Offer amount validation
    if (!offerAmount || offerAmount.trim() === '') {
      newErrors.offerAmount = 'Please enter an offer amount';
    } else {
      const parsed = parseSafePrice(offerAmount);
      if (parsed === null) {
        newErrors.offerAmount = 'Please enter a valid offer amount';
      } else if (parsed < minOffer) {
        newErrors.offerAmount = `Offer must be at least $${minOffer}`;
      } else if (parsed > maxOffer) {
        newErrors.offerAmount = 'Offer cannot exceed original price';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    // Clear previous errors
    setErrors({});

    // SECURITY: Sanitize inputs before submission
    const sanitizedEmail = email.trim().toLowerCase().substring(0, MAX_EMAIL_LENGTH);
    const sanitizedOffer = parseSafePrice(offerAmount);
    
    if (sanitizedOffer === null) {
      setErrors({offerAmount: 'Invalid offer amount'});
      return;
    }

    // Submit via fetcher (React Router handles CSRF protection)
    const formData = new FormData();
    formData.append('listingId', listing.id);
    formData.append('productId', listing.shopify_product_id || '');
    formData.append('variantId', variantIdGid || '');
    formData.append('email', sanitizedEmail);
    formData.append('offerAmount', sanitizedOffer.toFixed(2)); // Ensure 2 decimal places

    fetcher.submit(formData, {
      method: 'POST',
      action: '/api/offers/submit',
    });
  };

  const handleClose = () => {
    startTransition(() => {
      setSubmitted(false);
      setEmail('');
      setOfferAmount('');
      setErrors({});
      onClose();
    });
  };

  return (
    <Dialog open={open} onClose={handleClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-gray-500/75 dark:bg-gray-900/75 transition-opacity duration-500 ease-in-out data-closed:opacity-0"
      />

      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">
            <DialogPanel
              transition
              className="pointer-events-auto w-screen max-w-md transform transition duration-500 ease-in-out data-closed:translate-x-full sm:duration-700"
            >
              <div className="flex h-full flex-col overflow-y-auto bg-white dark:bg-gray-900 shadow-xl">
                <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                  <div className="flex items-start justify-between">
                    <DialogTitle className="text-lg font-medium text-gray-900 dark:text-white">
                      Make an Offer
                    </DialogTitle>
                    <div className="ml-3 flex h-7 items-center">
                      <button
                        type="button"
                        onClick={handleClose}
                        className="relative -m-2 p-2 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
                      >
                        <span className="absolute -inset-0.5" />
                        <span className="sr-only">Close panel</span>
                        <XMarkIcon aria-hidden="true" className="size-6" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-8">
                    {submitted ? (
                      <div className="text-center">
                        <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
                          <svg className="h-6 w-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                          Offer Submitted!
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                          Thanks for submitting your offer. The offer will last for 30 days. After 30 days, if the offer is left pending, it will close.
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                          If accepted in 30 days or less, the link to purchase the product at the discounted price of <strong>${offerAmount}</strong> will get sent to <strong>{email}</strong>. The link to purchase the product at the price of <strong>${offerAmount} will only last 7 days</strong>.
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                          After 7 days, the link and discount will expire and the product will go back up on sale for the original price
                        </p>
                        <button
                          onClick={handleClose}
                          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 transition-colors"
                        >
                          Close
                        </button>
                      </div>
                    ) : (
                      <Form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                          <label htmlFor="offer-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Email
                          </label>
                          <input
                            type="email"
                            id="offer-email"
                            name="email"
                            value={email}
                            onChange={(e) => {
                              const value = e.target.value;
                              // SECURITY: Enforce max length on input
                              if (value.length <= MAX_EMAIL_LENGTH) {
                                setEmail(value);
                                // Clear error when user types
                                if (errors.email) {
                                  setErrors({...errors, email: null});
                                }
                              }
                            }}
                            required
                            autoComplete="email"
                            maxLength={MAX_EMAIL_LENGTH}
                            className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            placeholder="your@email.com"
                          />
                          {errors.email && (
                            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.email}</p>
                          )}
                        </div>

                        <div>
                          <label htmlFor="offer-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Offer Amount (USD)
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-2 text-gray-500">$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              id="offer-amount"
                              name="offerAmount"
                              value={offerAmount}
                              onChange={(e) => {
                                const value = e.target.value;
                                // SECURITY: Only allow valid price format (numbers and one decimal point)
                                // This prevents scientific notation, multiple decimals, etc.
                                const priceRegex = /^\d*\.?\d{0,2}$/;
                                
                                if (value === '' || priceRegex.test(value)) {
                                  // Enforce max length
                                  if (value.length <= MAX_PRICE_LENGTH) {
                                    setOfferAmount(value);
                                    // Clear error when user types
                                    if (errors.offerAmount) {
                                      setErrors({...errors, offerAmount: null});
                                    }
                                  }
                                }
                              }}
                              min={minOffer}
                              max={maxOffer}
                              required
                              maxLength={MAX_PRICE_LENGTH}
                              className="w-full pl-7 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder={minOffer.toString()}
                            />
                          </div>
                          {errors.offerAmount && (
                            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.offerAmount}</p>
                          )}
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Minimum offer: ${minOffer}. Original price: ${originalPrice.toFixed(2)}
                          </p>
                        </div>

                        {parsedOffer && parsedOffer >= minOffer && parsedOffer <= maxOffer && (
                          <div className="rounded-md bg-gray-50 dark:bg-gray-800 p-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              <span className="font-medium">Discount from retail:</span> {discountPercent}%
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                              Your offer of ${parsedOffer.toFixed(2)} saves you ${(originalPrice - parsedOffer).toFixed(2)}
                            </p>
                          </div>
                        )}

                        {errors.submit && (
                          <div className="rounded-md bg-red-50 dark:bg-red-900/30 p-4">
                            <p className="text-sm text-red-600 dark:text-red-400">{errors.submit}</p>
                          </div>
                        )}

                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={handleClose}
                            className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={fetcher.state === 'submitting'}
                            className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {fetcher.state === 'submitting' ? 'Submitting...' : 'Submit Offer'}
                          </button>
                        </div>
                      </Form>
                    )}
                  </div>
                </div>
              </div>
            </DialogPanel>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
