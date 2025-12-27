import {Link} from 'react-router';

/**
 * Empty cart state component matching Tailwind template design.
 */
export function CartPageEmpty() {
  return (
    <div className="text-center py-12">
      <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
        Your cart is empty
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Looks like you haven&rsquo;t added anything yet, let&rsquo;s get you started!
      </p>
      <Link
        to="/collections"
        prefetch="viewport"
        className="inline-flex items-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none transition-colors"
      >
        Continue shopping
      </Link>
    </div>
  );
}

