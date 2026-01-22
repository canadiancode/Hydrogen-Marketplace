import {Suspense, useRef, useEffect, useState} from 'react';
import {Canvas, useFrame} from '@react-three/fiber';
import {useGLTF, OrbitControls, PerspectiveCamera} from '@react-three/drei';
import deliveryTruckModelUrl from '~/assets/delivery_truck.glb?url';

/**
 * Model component that loads and displays the GLB file
 * @param {Object} props
 * @param {string} props.modelPath - Path to the GLB file
 * @param {boolean} props.autoRotate - Whether to auto-rotate the model
 * @param {number} props.rotationSpeed - Speed of auto-rotation
 */
function Model({modelPath, autoRotate = true, rotationSpeed = 0.5}) {
  const {scene} = useGLTF(modelPath);
  const groupRef = useRef();

  // Auto-rotate animation
  useFrame((state, delta) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += delta * rotationSpeed;
    }
  });

  // Clone the scene to avoid mutating the original
  const clonedScene = scene.clone();

  return (
    <group ref={groupRef}>
      <primitive
        object={clonedScene}
        scale={1}
        position={[0, 0, 0]}
      />
    </group>
  );
}

/**
 * Loading fallback component
 */
function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#6366f1" wireframe />
    </mesh>
  );
}

/**
 * 3D Model Viewer Component (Client-only)
 * Displays a GLB model with interactive controls and responsive design
 * 
 * @param {Object} props
 * @param {string} [props.modelPath] - Path to GLB file (defaults to delivery truck)
 * @param {boolean} [props.autoRotate] - Enable auto-rotation (default: true)
 * @param {number} [props.rotationSpeed] - Rotation speed multiplier (default: 0.5)
 * @param {boolean} [props.controls] - Show orbit controls (default: true)
 * @param {string} [props.className] - Additional CSS classes
 * @param {number} [props.cameraPosition] - Camera position array [x, y, z]
 * @param {boolean} [props.enableZoom] - Enable zoom controls (default: true)
 * @param {boolean} [props.enablePan] - Enable pan controls (default: true)
 */
export function Model3DViewer({
  modelPath = deliveryTruckModelUrl,
  autoRotate = true,
  rotationSpeed = 0.5,
  controls = true,
  className = '',
  cameraPosition = [0, 0, 5],
  enableZoom = true,
  enablePan = true,
}) {
  const [isMounted, setIsMounted] = useState(false);

  // Ensure this only renders on the client (SSR-safe)
  useEffect(() => {
    setIsMounted(true);
    // Preload the model for better performance
    if (useGLTF?.preload && modelPath) {
      useGLTF.preload(modelPath);
    }
  }, [modelPath]);

  if (!isMounted) {
    return (
      <div
        className={`relative w-full h-full min-h-[400px] sm:min-h-[500px] lg:min-h-[600px] rounded-xl shadow-xl ring-1 ring-gray-400/10 dark:ring-white/10 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center ${className}`}
      >
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Loading 3D model...
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full min-h-[400px] sm:min-h-[500px] lg:min-h-[600px] rounded-xl shadow-xl ring-1 ring-gray-400/10 dark:ring-white/10 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 ${className}`}
    >
      <Canvas
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        }}
        dpr={[1, 2]} // Device pixel ratio for better quality on retina displays
        performance={{min: 0.5}} // Adaptive performance
      >
        <PerspectiveCamera
          makeDefault
          position={cameraPosition}
          fov={45}
        />
        
        {/* Lighting setup for better visibility */}
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[10, 10, 5]}
          intensity={1}
          castShadow
        />
        <directionalLight
          position={[-10, -10, -5]}
          intensity={0.3}
        />
        <pointLight position={[0, 10, 0]} intensity={0.5} />
        <pointLight position={[-5, 5, -5]} intensity={0.3} />
        <pointLight position={[5, 5, 5]} intensity={0.3} />

        {/* Model with suspense boundary */}
        <Suspense fallback={<LoadingFallback />}>
          <Model
            modelPath={modelPath}
            autoRotate={autoRotate}
            rotationSpeed={rotationSpeed}
          />
        </Suspense>

        {/* Interactive controls */}
        {controls && (
          <OrbitControls
            enableZoom={enableZoom}
            enablePan={enablePan}
            enableRotate={true}
            minDistance={4}
            maxDistance={15}
            minPolarAngle={0}
            maxPolarAngle={Math.PI / 2}
            autoRotate={autoRotate}
            autoRotateSpeed={rotationSpeed * 10}
            target={[0, 0, 0]}
          />
        )}
      </Canvas>
    </div>
  );
}
