import {useEffect, useState} from 'react';
import {useSearchParams, Link} from 'react-router';

/**
 * Welcome Modal Component
 * Shows a thank you message for first-time signups
 * Can be dismissed by clicking outside or the X button
 */
export function WelcomeModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  
  useEffect(() => {
    // Check if this is a first-time signup from query params
    const firstTime = searchParams.get('firstTime') === 'true';
    
    // Check localStorage to see if we've already shown the welcome modal
    const welcomeShown = localStorage.getItem('wornvault_welcome_shown');
    
    if (firstTime && !welcomeShown) {
      setIsOpen(true);
      // Mark as shown in localStorage
      localStorage.setItem('wornvault_welcome_shown', 'true');
      
      // Remove query parameter from URL without page reload
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('firstTime');
      setSearchParams(newSearchParams, {replace: true});
    }
  }, [searchParams, setSearchParams]);
  
  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen]);
  
  const handleClose = () => {
    setIsOpen(false);
  };
  
  const handleBackdropClick = (e) => {
    // Close if clicking the backdrop (not the modal content)
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };
  
  if (!isOpen) {
    return null;
  }
  
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
    >
      <div className="relative mx-4 w-full max-w-md rounded-lg bg-white dark:bg-gray-800 shadow-xl">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label="Close modal"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
        
        {/* Modal content */}
        <div className="p-6 sm:p-8">
          <div className="text-center">
            {/* Icon */}
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
              <svg
                className="h-8 w-8 text-indigo-600 dark:text-indigo-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            
            {/* Title */}
            <h2
              id="welcome-modal-title"
              className="mt-4 text-2xl font-bold text-gray-900 dark:text-white"
            >
              Thank You for Signing Up!
            </h2>
            
            {/* Message */}
            <p className="mt-3 text-base text-gray-600 dark:text-gray-300">
              Welcome to WornVault! We're excited to have you join our creator community.
              Your account has been created and you're all set to start listing your items.
            </p>
            
            {/* CTA */}
            <div className="mt-6">
              <Link
                to="/creator/settings"
                onClick={handleClose}
                className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
              >
                Complete Account Settings
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
