// Virtual entry point for the app
import {storefrontRedirect} from '@shopify/hydrogen';
import {createRequestHandler} from '@shopify/hydrogen/oxygen';
import {createHydrogenRouterContext} from '~/lib/context';
import {addRequestTimeout} from '~/lib/request-timeout';

/**
 * Export a fetch handler in module format.
 */
export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} executionContext
   * @return {Promise<Response>}
   */
  async fetch(request, env, executionContext) {
    try {
      // Check request size limit (10MB)
      // Note: Content-Length header can be spoofed, but this provides a first-line defense.
      // Actual body size validation happens at the route level for file uploads.
      const contentLength = request.headers.get('content-length');
      const maxSize = 10 * 1024 * 1024; // 10MB
      
      if (contentLength) {
        const headerSize = parseInt(contentLength, 10);
        // Validate Content-Length header
        if (isNaN(headerSize) || headerSize > maxSize) {
          return new Response('Request too large', {status: 413});
        }
        // Reject negative or zero sizes for non-GET requests (indicates spoofing)
        if (request.method !== 'GET' && headerSize <= 0) {
          return new Response('Invalid request size', {status: 400});
        }
        // Reject unreasonably large Content-Length values (potential integer overflow)
        if (headerSize > maxSize * 10) {
          return new Response('Request too large', {status: 413});
        }
      }
      
      // Note: Actual body size validation for file uploads is handled at the route level
      // (e.g., in creator.listings.new.jsx and creator.listings.$id.edit.jsx)
      // This is necessary because:
      // 1. Reading the body here would consume it, preventing React Router from processing it
      // 2. Different routes may have different size limits
      // 3. File upload routes already validate actual file sizes

      // Add request timeout (30 seconds) to prevent hanging requests
      // Critical for production scale
      const timeoutRequest = addRequestTimeout(request, 30000);

      const hydrogenContext = await createHydrogenRouterContext(
        timeoutRequest,
        env,
        executionContext,
      );

      /**
       * Create a Remix request handler and pass
       * Hydrogen's Storefront client to the loader context.
       */
      const handleRequest = createRequestHandler({
        // eslint-disable-next-line import/no-unresolved
        build: await import('virtual:react-router/server-build'),
        mode: process.env.NODE_ENV,
        getLoadContext: () => hydrogenContext,
      });

      const response = await handleRequest(timeoutRequest);

      // Add security headers
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('X-Frame-Options', 'DENY');
      response.headers.set('X-XSS-Protection', '1; mode=block');
      response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      
      // Add HSTS header for HTTPS enforcement (only on HTTPS requests)
      // Check headers first (cheaper operation), then URL if needed
      const forwardedProto = request.headers.get('x-forwarded-proto');
      const isHttps = forwardedProto === 'https' || 
                      (() => {
                        try {
                          return new URL(request.url).protocol === 'https:';
                        } catch {
                          return false;
                        }
                      })();
      
      if (isHttps) {
        response.headers.set(
          'Strict-Transport-Security',
          'max-age=31536000; includeSubDomains; preload'
        );
      }
      
      // Only add Permissions-Policy if not already set by Hydrogen
      if (!response.headers.has('Permissions-Policy')) {
        response.headers.set(
          'Permissions-Policy',
          'geolocation=(), microphone=(), camera=()'
        );
      }

      if (hydrogenContext.session.isPending) {
        response.headers.set(
          'Set-Cookie',
          await hydrogenContext.session.commit(),
        );
      }

      if (response.status === 404) {
        /**
         * Check for redirects only when there's a 404 from the app.
         * If the redirect doesn't exist, then `storefrontRedirect`
         * will pass through the 404 response.
         */
        return storefrontRedirect({
          request,
          response,
          storefront: hydrogenContext.storefront,
        });
      }

      return response;
    } catch (error) {
      console.error(error);
      return new Response('An unexpected error occurred', {status: 500});
    }
  },
};
