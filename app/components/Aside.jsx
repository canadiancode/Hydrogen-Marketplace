import {createContext, useContext, useEffect, useRef, useState} from 'react';

/**
 * A side bar component with Overlay
 * @example
 * ```jsx
 * <Aside type="search" heading="SEARCH">
 *  <input type="search" />
 *  ...
 * </Aside>
 * ```
 * @param {{
 *   children?: React.ReactNode;
 *   type: AsideType;
 *   heading: React.ReactNode;
 * }}
 */
export function Aside({children, heading, type}) {
  const {type: activeType, close} = useAside();
  const expanded = type === activeType;
  const overlayRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const asideRef = useRef(/** @type {HTMLElement | null} */ (null));

  useEffect(() => {
    const abortController = new AbortController();

    if (expanded) {
      // Handle Escape key
      document.addEventListener(
        'keydown',
        function handler(event) {
          if (event.key === 'Escape') {
            close();
          }
        },
        {signal: abortController.signal},
      );

      // Handle click outside the aside element
      // Using document-level listener for reliable click-outside detection
      const handleClickOutside = (event) => {
        const target = /** @type {Node} */ (event.target);
        
        // Close if clicking outside both the overlay and aside elements
        // This handles clicks anywhere on the page when menu is open
        if (
          overlayRef.current &&
          asideRef.current &&
          !overlayRef.current.contains(target) &&
          !asideRef.current.contains(target)
        ) {
          close();
          return;
        }

        // Also close if clicking directly on the overlay background (but not the aside)
        if (
          overlayRef.current &&
          asideRef.current &&
          overlayRef.current.contains(target) &&
          !asideRef.current.contains(target)
        ) {
          close();
        }
      };

      // Use capture phase to catch events before they bubble
      // Small delay to avoid immediate closure when opening
      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleClickOutside, {
          signal: abortController.signal,
          capture: true,
        });
      }, 0);

      return () => {
        clearTimeout(timeoutId);
        abortController.abort();
      };
    }
    return () => abortController.abort();
  }, [close, expanded]);

  return (
    <div
      ref={overlayRef}
      aria-modal
      className={`overlay ${expanded ? 'expanded' : ''}`}
      role="dialog"
    >
      <button className="close-outside" onClick={close} />
      <aside ref={asideRef}>
        <header>
          <h3>{heading}</h3>
          <button className="close reset" onClick={close} aria-label="Close">
            &times;
          </button>
        </header>
        <main>{children}</main>
      </aside>
    </div>
  );
}

export const AsideContext = createContext(null);

Aside.Provider = function AsideProvider({children}) {
  const [type, setType] = useState('closed');

  return (
    <AsideContext.Provider
      value={{
        type,
        open: setType,
        close: () => setType('closed'),
      }}
    >
      {children}
    </AsideContext.Provider>
  );
};

export function useAside() {
  const aside = useContext(AsideContext);
  if (!aside) {
    throw new Error('useAside must be used within an AsideProvider');
  }
  return aside;
}

/** @typedef {'search' | 'cart' | 'mobile' | 'closed'} AsideType */
/**
 * @typedef {{
 *   type: AsideType;
 *   open: (mode: AsideType) => void;
 *   close: () => void;
 * }} AsideContextValue
 */

/** @typedef {import('react').ReactNode} ReactNode */
