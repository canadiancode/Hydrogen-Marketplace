import {
  ClipboardDocumentListIcon,
  TruckIcon,
  CheckCircleIcon,
  GiftIcon,
} from '@heroicons/react/20/solid';
import marketplaceImage from '~/assets/worn-vault-logictics-b-roll.png';

const steps = [
  {
    number: '1',
    name: 'List with Structure',
    description:
      'Creators list items using a guided flow — including category, condition, and description — ensuring clarity and consistency for buyers.',
    icon: ClipboardDocumentListIcon,
  },
  {
    number: '2',
    name: 'WornVault Prepares Fulfillment',
    description:
      'Once an item sells, WornVault initiates shipping on your behalf. We send the creator the right packaging and a prepaid, WornVault-issued label for the buyer.',
    icon: TruckIcon,
  },
  {
    number: '3',
    name: 'Creator Packs, WornVault Manages',
    description:
      'The creator packs the item using the provided materials and ships it directly to the buyer using the WornVault label. WornVault monitors tracking, enforces timelines, and handles buyer updates.',
    icon: CheckCircleIcon,
  },
  {
    number: '4',
    name: 'Discreet Buyer Delivery',
    description:
      'The item arrives in discreet, platform-controlled packaging with no creator-identifying information. Neither party ever receives the other\'s contact details.',
    icon: GiftIcon,
  },
];

export function HowMarketplaceWorks() {
  return (
    <div className="overflow-hidden bg-white py-24 sm:py-32 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 sm:gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-2">
          <div className="lg:pt-4 lg:pr-8">
            <div className="lg:max-w-lg relative">
              <div
                aria-hidden="true"
                className="absolute inset-x-0 -top-0 z-10 transform-gpu overflow-hidden blur-3xl sm:-top-0"
              >
                <div
                  style={{
                    clipPath:
                      'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
                  }}
                  className="relative left-[calc(50%-11rem)] aspect-1155/678 w-144.5 -translate-x-1/2 rotate-30 bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-30 sm:left-[calc(50%-30rem)] sm:w-288.75"
                />
              </div>
              <h2 className="text-base/7 font-semibold text-indigo-600 dark:text-indigo-400">
                How the Marketplace Works
              </h2>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-pretty text-gray-900 sm:text-5xl dark:text-white">
                A trusted process
              </p>
              <p className="mt-6 text-lg/8 text-gray-700 dark:text-gray-300">
                Every order on WornVault follows a platform-controlled flow built for privacy, discretion, and consistency.
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
                  This keeps the experience private, predictable, and easy for everyone involved.
                </p>
              </div>
            </div>
          </div>
          <img
            alt="WornVault marketplace process"
            src={marketplaceImage}
            width={2432}
            height={1442}
            className="w-3xl max-w-none rounded-xl shadow-xl ring-1 ring-gray-400/10 not-dark:hidden sm:w-228 md:-ml-4 lg:-ml-0 dark:ring-white/10"
          />
          <img
            alt="WornVault marketplace process"
            src={marketplaceImage}
            width={2432}
            height={1442}
            className="w-3xl max-w-none rounded-xl shadow-xl ring-1 ring-gray-400/10 sm:w-228 md:-ml-4 lg:-ml-0 dark:hidden dark:ring-white/10"
          />
        </div>
      </div>
    </div>
  );
}
