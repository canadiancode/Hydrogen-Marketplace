import {useFetcher, useNavigate} from 'react-router';
import React, {useRef, useEffect, useCallback} from 'react';
import {useAside} from './Aside';

export const SEARCH_ENDPOINT = '/search';

/**
 * Sanitizes and validates a search term to prevent open redirects and XSS
 * @param {string} term - The search term to sanitize
 * @returns {string} - Sanitized search term safe for URL encoding
 */
function sanitizeSearchTerm(term) {
  if (!term || typeof term !== 'string') return '';
  
  // Trim and limit length
  const MAX_SEARCH_LENGTH = 200;
  let sanitized = term.trim().substring(0, MAX_SEARCH_LENGTH);
  
  // Remove any control characters and dangerous characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F<>"']/g, '');
  
  return sanitized;
}

/**
 *  Search form component that sends search requests to the `/search` route
 * @param {SearchFormPredictiveProps}
 */
export function SearchFormPredictive({
  children,
  className = 'predictive-search-form',
  ...props
}) {
  const fetcher = useFetcher({key: 'search'});
  const inputRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const navigate = useNavigate();
  const aside = useAside();

  /** Reset the input value and blur the input */
  function resetInput(event) {
    event.preventDefault();
    event.stopPropagation();
    if (inputRef?.current?.value) {
      inputRef.current.blur();
    }
  }

  /** Navigate to the search page with the current input value */
  function goToSearch() {
    const term = inputRef?.current?.value;
    
    // Sanitize and validate search term to prevent open redirects
    const sanitized = sanitizeSearchTerm(term);
    
    // Use encodeURIComponent to safely encode the search term
    if (sanitized) {
      const encodedTerm = encodeURIComponent(sanitized);
      void navigate(`${SEARCH_ENDPOINT}?q=${encodedTerm}`);
    } else {
      void navigate(SEARCH_ENDPOINT);
    }
    aside.close();
  }

  /** Fetch search results based on the input value with debouncing */
  const fetchResults = useCallback((event) => {
    const value = event.target.value || '';
    
    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    
    // Sanitize input before sending
    const sanitized = sanitizeSearchTerm(value);
    
    // Debounce: wait 300ms after user stops typing before making request
    // This reduces server load and prevents excessive API calls
    debounceTimerRef.current = setTimeout(() => {
      void fetcher.submit(
        {q: sanitized, limit: 5, predictive: true},
        {method: 'GET', action: SEARCH_ENDPOINT},
      );
    }, 300);
  }, [fetcher]);
  
  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // ensure the passed input has a type of search, because SearchResults
  // will select the element based on the input
  useEffect(() => {
    inputRef?.current?.setAttribute('type', 'search');
  }, []);

  if (typeof children !== 'function') {
    return null;
  }

  return (
    <fetcher.Form {...props} className={className} onSubmit={resetInput}>
      {children({inputRef, fetcher, fetchResults, goToSearch})}
    </fetcher.Form>
  );
}

/**
 * @typedef {(args: {
 *   fetchResults: (event: React.ChangeEvent<HTMLInputElement>) => void;
 *   goToSearch: () => void;
 *   inputRef: React.MutableRefObject<HTMLInputElement | null>;
 *   fetcher: Fetcher<PredictiveSearchReturn>;
 * }) => React.ReactNode} SearchFormPredictiveChildren
 */
/**
 * @typedef {Omit<FormProps, 'children'> & {
 *   children: SearchFormPredictiveChildren | null;
 * }} SearchFormPredictiveProps
 */

/** @typedef {import('react-router').FormProps} FormProps */
/** @template T @typedef {import('react-router').Fetcher<T>} Fetcher */
/** @typedef {import('~/lib/search').PredictiveSearchReturn} PredictiveSearchReturn */
