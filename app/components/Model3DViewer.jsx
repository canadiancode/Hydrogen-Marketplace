import {lazy, Suspense} from 'react';

// Lazy load the client-only component to prevent SSR issues
const Model3DViewerClient = lazy(() => 
  import('./Model3DViewer.client.jsx').then(module => ({
    default: module.Model3DViewer,
  }))
);

/**
 * 3D Model Viewer Component (SSR-safe wrapper)
 * This wrapper ensures the Three.js component only loads on the client
 * 
 * @param {Object} props - Same props as Model3DViewer.client.jsx
 */
export function Model3DViewer(props) {
  return (
    <Suspense
      fallback={
        <div
          className={`relative w-full h-full min-h-[400px] sm:min-h-[500px] lg:min-h-[600px] rounded-xl shadow-xl ring-1 ring-gray-400/10 dark:ring-white/10 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center ${props.className || ''}`}
        >
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Loading 3D model...
          </div>
        </div>
      }
    >
      <Model3DViewerClient {...props} />
    </Suspense>
  );
}
