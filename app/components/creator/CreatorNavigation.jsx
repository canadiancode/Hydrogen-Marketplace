import { useState } from 'react'
import { NavLink, Link } from 'react-router'
import { Dialog, DialogBackdrop, DialogPanel, TransitionChild } from '@headlessui/react'
import {
  Squares2X2Icon,
  RectangleStackIcon,
  PlusCircleIcon,
  BanknotesIcon,
  Cog6ToothIcon,
  XMarkIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  TruckIcon,
  LinkIcon,
  Bars3Icon,
} from '@heroicons/react/24/outline'

const navigation = [
  { name: 'Creator Dashboard', href: '/creator/dashboard', icon: Squares2X2Icon },
  { name: 'Manage Listings', href: '/creator/listings', icon: RectangleStackIcon },
  { name: 'Create Listing', href: '/creator/listings/new', icon: PlusCircleIcon },
  { name: 'Social Links', href: '/creator/social-links', icon: LinkIcon },
  { name: 'Sales', href: '/creator/sales', icon: ShoppingCartIcon },
  { name: 'Logistics', href: '/creator/logistics', icon: TruckIcon },
  { name: 'Payouts', href: '/creator/payouts', icon: BanknotesIcon },
]

const settingsNavigation = [
  { name: 'Account Settings', href: '/creator/settings', icon: Cog6ToothIcon },
]

const adminNavigation = [
  { name: 'Admin', href: '/admin', icon: ShieldCheckIcon },
]

function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

/**
 * Creator Navigation Component
 * Displays primary sidebar navigation and secondary navigation header
 * @param {{isAdmin?: boolean}} props
 */
export function CreatorNavigation({isAdmin = false}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <>
      {/* Mobile Header with Hamburger Menu */}
      <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-200 bg-white px-4 shadow-sm dark:border-gray-700 dark:bg-gray-900 xl:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="-m-2.5 p-2.5 text-gray-700 dark:text-gray-300 xl:hidden"
        >
          <span className="sr-only">Open sidebar</span>
          <Bars3Icon aria-hidden="true" className="size-6" />
        </button>
        <div className="flex flex-1 items-center gap-x-4">
          <Link to="/" className="-m-1.5 p-1.5">
            <span className="sr-only">WornVault</span>
            <span className="text-xl font-bold text-gray-900 dark:text-white">WornVault</span>
          </Link>
        </div>
      </div>

      <Dialog open={sidebarOpen} onClose={setSidebarOpen} className="relative z-50 xl:hidden">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-gray-900/80 transition-opacity duration-300 ease-linear data-closed:opacity-0"
        />

        <div className="fixed inset-0 flex">
          <DialogPanel
            transition
            className="relative mr-16 flex w-full max-w-xs flex-1 transform transition duration-300 ease-in-out data-closed:-translate-x-full"
          >
            <TransitionChild>
              <div className="absolute top-0 left-full flex w-16 justify-center pt-5 duration-300 ease-in-out data-closed:opacity-0">
                <button type="button" onClick={() => setSidebarOpen(false)} className="-m-2.5 p-2.5">
                  <span className="sr-only">Close sidebar</span>
                  <XMarkIcon aria-hidden="true" className="size-6 text-white" />
                </button>
              </div>
            </TransitionChild>

            {/* Mobile Sidebar */}
            <div className="relative flex grow flex-col gap-y-5 overflow-y-auto bg-gray-50 px-6 dark:bg-gray-900 dark:ring dark:ring-white/10 dark:before:pointer-events-none dark:before:absolute dark:before:inset-0 dark:before:bg-black/10">
              <div className="relative flex h-16 shrink-0 items-center">
                <Link to="/" className="-m-1.5 p-1.5">
                  <span className="sr-only">WornVault</span>
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">WornVault</span>
                </Link>
              </div>
              <nav className="relative flex flex-1 flex-col">
                <ul role="list" className="flex flex-1 flex-col gap-y-7 pb-4">
                  <li>
                    <ul role="list" className="-mx-2 space-y-1">
                      {navigation.map((item) => (
                        <li key={item.name}>
                          <NavLink
                            to={item.href}
                            end={item.href === '/creator/listings'}
                            onClick={() => setSidebarOpen(false)}
                            className={({ isActive }) =>
                              classNames(
                                isActive
                                  ? 'bg-gray-100 text-indigo-600 dark:bg-white/5 dark:text-white'
                                  : 'text-gray-700 hover:bg-gray-100 hover:text-indigo-600 dark:text-white dark:hover:bg-white/5 dark:hover:text-white',
                                'group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold',
                              )
                            }
                          >
                            {({ isActive }) => (
                              <>
                                <item.icon
                                  aria-hidden="true"
                                  className={classNames(
                                    isActive
                                      ? 'text-indigo-600 dark:text-white'
                                      : 'text-gray-400 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-white',
                                    'size-6 shrink-0',
                                  )}
                                />
                                {item.name}
                              </>
                            )}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </li>
                  <li className="-mx-6 mt-auto">
                    <ul role="list" className="-mx-2 space-y-1 px-6">
                      {isAdmin === true ? (
                        <>
                          {adminNavigation.map((item) => (
                            <li key={item.name}>
                                <NavLink
                                  to={item.href}
                                  onClick={() => setSidebarOpen(false)}
                                  className={({ isActive }) =>
                                    classNames(
                                      isActive
                                        ? 'bg-gray-100 text-indigo-600 dark:bg-white/5 dark:text-white'
                                        : 'text-gray-700 hover:bg-gray-100 hover:text-indigo-600 dark:text-white dark:hover:bg-white/5 dark:hover:text-white',
                                      'group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold',
                                    )
                                  }
                                >
                                  {({ isActive }) => (
                                    <>
                                      <item.icon
                                        aria-hidden="true"
                                        className={classNames(
                                          isActive
                                            ? 'text-indigo-600 dark:text-white'
                                            : 'text-gray-400 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-white',
                                          'size-6 shrink-0',
                                        )}
                                      />
                                      {item.name}
                                    </>
                                  )}
                                </NavLink>
                            </li>
                          ))}
                        </>
                      ) : null}
                      {settingsNavigation.map((item) => (
                        <li key={item.name}>
                          <NavLink
                            to={item.href}
                            onClick={() => setSidebarOpen(false)}
                            className={({ isActive }) =>
                              classNames(
                                isActive
                                  ? 'bg-gray-100 text-indigo-600 dark:bg-white/5 dark:text-white'
                                  : 'text-gray-700 hover:bg-gray-100 hover:text-indigo-600 dark:text-white dark:hover:bg-white/5 dark:hover:text-white',
                                'group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold',
                              )
                            }
                          >
                            {({ isActive }) => (
                              <>
                                <item.icon
                                  aria-hidden="true"
                                  className={classNames(
                                    isActive
                                      ? 'text-indigo-600 dark:text-white'
                                      : 'text-gray-400 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-white',
                                    'size-6 shrink-0',
                                  )}
                                />
                                {item.name}
                              </>
                            )}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </li>
                </ul>
              </nav>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      {/* Desktop Sidebar */}
      <div className="hidden xl:fixed xl:inset-y-0 xl:z-50 xl:flex xl:w-72 xl:flex-col dark:bg-gray-900">
        <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gray-50 px-6 ring-1 ring-gray-200 dark:bg-black/10 dark:ring-white/5">
          <div className="flex h-16 shrink-0 items-center">
            <Link to="/" className="-m-1.5 p-1.5">
              <span className="sr-only">WornVault</span>
              <span className="text-2xl font-bold text-gray-900 dark:text-white">WornVault</span>
            </Link>
          </div>
          <nav className="flex flex-1 flex-col">
            <ul role="list" className="flex flex-1 flex-col gap-y-7 pb-4">
              <li>
                <ul role="list" className="-mx-2 space-y-1">
                  {navigation.map((item) => (
                    <li key={item.name}>
                      <NavLink
                        to={item.href}
                        end={item.href === '/creator/listings'}
                        className={({ isActive }) =>
                          classNames(
                            isActive
                              ? 'bg-gray-100 text-indigo-600 dark:bg-white/5 dark:!text-white'
                              : 'text-gray-700 hover:bg-gray-100 hover:text-indigo-600 dark:!text-white dark:hover:bg-white/5 dark:hover:!text-white',
                            'group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon
                              aria-hidden="true"
                              className={classNames(
                                isActive
                                  ? 'text-indigo-600 dark:!text-white'
                                  : 'text-gray-400 group-hover:text-indigo-600 dark:!text-white dark:group-hover:!text-white',
                                'size-6 shrink-0',
                              )}
                            />
                            {item.name}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </li>
              <li className="-mx-6 mt-auto">
                <ul role="list" className="-mx-2 space-y-1 px-6">
                  {isAdmin === true ? (
                    <>
                      {adminNavigation.map((item) => (
                        <li key={item.name}>
                            <NavLink
                              to={item.href}
                              className={({ isActive }) =>
                                classNames(
                                  isActive
                                    ? 'bg-gray-100 text-indigo-600 dark:bg-white/5 dark:!text-white'
                                    : 'text-gray-700 hover:bg-gray-100 hover:text-indigo-600 dark:!text-white dark:hover:bg-white/5 dark:hover:!text-white',
                                  'group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold',
                                )
                              }
                            >
                              {({ isActive }) => (
                                <>
                                  <item.icon
                                    aria-hidden="true"
                                    className={classNames(
                                      isActive
                                        ? 'text-indigo-600 dark:!text-white'
                                        : 'text-gray-400 group-hover:text-indigo-600 dark:!text-white dark:group-hover:!text-white',
                                      'size-6 shrink-0',
                                    )}
                                  />
                                  {item.name}
                                </>
                              )}
                            </NavLink>
                        </li>
                      ))}
                    </>
                  ) : null}
                  {settingsNavigation.map((item) => (
                    <li key={item.name}>
                      <NavLink
                        to={item.href}
                        className={({ isActive }) =>
                          classNames(
                            isActive
                              ? 'bg-gray-100 text-indigo-600 dark:bg-white/5 dark:!text-white'
                              : 'text-gray-700 hover:bg-gray-100 hover:text-indigo-600 dark:!text-white dark:hover:bg-white/5 dark:hover:!text-white',
                            'group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon
                              aria-hidden="true"
                              className={classNames(
                                isActive
                                  ? 'text-indigo-600 dark:!text-white'
                                  : 'text-gray-400 group-hover:text-indigo-600 dark:!text-white dark:group-hover:!text-white',
                                'size-6 shrink-0',
                              )}
                            />
                            {item.name}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </>
  )
}
