import {defineConfig} from 'vite';
import {hydrogen} from '@shopify/hydrogen/vite';
import {oxygen} from '@shopify/mini-oxygen/vite';
import {reactRouter} from '@react-router/dev/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({mode}) => {
  // Base allowed hosts (always allowed)
  const allowedHosts = ['.tryhydrogen.dev'];
  
  // Only allow ngrok domains in development mode for webhook testing
  if (mode === 'development') {
    allowedHosts.push(
      '.ngrok-free.dev',  // ngrok free tier
      '.ngrok.io',        // ngrok legacy domains
      '.ngrok.app',       // ngrok newer domains
    );
  }

  return {
    plugins: [
      tailwindcss(),
      hydrogen(),
      oxygen(),
      reactRouter(),
      tsconfigPaths(),
    ],
    build: {
      // Allow a strict Content-Security-Policy
      // withtout inlining assets as base64:
      assetsInlineLimit: 0,
    },
    ssr: {
      optimizeDeps: {
        /**
         * Include dependencies here if they throw CJS<>ESM errors.
         * For example, for the following error:
         *
         * > ReferenceError: module is not defined
         * >   at /Users/.../node_modules/example-dep/index.js:1:1
         *
         * Include 'example-dep' in the array below.
         * @see https://vitejs.dev/config/dep-optimization-options
         */
        include: ['set-cookie-parser', 'cookie', 'react-router', '@headlessui/react', '@heroicons/react', '@supabase/supabase-js'],
      },
    },
    server: {
      allowedHosts,
    },
  };
});
