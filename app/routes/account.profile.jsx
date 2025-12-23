import {CUSTOMER_UPDATE_MUTATION} from '~/graphql/customer-account/CustomerUpdateMutation';
import {
  data,
  Form,
  useActionData,
  useNavigation,
  useOutletContext,
} from 'react-router';
import {rateLimitMiddleware} from '~/lib/rate-limit';
import {getClientIP} from '~/lib/auth-helpers';

/**
 * @type {Route.MetaFunction}
 */
export const meta = () => {
  return [{title: 'Profile'}];
};

/**
 * @param {Route.LoaderArgs}
 */
export async function loader({context}) {
  context.customerAccount.handleAuthStatus();

  return {};
}

/**
 * @param {Route.ActionArgs}
 */
export async function action({request, context}) {
  const {customerAccount} = context;

  if (request.method !== 'PUT') {
    return data({error: 'Method not allowed'}, {status: 405});
  }

  // Rate limiting: max 10 requests per minute per IP
  const clientIP = getClientIP(request);
  const rateLimit = await rateLimitMiddleware(request, `account-profile:${clientIP}`, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    return data(
      {
        error: 'Too many requests. Please wait a moment before trying again.',
        customer: null,
      },
      {status: 429},
    );
  }

  const form = await request.formData();

  // Input validation constants
  const MAX_NAME_LENGTH = 50;

  try {
    const customer = {};
    const validInputKeys = ['firstName', 'lastName'];
    
    for (const [key, value] of form.entries()) {
      if (!validInputKeys.includes(key)) {
        continue;
      }
      if (typeof value === 'string' && value.length) {
        // Sanitize name fields
        let sanitized = value.trim();
        
        // Remove control characters and limit length
        sanitized = sanitized
          .replace(/[\x00-\x1F\x7F]/g, '')
          .substring(0, MAX_NAME_LENGTH);
        
        // Remove HTML tags
        sanitized = sanitized.replace(/<[^>]*>/g, '');
        
        // Only allow letters, spaces, hyphens, apostrophes
        sanitized = sanitized.replace(/[^a-zA-Z\s'-]/g, '');
        
        if (sanitized.length > 0) {
          customer[key] = sanitized;
        }
      }
    }

    // update customer and possibly password
    const {data, errors} = await customerAccount.mutate(
      CUSTOMER_UPDATE_MUTATION,
      {
        variables: {
          customer,
          language: customerAccount.i18n.language,
        },
      },
    );

    if (errors?.length) {
      throw new Error(errors[0].message);
    }

    if (!data?.customerUpdate?.customer) {
      throw new Error('Customer profile update failed.');
    }

    return {
      error: null,
      customer: data?.customerUpdate?.customer,
    };
  } catch (error) {
    // Log error details server-side only (no stack trace in production)
    const isProduction = context.env.NODE_ENV === 'production';
    console.error('Account profile update error:', {
      error: error.message || 'Unknown error',
      errorName: error.name || 'Error',
      timestamp: new Date().toISOString(),
      ...(isProduction ? {} : {errorStack: error.stack}),
    });
    
    // Return generic error to client
    let userFriendlyError = 'Failed to update profile. Please try again.';
    
    // Only expose safe, specific errors (whitelist approach)
    const errorMessage = (error.message || '').toLowerCase();
    if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      userFriendlyError = 'Please check your input and try again.';
    } else if (errorMessage.includes('required')) {
      userFriendlyError = 'Please fill in all required fields.';
    }
    
    return data(
      {error: userFriendlyError, customer: null},
      {
        status: 400,
      },
    );
  }
}

export default function AccountProfile() {
  const account = useOutletContext();
  const {state} = useNavigation();
  /** @type {ActionReturnData} */
  const action = useActionData();
  const customer = action?.customer ?? account?.customer;

  return (
    <div className="account-profile">
      <h2>My profile</h2>
      <br />
      <Form method="PUT">
        <legend>Personal information</legend>
        <fieldset>
          <label htmlFor="firstName">First name</label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            autoComplete="given-name"
            placeholder="First name"
            aria-label="First name"
            defaultValue={customer.firstName ?? ''}
            minLength={2}
          />
          <label htmlFor="lastName">Last name</label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            autoComplete="family-name"
            placeholder="Last name"
            aria-label="Last name"
            defaultValue={customer.lastName ?? ''}
            minLength={2}
          />
        </fieldset>
        {action?.error ? (
          <p>
            <mark>
              <small>{action.error}</small>
            </mark>
          </p>
        ) : (
          <br />
        )}
        <button type="submit" disabled={state !== 'idle'}>
          {state !== 'idle' ? 'Updating' : 'Update'}
        </button>
      </Form>
    </div>
  );
}

/**
 * @typedef {{
 *   error: string | null;
 *   customer: CustomerFragment | null;
 * }} ActionResponse
 */

/** @typedef {import('customer-accountapi.generated').CustomerFragment} CustomerFragment */
/** @typedef {import('@shopify/hydrogen/customer-account-api-types').CustomerUpdateInput} CustomerUpdateInput */
/** @typedef {import('./+types/account.profile').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof action>} ActionReturnData */
