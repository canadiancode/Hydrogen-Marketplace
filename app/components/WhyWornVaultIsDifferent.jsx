import {
  SparklesIcon,
  ShieldCheckIcon,
  LockClosedIcon,
  StarIcon,
} from '@heroicons/react/24/outline';

const priorities = [
  {
    name: 'Reduced creator effort',
    icon: SparklesIcon,
  },
  {
    name: 'Buyer confidence',
    icon: ShieldCheckIcon,
  },
  {
    name: 'Luxury-grade discretion',
    icon: LockClosedIcon,
  },
];

export function WhyWornVaultIsDifferent() {
  return (
    <div className="bg-white py-24 sm:py-32 dark:bg-gray-900">
      <div className="mx-auto max-w-2xl px-6 lg:max-w-7xl lg:px-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600">
            <StarIcon className="h-6 w-6 text-white" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-center text-base/7 font-semibold text-indigo-600 dark:text-indigo-400">
            Why WornVault Is Different
          </h2>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-lg font-medium text-gray-600 sm:text-xl dark:text-gray-400">
          Most marketplaces optimize for speed and volume.
        </p>
        <p className="mx-auto mt-4 max-w-3xl text-center text-lg font-medium text-gray-600 sm:text-xl dark:text-gray-400">
          WornVault optimizes for trust, privacy, and emotional safety — because creators are not commodity sellers, and these items are not interchangeable products.
        </p>
        
        <div className="mt-12">
          <p className="text-center text-sm/6 font-semibold text-gray-900 dark:text-white">
            Every design decision prioritizes:
          </p>
          <div className="mx-auto mt-6 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
            {priorities.map((priority) => (
              <div
                key={priority.name}
                className="relative rounded-lg bg-gray-50 px-6 py-4 dark:bg-gray-800"
              >
                <div className="flex items-center justify-center gap-3">
                  <priority.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <p className="text-sm/6 font-medium text-gray-900 dark:text-white">
                    {priority.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 border-t border-gray-200 pt-8 dark:border-gray-700">
          <div className="text-center">
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              Less chaos.
            </p>
            <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
              More control.
            </p>
            <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
              Higher perceived value.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
