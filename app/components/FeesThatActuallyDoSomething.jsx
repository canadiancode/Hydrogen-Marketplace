import {
  CurrencyDollarIcon,
  CheckCircleIcon,
  TruckIcon,
  ShieldCheckIcon,
  GiftIcon,
  BanknotesIcon,
} from '@heroicons/react/24/outline';

const benefits = [
  {
    name: 'Logistics and verification',
    icon: TruckIcon,
  },
  {
    name: 'Packaging and support',
    icon: GiftIcon,
  },
  {
    name: 'Payouts and disputes',
    icon: BanknotesIcon,
  },
];

export function FeesThatActuallyDoSomething() {
  return (
    <div className="bg-gray-50 py-24 sm:py-32 dark:bg-gray-900">
      <div className="mx-auto max-w-2xl px-6 lg:max-w-7xl lg:px-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600">
            <CurrencyDollarIcon className="h-6 w-6 text-white" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-center text-base/7 font-semibold text-indigo-600 dark:text-indigo-400">
            Fees That Actually Do Something
          </h2>
        </div>
        
        <div className="mx-auto mt-10 max-w-3xl">
          <p className="text-center text-lg font-medium text-gray-900 dark:text-white">
            WornVault doesn't charge for listings.
          </p>
          <p className="mt-4 text-center text-lg font-medium text-gray-900 dark:text-white">
            We charge for removing friction.
          </p>
          
          <p className="mt-6 text-center text-base/7 text-gray-600 dark:text-gray-400">
            Our fees cover end-to-end handling — from logistics and verification to packaging, support, and payouts — so creators never have to manage buyers, shipping, or disputes.
          </p>
          
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {benefits.map((benefit) => (
              <div
                key={benefit.name}
                className="flex items-start gap-3 rounded-lg bg-white px-4 py-3 dark:bg-gray-800"
              >
                <benefit.icon className="h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
                <p className="text-sm/6 text-gray-700 dark:text-gray-300">
                  {benefit.name}
                </p>
              </div>
            ))}
          </div>
          
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-lg bg-white px-6 py-4 dark:bg-gray-800">
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <p className="text-sm/6 font-semibold text-gray-900 dark:text-white">
                  For Buyers
                </p>
              </div>
              <p className="mt-2 text-sm/6 text-gray-600 dark:text-gray-400">
                Buyers pay for trust, discretion, and platform-backed delivery.
              </p>
            </div>
            
            <div className="rounded-lg bg-white px-6 py-4 dark:bg-gray-800">
              <div className="flex items-center gap-2">
                <CheckCircleIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <p className="text-sm/6 font-semibold text-gray-900 dark:text-white">
                  For Creators
                </p>
              </div>
              <p className="mt-2 text-sm/6 text-gray-600 dark:text-gray-400">
                Creators get relief — not admin work.
              </p>
            </div>
          </div>
          
          <div className="mt-10 border-t border-gray-200 pt-8 dark:border-gray-700">
            <p className="text-center text-base/7 font-semibold text-gray-900 dark:text-white">
              If you never have to think about it again, it's worth it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
