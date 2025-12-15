import {
  Cog6ToothIcon,
  ShieldCheckIcon,
  LockClosedIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';

const trustBadges = [
  {
    name: 'Secure checkout',
    icon: LockClosedIcon,
  },
  {
    name: 'Industry-leading infrastructure',
    icon: Cog6ToothIcon,
  },
  {
    name: 'Global reliability',
    icon: GlobeAltIcon,
  },
];

export function BuiltOnShopify() {
  return (
    <div className="bg-white py-24 sm:py-32 dark:bg-gray-900">
      <div className="mx-auto max-w-2xl px-6 lg:max-w-7xl lg:px-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600">
            <ShieldCheckIcon className="h-6 w-6 text-white" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-center text-base/7 font-semibold text-indigo-600 dark:text-indigo-400">
            Built on Shopify. Designed for Trust.
          </h2>
        </div>
        
        <div className="mx-auto mt-10 max-w-3xl">
          <p className="text-center text-lg/8 text-gray-700 dark:text-gray-300">
            WornVault is powered by Shopify — the same commerce infrastructure trusted by millions of businesses worldwide.
          </p>
          <p className="mt-6 text-center text-base/7 text-gray-600 dark:text-gray-400">
            Payments, checkout, and security run on proven systems, while WornVault layers marketplace logic, logistics, and verification on top.
          </p>
          <p className="mt-6 text-center text-base/7 text-gray-600 dark:text-gray-400">
            This combination allows us to scale safely — without compromising privacy or experience.
          </p>
          
          <div className="mt-10 border-t border-gray-200 pt-8 dark:border-gray-700">
            <div className="flex flex-wrap items-center justify-center gap-6">
              {trustBadges.map((badge) => (
                <div key={badge.name} className="flex items-center gap-2">
                  <badge.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-sm/6 font-medium text-gray-700 dark:text-gray-300">
                    {badge.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
