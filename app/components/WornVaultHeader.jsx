import {useState, Suspense, useEffect} from 'react';
import {Link, Await, useLocation} from 'react-router';
import {
  Dialog,
  DialogPanel,
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Popover,
  PopoverButton,
  PopoverGroup,
  PopoverPanel,
} from '@headlessui/react';
import {
  Bars3Icon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ShoppingBagIcon,
  UserIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import {ChevronDownIcon} from '@heroicons/react/20/solid';
import {useCartDrawer} from '~/components/CartDrawer';
import {useOptimisticCart, useAnalytics} from '@shopify/hydrogen';
import {useSearchModal} from '~/components/SearchModal';
import {startTransition} from 'react';

const shopItems = [
  { name: 'Explore All', href: '/shop' },
  { name: 'Find a Creator', href: '/creators' },
  { name: 'Shop by Category', href: '/shop?filter=find-category' },
];

const howItWorksItems = [
  { name: 'For Buyers', href: '/#buyers' },
  { name: 'For Creators', href: '/#creators' },
  { name: 'Fees & Payouts', href: '/fees-payouts' },
  { name: 'Verification & Trust', href: '/verification' },
];

const creatorsItems = [
  { name: 'Become a Creator', href: '/creator/login' },
  { name: 'Creator Guidelines', href: '/creators/guidelines' },
];

const aboutItems = [
  { name: 'Our Mission', href: '/about/mission' },
  { name: 'Privacy & Discretion', href: '/about/privacy' },
  { name: 'Contact & Support', href: '/about/contact' },
];

const buyerAccountItems = [
  { name: 'Orders', href: '/account/orders' },
  { name: 'Addresses', href: '/account/addresses' },
  { name: 'Settings', href: '/account/profile' },
];

const creatorAccountItems = [
  { name: 'Dashboard', href: '/creator/dashboard' },
  { name: 'Listings', href: '/creator/listings' },
  { name: 'Payouts', href: '/creator/payouts' },
  { name: 'Settings', href: '/creator/settings' },
];

function CartBadge({cart}) {
  // useOptimisticCart must be called unconditionally (Rules of Hooks)
  // Pass null if cart is not available - useOptimisticCart should handle this gracefully
  const optimisticCart = useOptimisticCart(cart);
  const count = optimisticCart?.totalQuantity ?? 0;
  
  // Get cart drawer context - should always be available since CartDrawerProvider wraps the app
  const {setOpen} = useCartDrawer();
  
  // Analytics for cart view tracking
  const analytics = useAnalytics();
  const {publish, shop, cart: analyticsCart, prevCart} = analytics || {};

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Open the cart drawer
    startTransition(() => {
      setOpen(true);
    });
    
    // Track cart view event for analytics
    if (publish && shop && analyticsCart) {
      publish('cart_viewed', {
        cart: analyticsCart,
        prevCart,
        shop,
        url: typeof window !== 'undefined' ? window.location.href : '',
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="relative -m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700 dark:text-gray-400"
    >
      <span className="sr-only">Shopping cart</span>
      <ShoppingBagIcon aria-hidden="true" className="size-6" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function CartBadgeWrapper({cartPromise}) {
  return (
    <Suspense fallback={<CartBadge cart={null} />}>
      <Await resolve={cartPromise}>
        {(resolvedCart) => <CartBadge cart={resolvedCart} />}
      </Await>
    </Suspense>
  );
}

function SearchButton() {
  const {setOpen} = useSearchModal();
  return (
    <button
      type="button"
      onClick={() => {
        startTransition(() => {
          setOpen(true);
        });
      }}
      className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700 dark:text-gray-400"
    >
      <span className="sr-only">Search</span>
      <MagnifyingGlassIcon aria-hidden="true" className="size-6" />
    </button>
  );
}

/**
 * @param {{
 *   isLoggedIn?: boolean | Promise<boolean>;
 *   isCreator?: boolean | Promise<boolean>;
 *   isAdmin?: boolean | Promise<boolean>;
 *   cart?: any;
 * }}
 */
export function WornVaultHeader({isLoggedIn, isCreator, isAdmin, cart}) {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [shopPopoverOpen, setShopPopoverOpen] = useState(false);
  const [howItWorksPopoverOpen, setHowItWorksPopoverOpen] = useState(false);
  const [creatorsPopoverOpen, setCreatorsPopoverOpen] = useState(false);
  const [aboutPopoverOpen, setAboutPopoverOpen] = useState(false);

  // Close all popovers when route changes (handles browser navigation, programmatic navigation, etc.)
  useEffect(() => {
    setMobileMenuOpen(false);
    setShopPopoverOpen(false);
    setHowItWorksPopoverOpen(false);
    setCreatorsPopoverOpen(false);
    setAboutPopoverOpen(false);
  }, [location.pathname]);

  return (
    <header className="relative z-10 bg-white dark:bg-gray-900">
      <nav aria-label="Global" className="mx-auto flex max-w-7xl items-center justify-between p-6 lg:px-8">
        <div className="flex lg:flex-1">
          <Link to="/" className="-m-1.5 p-1.5">
            <span className="sr-only">WornVault</span>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">WornVault</span>
          </Link>
        </div>
        <div className="flex lg:hidden items-center gap-x-3">
          {cart ? <CartBadgeWrapper cartPromise={cart} /> : <CartBadge cart={null} />}
          <SearchButton />
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700 dark:text-gray-400"
          >
            <span className="sr-only">Open main menu</span>
            <Bars3Icon aria-hidden="true" className="size-6" />
          </button>
        </div>
        <PopoverGroup className="hidden lg:flex lg:gap-x-8">
          {/* Shop Dropdown */}
          <Popover open={shopPopoverOpen} onClose={setShopPopoverOpen} className="relative">
            <PopoverButton className="flex items-center gap-x-1 text-sm/6 font-semibold text-gray-900 dark:text-white">
              Shop
              <ChevronDownIcon aria-hidden="true" className="size-4 flex-none text-gray-400 dark:text-gray-500" />
            </PopoverButton>
            <PopoverPanel
              transition
              className="absolute left-1/2 z-10 mt-3 w-56 -translate-x-1/2 rounded-xl bg-white p-2 shadow-lg outline-1 outline-gray-900/5 transition data-closed:translate-y-1 data-closed:opacity-0 data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
            >
              {shopItems.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setShopPopoverOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm/6 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                >
                  {item.name}
                </Link>
              ))}
            </PopoverPanel>
          </Popover>

          {/* How It Works Dropdown */}
          <Popover open={howItWorksPopoverOpen} onClose={setHowItWorksPopoverOpen} className="relative">
            <PopoverButton className="flex items-center gap-x-1 text-sm/6 font-semibold text-gray-900 dark:text-white">
              How It Works
              <ChevronDownIcon aria-hidden="true" className="size-4 flex-none text-gray-400 dark:text-gray-500" />
            </PopoverButton>
            <PopoverPanel
              transition
              className="absolute left-1/2 z-10 mt-3 w-56 -translate-x-1/2 rounded-xl bg-white p-2 shadow-lg outline-1 outline-gray-900/5 transition data-closed:translate-y-1 data-closed:opacity-0 data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
            >
              {howItWorksItems.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setHowItWorksPopoverOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm/6 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                >
                  {item.name}
                </Link>
              ))}
            </PopoverPanel>
          </Popover>

          {/* Creators Dropdown */}
          <Popover open={creatorsPopoverOpen} onClose={setCreatorsPopoverOpen} className="relative">
            <PopoverButton className="flex items-center gap-x-1 text-sm/6 font-semibold text-gray-900 dark:text-white">
              Creators
              <ChevronDownIcon aria-hidden="true" className="size-4 flex-none text-gray-400 dark:text-gray-500" />
            </PopoverButton>
            <PopoverPanel
              transition
              className="absolute left-1/2 z-10 mt-3 w-56 -translate-x-1/2 rounded-xl bg-white p-2 shadow-lg outline-1 outline-gray-900/5 transition data-closed:translate-y-1 data-closed:opacity-0 data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
            >
              {creatorsItems.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setCreatorsPopoverOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm/6 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                >
                  {item.name}
                </Link>
              ))}
            </PopoverPanel>
          </Popover>

          {/* About Dropdown */}
          <Popover open={aboutPopoverOpen} onClose={setAboutPopoverOpen} className="relative">
            <PopoverButton className="flex items-center gap-x-1 text-sm/6 font-semibold text-gray-900 dark:text-white">
              About
              <ChevronDownIcon aria-hidden="true" className="size-4 flex-none text-gray-400 dark:text-gray-500" />
            </PopoverButton>
            <PopoverPanel
              transition
              className="absolute left-1/2 z-10 mt-3 w-56 -translate-x-1/2 rounded-xl bg-white p-2 shadow-lg outline-1 outline-gray-900/5 transition data-closed:translate-y-1 data-closed:opacity-0 data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
            >
              {aboutItems.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setAboutPopoverOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm/6 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                >
                  {item.name}
                </Link>
              ))}
            </PopoverPanel>
          </Popover>
        </PopoverGroup>
        <div className="hidden lg:flex lg:flex-1 lg:items-center lg:justify-end lg:gap-x-4">
          {cart ? <CartBadgeWrapper cartPromise={cart} /> : <CartBadge cart={null} />}
          <SearchButton />
          <Suspense fallback={<AuthButtons isLoggedIn={false} isCreator={false} />}>
            <Await resolve={isLoggedIn} errorElement={<AuthButtons isLoggedIn={false} isCreator={false} />}>
              {(loggedIn) => (
                <Await resolve={isCreator} errorElement={<AuthButtons isLoggedIn={loggedIn} isCreator={false} />}>
                  {(creator) => <AuthButtons isLoggedIn={loggedIn} isCreator={creator} />}
                </Await>
              )}
            </Await>
          </Suspense>
        </div>
      </nav>
      <Dialog open={mobileMenuOpen} onClose={setMobileMenuOpen} className="lg:hidden">
        <div className="fixed inset-0 z-50" />
        <DialogPanel className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-white p-6 sm:max-w-sm sm:ring-1 sm:ring-gray-900/10 dark:bg-gray-900 dark:sm:ring-gray-100/10">
          <div className="flex items-center justify-between">
            <Link to="/" className="-m-1.5 p-1.5">
              <span className="sr-only">WornVault</span>
              <span className="text-2xl font-bold text-gray-900 dark:text-white">WornVault</span>
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="-m-2.5 rounded-md p-2.5 text-gray-700 dark:text-gray-400"
            >
              <span className="sr-only">Close menu</span>
              <XMarkIcon aria-hidden="true" className="size-6" />
            </button>
          </div>
          <div className="mt-6 flow-root">
            <div className="-my-6 divide-y divide-gray-500/10 dark:divide-white/10">
              <div className="space-y-2 py-6">
                <Disclosure as="div" className="-mx-3">
                  <DisclosureButton className="group flex w-full items-center justify-between rounded-lg py-2 pr-3.5 pl-3 text-base/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
                    Shop
                    <ChevronDownIcon aria-hidden="true" className="size-5 flex-none group-data-open:rotate-180" />
                  </DisclosureButton>
                  <DisclosurePanel className="mt-2 space-y-2">
                    {shopItems.map((item) => (
                      <DisclosureButton
                        key={item.name}
                        as={Link}
                        to={item.href}
                        className="block rounded-lg py-2 pr-3 pl-6 text-sm/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {item.name}
                      </DisclosureButton>
                    ))}
                  </DisclosurePanel>
                </Disclosure>

                <Disclosure as="div" className="-mx-3">
                  <DisclosureButton className="group flex w-full items-center justify-between rounded-lg py-2 pr-3.5 pl-3 text-base/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
                    How It Works
                    <ChevronDownIcon aria-hidden="true" className="size-5 flex-none group-data-open:rotate-180" />
                  </DisclosureButton>
                  <DisclosurePanel className="mt-2 space-y-2">
                    {howItWorksItems.map((item) => (
                      <DisclosureButton
                        key={item.name}
                        as={Link}
                        to={item.href}
                        className="block rounded-lg py-2 pr-3 pl-6 text-sm/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {item.name}
                      </DisclosureButton>
                    ))}
                  </DisclosurePanel>
                </Disclosure>

                <Disclosure as="div" className="-mx-3">
                  <DisclosureButton className="group flex w-full items-center justify-between rounded-lg py-2 pr-3.5 pl-3 text-base/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
                    Creators
                    <ChevronDownIcon aria-hidden="true" className="size-5 flex-none group-data-open:rotate-180" />
                  </DisclosureButton>
                  <DisclosurePanel className="mt-2 space-y-2">
                    {creatorsItems.map((item) => (
                      <DisclosureButton
                        key={item.name}
                        as={Link}
                        to={item.href}
                        className="block rounded-lg py-2 pr-3 pl-6 text-sm/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {item.name}
                      </DisclosureButton>
                    ))}
                  </DisclosurePanel>
                </Disclosure>

                <Disclosure as="div" className="-mx-3">
                  <DisclosureButton className="group flex w-full items-center justify-between rounded-lg py-2 pr-3.5 pl-3 text-base/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
                    About
                    <ChevronDownIcon aria-hidden="true" className="size-5 flex-none group-data-open:rotate-180" />
                  </DisclosureButton>
                  <DisclosurePanel className="mt-2 space-y-2">
                    {aboutItems.map((item) => (
                      <DisclosureButton
                        key={item.name}
                        as={Link}
                        to={item.href}
                        className="block rounded-lg py-2 pr-3 pl-6 text-sm/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {item.name}
                      </DisclosureButton>
                    ))}
                  </DisclosurePanel>
                </Disclosure>
              </div>
              <div className="py-6">
                <Suspense fallback={<MobileAuthButtons isLoggedIn={false} isCreator={false} />}>
                  <Await resolve={isLoggedIn} errorElement={<MobileAuthButtons isLoggedIn={false} isCreator={false} />}>
                    {(loggedIn) => (
                      <Await resolve={isCreator} errorElement={<MobileAuthButtons isLoggedIn={loggedIn} isCreator={false} />}>
                        {(creator) => <MobileAuthButtons isLoggedIn={loggedIn} isCreator={creator} onClose={() => setMobileMenuOpen(false)} />}
                      </Await>
                    )}
                  </Await>
                </Suspense>
              </div>
            </div>
          </div>
        </DialogPanel>
      </Dialog>
    </header>
  );
}

function AuthButtons({isLoggedIn, isCreator}) {
  const location = useLocation();
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);

  // Close account popover when route changes
  useEffect(() => {
    setAccountPopoverOpen(false);
  }, [location.pathname]);

  if (isLoggedIn && isCreator) {
    return (
      <Popover open={accountPopoverOpen} onClose={setAccountPopoverOpen} className="relative">
        <PopoverButton className="flex items-center gap-x-1 text-sm/6 font-semibold text-gray-900 dark:text-white">
          <UserIcon className="size-5" />
          Account
          <ChevronDownIcon aria-hidden="true" className="size-4 flex-none text-gray-400 dark:text-gray-500" />
        </PopoverButton>
        <PopoverPanel
          transition
          className="absolute right-0 z-10 mt-3 w-56 rounded-xl bg-white p-2 shadow-lg outline-1 outline-gray-900/5 transition data-closed:translate-y-1 data-closed:opacity-0 data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
        >
          {creatorAccountItems.map((item) => (
            <Link
              key={item.name}
              to={item.href}
              onClick={() => setAccountPopoverOpen(false)}
              className="flex items-center gap-x-2 rounded-lg px-3 py-2 text-sm/6 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
            >
              {item.name === 'Dashboard' && <Cog6ToothIcon className="size-4" />}
              {item.name === 'Settings' && <Cog6ToothIcon className="size-4" />}
              {item.name}
            </Link>
          ))}
          <Link
            to="/creator/logout"
            onClick={() => setAccountPopoverOpen(false)}
            className="flex items-center gap-x-2 rounded-lg px-3 py-2 text-sm/6 font-semibold text-red-600 hover:bg-gray-50 dark:text-red-400 dark:hover:bg-white/5"
          >
            <ArrowRightOnRectangleIcon className="size-4" />
            Sign Out
          </Link>
        </PopoverPanel>
      </Popover>
    );
  }

  if (isLoggedIn) {
    return (
      <Popover open={accountPopoverOpen} onClose={setAccountPopoverOpen} className="relative">
        <PopoverButton className="flex items-center gap-x-1 text-sm/6 font-semibold text-gray-900 dark:text-white">
          <UserIcon className="size-5" />
          Account
          <ChevronDownIcon aria-hidden="true" className="size-4 flex-none text-gray-400 dark:text-gray-500" />
        </PopoverButton>
        <PopoverPanel
          transition
          className="absolute right-0 z-10 mt-3 w-56 rounded-xl bg-white p-2 shadow-lg outline-1 outline-gray-900/5 transition data-closed:translate-y-1 data-closed:opacity-0 data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
        >
          {buyerAccountItems.map((item) => (
            <Link
              key={item.name}
              to={item.href}
              onClick={() => setAccountPopoverOpen(false)}
              className="flex items-center gap-x-2 rounded-lg px-3 py-2 text-sm/6 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
            >
              {item.name}
            </Link>
          ))}
          <Link
            to="/account/logout"
            onClick={() => setAccountPopoverOpen(false)}
            className="flex items-center gap-x-2 rounded-lg px-3 py-2 text-sm/6 font-semibold text-red-600 hover:bg-gray-50 dark:text-red-400 dark:hover:bg-white/5"
          >
            <ArrowRightOnRectangleIcon className="size-4" />
            Sign Out
          </Link>
        </PopoverPanel>
      </Popover>
    );
  }

  return (
    <div className="flex items-center gap-x-4">
      <Link
        to="/creator/login"
        className="rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400"
      >
        Sell with WornVault
      </Link>
    </div>
  );
}

function MobileAuthButtons({isLoggedIn, isCreator, onClose}) {
  if (isLoggedIn && isCreator) {
    return (
      <>
        <Disclosure as="div" className="-mx-3">
          <DisclosureButton className="group flex w-full items-center justify-between rounded-lg py-2 pr-3.5 pl-3 text-base/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
            Creator Account
            <ChevronDownIcon aria-hidden="true" className="size-5 flex-none group-data-open:rotate-180" />
          </DisclosureButton>
          <DisclosurePanel className="mt-2 space-y-2">
            {creatorAccountItems.map((item) => (
              <DisclosureButton
                key={item.name}
                as={Link}
                to={item.href}
                className="block rounded-lg py-2 pr-3 pl-6 text-sm/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                onClick={onClose}
              >
                {item.name}
              </DisclosureButton>
            ))}
            <DisclosureButton
              as={Link}
              to="/creator/logout"
              className="block rounded-lg py-2 pr-3 pl-6 text-sm/7 font-semibold text-red-600 hover:bg-gray-50 dark:text-red-400 dark:hover:bg-white/5"
              onClick={onClose}
            >
              Sign Out
            </DisclosureButton>
          </DisclosurePanel>
        </Disclosure>
      </>
    );
  }

  if (isLoggedIn) {
    return (
      <>
        <Disclosure as="div" className="-mx-3">
          <DisclosureButton className="group flex w-full items-center justify-between rounded-lg py-2 pr-3.5 pl-3 text-base/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
            Account
            <ChevronDownIcon aria-hidden="true" className="size-5 flex-none group-data-open:rotate-180" />
          </DisclosureButton>
          <DisclosurePanel className="mt-2 space-y-2">
            {buyerAccountItems.map((item) => (
              <DisclosureButton
                key={item.name}
                as={Link}
                to={item.href}
                className="block rounded-lg py-2 pr-3 pl-6 text-sm/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                onClick={onClose}
              >
                {item.name}
              </DisclosureButton>
            ))}
            <DisclosureButton
              as={Link}
              to="/account/logout"
              className="block rounded-lg py-2 pr-3 pl-6 text-sm/7 font-semibold text-red-600 hover:bg-gray-50 dark:text-red-400 dark:hover:bg-white/5"
              onClick={onClose}
            >
              Sign Out
            </DisclosureButton>
          </DisclosurePanel>
        </Disclosure>
      </>
    );
  }

  return (
    <>
      <Link
        to="/account/login"
        className="-mx-3 block rounded-lg px-3 py-2.5 text-base/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
        onClick={onClose}
      >
        Sign In
      </Link>
      <Link
        to="/creator/login"
        className="-mx-3 block rounded-lg px-3 py-2.5 text-base/7 font-semibold text-white bg-indigo-600 hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        onClick={onClose}
      >
        Sell with WornVault
      </Link>
    </>
  );
}
