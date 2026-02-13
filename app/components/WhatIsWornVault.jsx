import {
  ShieldCheckIcon,
  UserGroupIcon,
  CheckBadgeIcon,
  CreditCardIcon,
  TruckIcon,
  ChatBubbleLeftRightIcon,
  HomeIcon,
  UserIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';

export function WhatIsWornVault() {
  return (
    <div className="py-24 sm:py-32">
      <div className="relative mx-auto max-w-2xl px-6 lg:max-w-7xl lg:px-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600">
            <ShieldCheckIcon className="h-6 w-6 text-white" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-center text-base/7 font-semibold text-indigo-600 dark:text-indigo-400">What Is WornVault?</h2>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-lg font-medium text-gray-600 sm:text-xl dark:text-gray-400">
        Buyers know items come from verified creators. Creators never expose personal information. Trust lives at the platform level — not in DMs.
        </p>
        <div className="mt-10 grid gap-4 sm:mt-16 lg:grid-cols-2">
          {/* FOR BUYERS Column */}
          <div id="buyers" className="relative scroll-mt-24">
            <div className="absolute inset-px rounded-lg bg-white dark:bg-gray-800" />
            <div className="relative flex h-full flex-col overflow-hidden rounded-[calc(var(--radius-lg)+1px)]">
              <div className="px-8 p-8 sm:px-10 sm:pt-10">
                <div className="flex items-center gap-2">
                  <UserGroupIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <p className="text-sm/6 font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                    FOR BUYERS
                  </p>
                </div>
                <p className="mt-2 text-lg font-medium tracking-tight text-gray-950 dark:text-white">
                  Built for Buyers Who Value Trust & Discretion
                </p>
                <ul className="mt-6 space-y-3 text-sm/6 text-gray-600 dark:text-gray-400">
                  <li className="flex items-start">
                    <CheckBadgeIcon className="mr-3 h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>Verified creator profiles</span>
                  </li>
                  <li className="flex items-start">
                    <ShieldCheckIcon className="mr-3 h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>Platform-backed authenticity</span>
                  </li>
                  <li className="flex items-start">
                    <CreditCardIcon className="mr-3 h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>Buyer protection guarantee</span>
                  </li>
                  <li className="flex items-start">
                    <TruckIcon className="mr-3 h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>Discreet packaging and delivery</span>
                  </li>
                </ul>
                <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
                  <p className="text-sm/6 font-medium text-gray-950 dark:text-white">
                    You don't need to trust a stranger.
                  </p>
                  <p className="mt-1 text-sm/6 font-medium text-gray-950 dark:text-white">
                    You can trust WornVault.
                  </p>
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-px rounded-lg shadow-sm outline outline-black/5 dark:outline-white/15" />
          </div>

          {/* FOR CREATORS Column */}
          <div id="creators" className="relative scroll-mt-24">
            <div className="absolute inset-px rounded-lg bg-white dark:bg-gray-800" />
            <div className="relative flex h-full flex-col overflow-hidden rounded-[calc(var(--radius-lg)+1px)]">
              <div className="px-8 p-8 sm:px-10 sm:pt-10">
                <div className="flex items-center gap-2">
                  <UserIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <p className="text-sm/6 font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                    FOR CREATORS
                  </p>
                </div>
                <p className="mt-2 text-lg font-medium tracking-tight text-gray-950 dark:text-white">
                  Built for Creators Who Want Less Friction
                </p>
                <ul className="mt-6 space-y-3 text-sm/6 text-gray-600 dark:text-gray-400">
                  <li className="flex items-start">
                    <ChatBubbleLeftRightIcon className="mr-3 h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>No buyer messaging</span>
                  </li>
                  <li className="flex items-start">
                    <HomeIcon className="mr-3 h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>No address exposure</span>
                  </li>
                  <li className="flex items-start">
                    <TruckIcon className="mr-3 h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>No shipping decisions</span>
                  </li>
                  <li className="flex items-start">
                    <DocumentTextIcon className="mr-3 h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>One simple listing flow</span>
                  </li>
                </ul>
                <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
                  <p className="text-sm/6 font-medium text-gray-950 dark:text-white">
                    You create.
                  </p>
                  <p className="mt-1 text-sm/6 font-medium text-gray-950 dark:text-white">
                    We handle everything else.
                  </p>
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-px rounded-lg shadow-sm outline outline-black/5 dark:outline-white/15" />
          </div>
        </div>
      </div>
    </div>
  );
}
