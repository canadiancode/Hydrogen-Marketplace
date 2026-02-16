import {Await, Link, useMatches, useRouteLoaderData} from 'react-router';
import {Suspense, useRef} from 'react';
import {Aside} from '~/components/Aside';
import {Footer} from '~/components/Footer';
import {Header, HeaderMenu} from '~/components/Header';
import {WornVaultHeader} from '~/components/WornVaultHeader';
import {CartDrawerProvider} from '~/components/CartDrawer';
import {SearchModalProvider} from '~/components/SearchModal';

/**
 * Check if current route should hide header/footer based on route handles
 * This is more maintainable than pathname string matching
 */
function shouldHideHeaderFooter() {
  const matches = useMatches();
  
  // Check if any route in the tree has hideHeaderFooter: true
  // But allow explicit override (hideHeaderFooter: false) to show footer
  let shouldHide = false;
  
  for (const match of matches) {
    const handle = match.handle;
    if (handle?.hideHeaderFooter === true) {
      shouldHide = true;
    }
    // Explicit override to show footer (e.g., login page)
    if (handle?.hideHeaderFooter === false) {
      shouldHide = false;
      break;
    }
  }
  
  return shouldHide;
}

/**
 * @param {PageLayoutProps}
 */
export function PageLayout({
  cart,
  children = null,
  footer,
  header,
  isLoggedIn,
  isAdmin,
  isCreator,
  publicStoreDomain,
}) {
  const hideHeaderFooter = shouldHideHeaderFooter();
  const rootData = useRouteLoaderData('root');
  const mainRef = useRef(/** @type {HTMLElement | null} */ (null));

  return (
    <Aside.Provider>
      <SearchModalProvider>
        <CartDrawerProvider cart={cart}>
          <MobileMenuAside header={header} publicStoreDomain={publicStoreDomain} />
          {!hideHeaderFooter && (
            <Suspense fallback={<div className="h-16" />}>
              <Await resolve={isLoggedIn} errorElement={<WornVaultHeader mainRef={mainRef} isLoggedIn={false} isCreator={false} cart={cart} />}>
                {(loggedIn) => (
                  <Await resolve={isCreator} errorElement={<WornVaultHeader mainRef={mainRef} isLoggedIn={loggedIn} isCreator={false} cart={cart} />}>
                    {(creator) => (
                      <WornVaultHeader 
                        mainRef={mainRef}
                        isLoggedIn={loggedIn} 
                        isCreator={creator} 
                        cart={cart}
                      />
                    )}
                  </Await>
                )}
              </Await>
            </Suspense>
          )}
          <main ref={mainRef} className="pb-32 sm:pb-12 bg-white dark:bg-gray-900">{children}</main>
          {!hideHeaderFooter && (
            <Footer
              footer={footer}
              header={header}
              publicStoreDomain={publicStoreDomain}
            />
          )}
        </CartDrawerProvider>
      </SearchModalProvider>
    </Aside.Provider>
  );
}

/**
 * @param {{
 *   header: PageLayoutProps['header'];
 *   publicStoreDomain: PageLayoutProps['publicStoreDomain'];
 * }}
 */
function MobileMenuAside({header, publicStoreDomain}) {
  return (
    header.menu &&
    header.shop.primaryDomain?.url && (
      <Aside type="mobile" heading="MENU">
        <HeaderMenu
          menu={header.menu}
          viewport="mobile"
          primaryDomainUrl={header.shop.primaryDomain.url}
          publicStoreDomain={publicStoreDomain}
        />
      </Aside>
    )
  );
}

/**
 * @typedef {Object} PageLayoutProps
 * @property {Promise<CartApiQueryFragment|null>} cart
 * @property {Promise<FooterQuery|null>} footer
 * @property {HeaderQuery} header
 * @property {Promise<boolean>} isLoggedIn
 * @property {Promise<boolean>} isAdmin
 * @property {string} publicStoreDomain
 * @property {React.ReactNode} [children]
 */

/** @typedef {import('storefrontapi.generated').CartApiQueryFragment} CartApiQueryFragment */
/** @typedef {import('storefrontapi.generated').FooterQuery} FooterQuery */
/** @typedef {import('storefrontapi.generated').HeaderQuery} HeaderQuery */
