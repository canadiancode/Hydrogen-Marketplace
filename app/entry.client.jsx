import {HydratedRouter} from 'react-router/dom';
import {StrictMode} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {NonceProvider} from '@shopify/hydrogen';

if (!window.location.origin.includes('webcache.googleusercontent.com')) {
  const existingNonce = document.querySelector('script[nonce]')?.nonce;

  hydrateRoot(
    document,
    <StrictMode>
      <NonceProvider value={existingNonce}>
        <HydratedRouter />
      </NonceProvider>
    </StrictMode>,
  );
}
