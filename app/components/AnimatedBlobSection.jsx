import {useState} from 'react';
import {useAnimatedClipPath, DEFAULT_POLYGON} from '~/hooks/useAnimatedClipPath';

/**
 * Hero section with two animated gradient blobs (same clipPath, in-view only, respects reduced motion).
 * Use as a wrapper around the hero content (heading + subtitle).
 */
export function AnimatedBlobSection({children, className}) {
  const [sectionEl, setSectionEl] = useState(null);
  const clipPath = useAnimatedClipPath(sectionEl, DEFAULT_POLYGON);

  return (
    <div
      ref={setSectionEl}
      className={className ?? 'relative isolate z-0 px-6 pt-14 lg:px-8'}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80"
      >
        <div
          style={{clipPath}}
          className="relative left-[calc(50%-11rem)] aspect-1155/678 w-144.5 -translate-x-1/2 rotate-30 bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-30 sm:left-[calc(50%-30rem)] sm:w-288.75"
        />
      </div>
      {children}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-[calc(100%-13rem)] -z-10 transform-gpu overflow-hidden blur-3xl sm:top-[calc(100%-30rem)]"
      >
        <div
          style={{clipPath}}
          className="relative left-[calc(50%+3rem)] aspect-1155/678 w-144.5 -translate-x-1/2 bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-30 sm:left-[calc(50%+36rem)] sm:w-288.75"
        />
      </div>
    </div>
  );
}
