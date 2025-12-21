import {Await, Link, useMatches, useRouteLoaderData} from 'react-router';
import {Suspense, useId} from 'react';
import {Aside} from '~/components/Aside';
import {Footer} from '~/components/Footer';
import {Header, HeaderMenu} from '~/components/Header';
import {WornVaultHeader} from '~/components/WornVaultHeader';
import {CartDrawerProvider} from '~/components/CartDrawer';
import {
  SEARCH_ENDPOINT,
  SearchFormPredictive,
} from '~/components/SearchFormPredictive';
import {SearchResultsPredictive} from '~/components/SearchResultsPredictive';

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
  
  return (
    <Aside.Provider>
      <CartDrawerProvider cart={cart}>
        <SearchAside />
        <MobileMenuAside header={header} publicStoreDomain={publicStoreDomain} />
        {!hideHeaderFooter && (
          <Suspense fallback={<div className="h-16" />}>
            <Await resolve={isLoggedIn} errorElement={<WornVaultHeader isLoggedIn={false} isCreator={false} cart={cart} />}>
              {(loggedIn) => (
                <Await resolve={isCreator} errorElement={<WornVaultHeader isLoggedIn={loggedIn} isCreator={false} cart={cart} />}>
                  {(creator) => (
                    <WornVaultHeader 
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
        <main className="pb-32 sm:pb-12">{children}</main>
        {!hideHeaderFooter && (
          <Footer
            footer={footer}
            header={header}
            publicStoreDomain={publicStoreDomain}
          />
        )}
      </CartDrawerProvider>
    </Aside.Provider>
  );
}


function SearchAside() {
  const queriesDatalistId = useId();
  return (
    <Aside type="search" heading="SEARCH">
      <div className="predictive-search">
        <br />
        <SearchFormPredictive>
          {({fetchResults, goToSearch, inputRef}) => (
            <>
              <input
                name="q"
                onChange={fetchResults}
                onFocus={fetchResults}
                placeholder="Search"
                ref={inputRef}
                type="search"
                list={queriesDatalistId}
              />
              &nbsp;
              <button onClick={goToSearch}>Search</button>
            </>
          )}
        </SearchFormPredictive>

        <SearchResultsPredictive>
          {({items, total, term, state, closeSearch}) => {
            const {articles, collections, pages, products, queries} = items;

            if (state === 'loading' && term.current) {
              return <div>Loading...</div>;
            }

            if (!total) {
              return <SearchResultsPredictive.Empty term={term} />;
            }

            return (
              <>
                <SearchResultsPredictive.Queries
                  queries={queries}
                  queriesDatalistId={queriesDatalistId}
                />
                <SearchResultsPredictive.Products
                  products={products}
                  closeSearch={closeSearch}
                  term={term}
                />
                <SearchResultsPredictive.Collections
                  collections={collections}
                  closeSearch={closeSearch}
                  term={term}
                />
                <SearchResultsPredictive.Pages
                  pages={pages}
                  closeSearch={closeSearch}
                  term={term}
                />
                <SearchResultsPredictive.Articles
                  articles={articles}
                  closeSearch={closeSearch}
                  term={term}
                />
                {term.current && total ? (
                  <Link
                    onClick={closeSearch}
                    to={`${SEARCH_ENDPOINT}?q=${term.current}`}
                  >
                    <p>
                      View all results for <q>{term.current}</q>
                      &nbsp; →
                    </p>
                  </Link>
                ) : null}
              </>
            );
          }}
        </SearchResultsPredictive>
      </div>
    </Aside>
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
