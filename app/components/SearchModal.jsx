import {useState, createContext, useContext, useEffect} from 'react';
import {Dialog, DialogBackdrop, DialogPanel, DialogTitle} from '@headlessui/react';
import {XMarkIcon} from '@heroicons/react/24/outline';
import {Link} from 'react-router';
import {startTransition} from 'react';
import {
  SEARCH_ENDPOINT,
  SearchFormPredictive,
} from '~/components/SearchFormPredictive';
import {SearchResultsPredictive} from '~/components/SearchResultsPredictive';
import {useId} from 'react';

export const SearchModalContext = createContext(null);

/**
 * Provider component that manages search modal state
 * @param {{children: React.ReactNode}}
 */
export function SearchModalProvider({children}) {
  const [open, setOpen] = useState(false);

  // Handle Cmd+K (Mac) or Ctrl+K (Windows/Linux) to open search modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <SearchModalContext.Provider value={{open, setOpen}}>
      {children}
      <SearchModalContent />
    </SearchModalContext.Provider>
  );
}

/**
 * Hook to access search modal context
 */
export function useSearchModal() {
  const context = useContext(SearchModalContext);
  if (!context) {
    throw new Error('useSearchModal must be used within SearchModalProvider');
  }
  return context;
}

/**
 * The actual modal content component
 */
function SearchModalContent() {
  const {open, setOpen} = useSearchModal();
  const queriesDatalistId = useId();

  const handleClose = () => {
    startTransition(() => {
      setOpen(false);
    });
  };

  // Handle Escape key to close modal
  useEffect(() => {
    if (!open) return;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  return (
    <Dialog open={open} onClose={handleClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-gray-500/75 transition-opacity data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in dark:bg-gray-900/50"
      />

      <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
        <div className="flex items-start justify-center p-4 text-center sm:items-center sm:p-4">
          <DialogPanel
            transition
            className="relative transform overflow-hidden rounded-lg bg-white px-4 pt-5 pb-4 text-left shadow-xl transition-all data-closed:translate-y-4 data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col sm:p-6 data-closed:sm:translate-y-0 data-closed:sm:scale-95 dark:bg-gray-800 dark:outline dark:-outline-offset-1 dark:outline-white/10"
          >
            <div className="absolute top-0 right-0 hidden pt-4 pr-4 sm:block">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:bg-gray-800 dark:hover:text-gray-300 dark:focus:outline-white"
              >
                <span className="sr-only">Close</span>
                <XMarkIcon aria-hidden="true" className="size-6" />
              </button>
            </div>

            <div className="sm:flex sm:items-start flex-1 min-h-0 overflow-hidden">
              <div className="w-full flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-4">
                  <DialogTitle as="h3" className="text-lg font-semibold text-gray-900 dark:text-white">
                    Search
                  </DialogTitle>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-md text-gray-400 hover:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 sm:hidden dark:hover:text-gray-300 dark:focus:outline-white"
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon aria-hidden="true" className="size-6" />
                  </button>
                </div>
                
                <div className="predictive-search flex-1 flex flex-col min-h-0">
                  <SearchFormPredictive>
                    {({fetchResults, goToSearch, inputRef}) => {
                      // Wrap goToSearch to also close the modal
                      const handleGoToSearch = () => {
                        goToSearch();
                        handleClose();
                      };
                      
                      return (
                        <div className="flex gap-2 pb-4 bg-white dark:bg-gray-800">
                          <input
                            name="q"
                            onChange={fetchResults}
                            onFocus={fetchResults}
                            placeholder="Search products, collections, and more..."
                            ref={inputRef}
                            type="search"
                            list={queriesDatalistId}
                            className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 transition-colors"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={handleGoToSearch}
                            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                          >
                            Search
                          </button>
                        </div>
                      );
                    }}
                  </SearchFormPredictive>

                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <SearchResultsPredictive>
                      {({items, total, term, state, closeSearch}) => {
                        const {articles, collections, pages, products, queries} = items;

                        if (state === 'loading' && term.current) {
                          return (
                            <div className="flex items-center justify-center py-8">
                              <p className="text-gray-500 dark:text-gray-400">Loading...</p>
                            </div>
                          );
                        }

                        if (!total && term.current) {
                          return (
                            <div className="py-8">
                              <SearchResultsPredictive.Empty term={term} />
                            </div>
                          );
                        }

                        if (!term.current) {
                          return (
                            <div className="py-8 text-center">
                              <p className="text-gray-500 dark:text-gray-400">
                                Start typing to search for your favourite creator or a listing.
                              </p>
                            </div>
                          );
                        }

                        return (
                          <>
                            <SearchResultsPredictive.Queries
                              queries={queries}
                              queriesDatalistId={queriesDatalistId}
                            />
                            <div className="space-y-4">
                              <SearchResultsPredictive.Products
                                products={products}
                                closeSearch={handleClose}
                                term={term}
                              />
                              <SearchResultsPredictive.Collections
                                collections={collections}
                                closeSearch={handleClose}
                                term={term}
                              />
                              <SearchResultsPredictive.Pages
                                pages={pages}
                                closeSearch={handleClose}
                                term={term}
                              />
                              <SearchResultsPredictive.Articles
                                articles={articles}
                                closeSearch={handleClose}
                                term={term}
                              />
                            </div>
                            {term.current && total ? (
                              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <Link
                                  onClick={handleClose}
                                  to={`${SEARCH_ENDPOINT}?q=${term.current}`}
                                  className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium text-sm"
                                >
                                  View all results for <q>{term.current}</q>
                                  &nbsp; →
                                </Link>
                              </div>
                            ) : null}
                          </>
                        );
                      }}
                    </SearchResultsPredictive>
                  </div>
                </div>
              </div>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
