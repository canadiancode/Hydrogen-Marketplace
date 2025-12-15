import {
  ClipboardDocumentListIcon,
  TruckIcon,
  CheckCircleIcon,
  GiftIcon,
} from '@heroicons/react/20/solid';

const steps = [
  {
    number: '1',
    name: 'List with Structure',
    description:
      'Creators list items using a guided flow — including category, condition, and story — ensuring clarity and consistency for buyers.',
    icon: ClipboardDocumentListIcon,
  },
  {
    number: '2',
    name: 'Item Routes Through WornVault',
    description:
      'Once sold, the item ships to WornVault using a prepaid label (or optional white-glove pickup).',
    icon: TruckIcon,
  },
  {
    number: '3',
    name: 'Intake & Handling',
    description:
      'We verify, quality-check, and repackage each item with discretion and care.',
    icon: CheckCircleIcon,
  },
  {
    number: '4',
    name: 'Buyer Fulfillment',
    description:
      'The item ships to the buyer from WornVault — never directly from the creator.',
    icon: GiftIcon,
  },
];

export function HowMarketplaceWorks() {
  return (
    <div className="overflow-hidden bg-white py-24 sm:py-32 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 sm:gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-2">
          <div className="lg:pt-4 lg:pr-8">
            <div className="lg:max-w-lg">
              <h2 className="text-base/7 font-semibold text-indigo-600 dark:text-indigo-400">
                How the Marketplace Works
              </h2>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-pretty text-gray-900 sm:text-5xl dark:text-white">
                A trusted process
              </p>
              <p className="mt-6 text-lg/8 text-gray-700 dark:text-gray-300">
                Every item sold on WornVault passes through our platform for intake, handling, and fulfillment. Buyers never interact directly with sellers. Creators never expose personal information.
              </p>
              <dl className="mt-10 max-w-xl space-y-8 text-base/7 text-gray-600 lg:max-w-none dark:text-gray-400">
                {steps.map((step) => (
                  <div key={step.number} className="relative pl-9">
                    <dt className="inline font-semibold text-gray-900 dark:text-white">
                      <step.icon
                        aria-hidden="true"
                        className="absolute top-1 left-1 size-5 text-indigo-600 dark:text-indigo-400"
                      />
                      {step.number}. {step.name}
                    </dt>{' '}
                    <dd className="inline">{step.description}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-10 pt-8 border-t border-gray-200 dark:border-gray-700">
                <p className="text-base/7 font-semibold text-gray-900 dark:text-white">
                  This removes peer-to-peer risk entirely.
                </p>
              </div>
            </div>
          </div>
          <img
            alt="WornVault marketplace process"
            src="https://tailwindcss.com/plus-assets/img/component-images/dark-project-app-screenshot.png"
            width={2432}
            height={1442}
            className="w-3xl max-w-none rounded-xl shadow-xl ring-1 ring-gray-400/10 not-dark:hidden sm:w-228 md:-ml-4 lg:-ml-0 dark:ring-white/10"
          />
          <img
            alt="WornVault marketplace process"
            src="https://tailwindcss.com/plus-assets/img/component-images/project-app-screenshot.png"
            width={2432}
            height={1442}
            className="w-3xl max-w-none rounded-xl shadow-xl ring-1 ring-gray-400/10 sm:w-228 md:-ml-4 lg:-ml-0 dark:hidden dark:ring-white/10"
          />
        </div>
      </div>
    </div>
  );
}
