import {ServerRouter} from 'react-router';
import {isbot} from 'isbot';
import {renderToReadableStream} from 'react-dom/server';
import {createContentSecurityPolicy} from '@shopify/hydrogen';

/**
 * @param {Request} request
 * @param {number} responseStatusCode
 * @param {Headers} responseHeaders
 * @param {EntryContext} reactRouterContext
 * @param {HydrogenRouterContextProvider} context
 */
export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
  context,
) {
  // Extract Supabase project domain from URL for tighter CSP
  // Format: https://<project-ref>.supabase.co
  // Instead of allowing all *.supabase.co, we restrict to storage subdomain pattern
  // Include 'blob:' to allow client-side image previews (created via URL.createObjectURL)
  let supabaseImgSrc = ["'self'", 'https://cdn.shopify.com', 'blob:'];
  
  if (context.env.SUPABASE_URL) {
    try {
      const supabaseUrl = new URL(context.env.SUPABASE_URL);
      const projectDomain = supabaseUrl.hostname;
      
      if (projectDomain.endsWith('.supabase.co')) {
        // Extract project reference (e.g., 'vpzktiosvxbusozfjhrx' from 'vpzktiosvxbusozfjhrx.supabase.co')
        const projectRef = projectDomain.split('.')[0];
        
        // Allow storage from this specific project's storage bucket
        // Supabase Storage URLs follow pattern: <project-ref>.supabase.co/storage/v1/object/public/
        // We use a more restrictive pattern than wildcard
        supabaseImgSrc.push(`https://${projectRef}.supabase.co/storage/`);
        
        // Also allow the general storage pattern (needed for some Supabase features)
        // This is more restrictive than allowing all *.supabase.co
        supabaseImgSrc.push('https://*.supabase.co/storage/');
      } else {
        // Fallback: use the full domain if it doesn't match expected pattern
        supabaseImgSrc.push(`https://${projectDomain}`);
      }
    } catch (error) {
      // If URL parsing fails, use restrictive storage-only pattern
      console.warn('Could not parse Supabase URL for CSP, using storage-only pattern:', error);
      // More restrictive: only allow storage subdomain, not all Supabase domains
      supabaseImgSrc.push('https://*.supabase.co/storage/');
    }
  } else {
    // If no Supabase URL, use restrictive storage-only pattern for development
    supabaseImgSrc.push('https://*.supabase.co/storage/');
  }

  const {nonce, header, NonceProvider} = createContentSecurityPolicy({
    shop: {
      checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
      storeDomain: context.env.PUBLIC_STORE_DOMAIN,
    },
    // Allow images from Supabase Storage (restricted to storage subdomain)
    imgSrc: supabaseImgSrc,
  });

  const body = await renderToReadableStream(
    <NonceProvider>
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
        nonce={nonce}
      />
    </NonceProvider>,
    {
      nonce,
      signal: request.signal,
      onError(error) {
        console.error(error);
        responseStatusCode = 500;
      },
    },
  );

  if (isbot(request.headers.get('user-agent'))) {
    await body.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');
  responseHeaders.set('Content-Security-Policy', header);

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

/** @typedef {import('@shopify/hydrogen').HydrogenRouterContextProvider} HydrogenRouterContextProvider */
/** @typedef {import('react-router').EntryContext} EntryContext */
