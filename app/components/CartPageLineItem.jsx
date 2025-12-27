import {CartForm, Image} from '@shopify/hydrogen';
import {Link} from 'react-router';
import {XMarkIcon} from '@heroicons/react/20/solid';
import {useVariantUrl} from '~/lib/variants';
import {ProductPrice} from './ProductPrice';

/**
 * Cart line item component for the cart page using Tailwind template design.
 * Displays product image, title, options, price, and remove button.
 * 
 * @param {{
 *   line: CartLine;
 *   index: number;
 * }}
 */
export function CartPageLineItem({line, index}) {
  const {id, merchandise, isOptimistic} = line;
  const {product, title, image, selectedOptions, sku} = merchandise;
  
  // Check if we have a listing_id attribute (from listings page)
  const listingIdAttr = line.attributes?.find(attr => attr.key === 'listing_id');
  const listingId = listingIdAttr?.value || sku;
  
  // Use listing URL if we have a listing ID, otherwise fall back to product URL
  const lineItemUrl = listingId ? `/listings/${listingId}` : useVariantUrl(product.handle, selectedOptions);
  
  // Filter out "Title: Default Title" variant info
  const filteredOptions = selectedOptions.filter(
    (option) => !(option.name === 'Title' && option.value === 'Default Title')
  );
  
  // Format options for display (e.g., "Color: Black, Size: Large")
  const optionsText = filteredOptions.map(opt => opt.value).join(', ');
  
  return (
    <li className="flex py-6 sm:py-10">
      <div className="shrink-0">
        {image ? (
          <Image
            alt={image.altText || title || product.title}
            data={image}
            className="size-24 rounded-md object-cover sm:size-48"
            loading="lazy"
            aspectRatio="1/1"
            width={192}
            height={192}
            sizes="(min-width: 640px) 192px, 96px"
          />
        ) : (
          <div className="size-24 rounded-md bg-gray-200 sm:size-48 flex items-center justify-center">
            <span className="text-gray-400 text-xs">No image</span>
          </div>
        )}
      </div>

      <div className="ml-4 flex flex-1 flex-col justify-between sm:ml-6">
        <div className="relative pr-9 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:pr-0">
          <div>
            <div className="flex justify-between">
              <h3 className="text-sm">
                <Link
                  to={lineItemUrl}
                  prefetch="intent"
                  className="font-medium text-gray-700 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
                >
                  {product.title}
                </Link>
              </h3>
            </div>
            {optionsText && (
              <div className="mt-1 flex text-sm">
                <p className="text-gray-500 dark:text-gray-400">{optionsText}</p>
              </div>
            )}
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              <ProductPrice price={line?.cost?.totalAmount} />
            </p>
          </div>

          <div className="mt-4 sm:mt-0 sm:pr-9">
            <div className="absolute top-0 right-0">
              <CartRemoveButton lineIds={[id]} disabled={!!isOptimistic} />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Remove button for cart line items.
 * 
 * @param {{
 *   lineIds: string[];
 *   disabled: boolean;
 * }}
 */
function CartRemoveButton({lineIds, disabled}) {
  return (
    <CartForm
      fetcherKey={`remove-${lineIds.join('-')}`}
      route="/cart"
      action={CartForm.ACTIONS.LinesRemove}
      inputs={{lineIds}}
    >
      <button
        type="submit"
        disabled={disabled}
        className="-m-2 inline-flex p-2 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Remove"
      >
        <span className="sr-only">Remove</span>
        <XMarkIcon aria-hidden="true" className="size-5" />
      </button>
    </CartForm>
  );
}

/** @typedef {import('@shopify/hydrogen').OptimisticCartLine} OptimisticCartLine */
/** @typedef {import('storefrontapi.generated').CartApiQueryFragment['lines']['nodes'][0]} CartLine */

