import {CartForm, Image} from '@shopify/hydrogen';
import {useVariantUrl} from '~/lib/variants';
import {Link} from 'react-router';
import {ProductPrice} from './ProductPrice';
import {useContext} from 'react';
import {CartDrawerContext} from './CartDrawer';
import {AsideContext} from './Aside';

/**
 * A single line item in the cart. It displays the product image, title, price.
 * It also provides controls to update the quantity or remove the line item.
 * @param {{
 *   layout: CartLayout;
 *   line: CartLine;
 * }}
 */
export function CartLineItem({layout, line}) {
  const {id, merchandise} = line;
  const {product, title, image, selectedOptions} = merchandise;
  const lineItemUrl = useVariantUrl(product.handle, selectedOptions);
  
  // Try to use cart drawer first, fallback to aside for backward compatibility
  // Both hooks are called unconditionally (React rules), but contexts may be null
  const cartDrawerContext = useContext(CartDrawerContext);
  const asideContext = useContext(AsideContext);
  
  const closeDrawer = cartDrawerContext 
    ? () => cartDrawerContext.setOpen(false)
    : asideContext?.close || (() => {});

  // Use Tailwind classes when in drawer (new design), keep custom classes for page layout
  const isDrawer = cartDrawerContext !== null;
  const listItemClass = isDrawer ? 'flex py-6' : 'cart-line';
  const imageWrapperClass = isDrawer ? 'size-24 shrink-0 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700' : '';
  const contentClass = isDrawer ? 'ml-4 flex flex-1 flex-col' : '';

  return (
    <li key={id} className={listItemClass}>
      {image && (
        <div className={imageWrapperClass}>
          <Image
            alt={title}
            aspectRatio="1/1"
            data={image}
            height={isDrawer ? 96 : 100}
            loading="lazy"
            width={isDrawer ? 96 : 100}
            className={isDrawer ? 'size-full object-cover' : ''}
          />
        </div>
      )}

      <div className={contentClass}>
        <div>
          <div className={isDrawer ? 'flex justify-between text-base font-medium text-gray-900 dark:text-white' : ''}>
            <h3 className={isDrawer ? '' : undefined}>
              <Link
                prefetch="intent"
                to={lineItemUrl}
                onClick={() => {
                  if (layout === 'aside' && closeDrawer) {
                    closeDrawer();
                  }
                }}
                className={isDrawer ? 'text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-300' : undefined}
              >
                {isDrawer ? product.title : <strong>{product.title}</strong>}
              </Link>
            </h3>
            {isDrawer && (
              <p className="ml-4 text-gray-900 dark:text-white">
                <ProductPrice price={line?.cost?.totalAmount} />
              </p>
            )}
          </div>
          {!isDrawer && <ProductPrice price={line?.cost?.totalAmount} />}
          {selectedOptions.length > 0 && (
            <p className={isDrawer ? 'mt-1 text-sm text-gray-500 dark:text-gray-400' : ''}>
              {isDrawer ? (
                selectedOptions.map((option) => `${option.name}: ${option.value}`).join(', ')
              ) : (
                <ul>
                  {selectedOptions.map((option) => (
                    <li key={option.name}>
                      <small>
                        {option.name}: {option.value}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </p>
          )}
        </div>
        <div className={isDrawer ? 'flex flex-1 items-end justify-between text-sm' : ''}>
          {isDrawer ? (
            <>
              <p className="text-gray-500 dark:text-gray-400">Qty {line.quantity}</p>
              <div className="flex">
                <CartLineRemoveButton lineIds={[line.id]} disabled={!!line.isOptimistic} />
              </div>
            </>
          ) : (
            <CartLineQuantity line={line} />
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Provides the controls to update the quantity of a line item in the cart.
 * These controls are disabled when the line item is new, and the server
 * hasn't yet responded that it was successfully added to the cart.
 * @param {{line: CartLine}}
 */
function CartLineQuantity({line}) {
  if (!line || typeof line?.quantity === 'undefined') return null;
  const {id: lineId, quantity, isOptimistic} = line;
  const prevQuantity = Number(Math.max(0, quantity - 1).toFixed(0));
  const nextQuantity = Number((quantity + 1).toFixed(0));

  return (
    <div className="cart-line-quantity">
      <small>Quantity: {quantity} &nbsp;&nbsp;</small>
      <CartLineUpdateButton lines={[{id: lineId, quantity: prevQuantity}]}>
        <button
          aria-label="Decrease quantity"
          disabled={quantity <= 1 || !!isOptimistic}
          name="decrease-quantity"
          value={prevQuantity}
        >
          <span>&#8722; </span>
        </button>
      </CartLineUpdateButton>
      &nbsp;
      <CartLineUpdateButton lines={[{id: lineId, quantity: nextQuantity}]}>
        <button
          aria-label="Increase quantity"
          name="increase-quantity"
          value={nextQuantity}
          disabled={!!isOptimistic}
        >
          <span>&#43;</span>
        </button>
      </CartLineUpdateButton>
      &nbsp;
      <CartLineRemoveButton lineIds={[lineId]} disabled={!!isOptimistic} />
    </div>
  );
}

/**
 * A button that removes a line item from the cart. It is disabled
 * when the line item is new, and the server hasn't yet responded
 * that it was successfully added to the cart.
 * @param {{
 *   lineIds: string[];
 *   disabled: boolean;
 *   className?: string;
 * }}
 */
function CartLineRemoveButton({lineIds, disabled, className = ''}) {
  return (
    <CartForm
      fetcherKey={getUpdateKey(lineIds)}
      route="/cart"
      action={CartForm.ACTIONS.LinesRemove}
      inputs={{lineIds}}
    >
      <button 
        disabled={disabled} 
        type="submit"
        className={className || 'font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300'}
      >
        Remove
      </button>
    </CartForm>
  );
}

/**
 * @param {{
 *   children: React.ReactNode;
 *   lines: CartLineUpdateInput[];
 * }}
 */
function CartLineUpdateButton({children, lines}) {
  const lineIds = lines.map((line) => line.id);

  return (
    <CartForm
      fetcherKey={getUpdateKey(lineIds)}
      route="/cart"
      action={CartForm.ACTIONS.LinesUpdate}
      inputs={{lines}}
    >
      {children}
    </CartForm>
  );
}

/**
 * Returns a unique key for the update action. This is used to make sure actions modifying the same line
 * items are not run concurrently, but cancel each other. For example, if the user clicks "Increase quantity"
 * and "Decrease quantity" in rapid succession, the actions will cancel each other and only the last one will run.
 * @returns
 * @param {string[]} lineIds - line ids affected by the update
 */
function getUpdateKey(lineIds) {
  return [CartForm.ACTIONS.LinesUpdate, ...lineIds].join('-');
}

/** @typedef {OptimisticCartLine<CartApiQueryFragment>} CartLine */

/** @typedef {import('@shopify/hydrogen/storefront-api-types').CartLineUpdateInput} CartLineUpdateInput */
/** @typedef {import('~/components/CartMain').CartLayout} CartLayout */
/** @typedef {import('@shopify/hydrogen').OptimisticCartLine} OptimisticCartLine */
/** @typedef {import('storefrontapi.generated').CartApiQueryFragment} CartApiQueryFragment */
