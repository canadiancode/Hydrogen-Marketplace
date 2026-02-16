import {hydrogenPreset} from '@shopify/hydrogen/react-router-preset';

/**
 * React Router 7.9.x Configuration for Hydrogen
 *
 * This configuration uses the official Hydrogen preset to provide optimal
 * React Router settings for Shopify Oxygen deployment. The preset enables
 * validated performance optimizations while ensuring compatibility.
 *
 * routeDiscovery: { mode: 'initial' } is required to avoid "Expected server HTML
 * to contain a matching <head> in <html>" hydration errors. Lazy route discovery
 * can cause Meta/Links to render differently on server vs client.
 * If hydration errors persist: clear cache (rm -rf node_modules/.vite dist) and restart; try incognito.
 */
export default {
  routeDiscovery: { mode: 'initial' },
  presets: [hydrogenPreset()],
};

/** @typedef {import('@react-router/dev/config').Config} Config */
