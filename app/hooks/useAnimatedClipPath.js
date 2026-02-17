import {useState, useEffect, useRef} from 'react';

export const DEFAULT_POLYGON =
  'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)';

function parsePolygonPoints(polygonStr) {
  const match = polygonStr.match(/polygon\(([^)]+)\)/);
  if (!match) return [];
  const pairs = match[1].split(/,\s*/).map((pair) => {
    const [x, y] = pair.trim().split(/\s+/).map((s) => parseFloat(s, 10));
    return [x, y];
  });
  return pairs.filter((p) => p.length === 2 && !Number.isNaN(p[0]) && !Number.isNaN(p[1]));
}

function buildPolygonString(values) {
  const pairs = [];
  for (let i = 0; i < values.length; i += 2) {
    pairs.push(`${values[i].toFixed(1)}% ${values[i + 1].toFixed(1)}%`);
  }
  return `polygon(${pairs.join(', ')})`;
}

export function useAnimatedClipPath(containerEl, staticPolygon = DEFAULT_POLYGON) {
  const [clipPath, setClipPath] = useState(staticPolygon);
  const [isInView, setIsInView] = useState(false);
  const reducedMotion = useRef(null);

  useEffect(() => {
    reducedMotion.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (!containerEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { rootMargin: '50px', threshold: 0 }
    );
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, [containerEl]);

  useEffect(() => {
    if (reducedMotion.current) {
      setClipPath(staticPolygon);
      return;
    }
    if (!isInView) return;

    const points = parsePolygonPoints(staticPolygon);
    if (points.length === 0) return;

    const numValues = points.length * 2;
    const values = new Float64Array(numValues);
    const targets = new Uint8Array(numValues);
    const durations = new Float64Array(numValues);
    const delays = new Float64Array(numValues);

    for (let i = 0; i < numValues; i++) {
      values[i] = Math.random() * 100;
      targets[i] = Math.random() < 0.5 ? 0 : 100;
      durations[i] = 5000 + Math.random() * 6000;
      delays[i] = Math.random() * 1500;
    }

    let rafId = null;
    let lastTime = null;

    function tick(now) {
      if (!lastTime) lastTime = now;
      const deltaMs = now - lastTime;
      lastTime = now;

      for (let i = 0; i < numValues; i++) {
        if (delays[i] > 0) {
          delays[i] -= deltaMs;
          if (delays[i] > 0) continue;
        }
        const duration = durations[i];
        const target = targets[i];
        const step = (100 / duration) * deltaMs;
        if (target === 100) {
          values[i] = Math.min(100, values[i] + step);
          if (values[i] >= 100) {
            values[i] = 100;
            targets[i] = 0;
          }
        } else {
          values[i] = Math.max(0, values[i] - step);
          if (values[i] <= 0) {
            values[i] = 0;
            targets[i] = 100;
          }
        }
      }

      setClipPath(buildPolygonString(values));
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [isInView, staticPolygon]);

  return clipPath;
}
