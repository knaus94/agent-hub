import { useLayoutEffect, useRef, useState } from 'react';

// Whether the element's content is taller than a length token such as --size-thought-preview, kept current as it grows.
export function useTallerThan<T extends HTMLElement>(token: string) {
   const ref = useRef<T>(null);
   const [taller, setTaller] = useState(false);
   useLayoutEffect(() => {
      const element = ref.current;
      if (!element) return;
      const limit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
      const measure = () => setTaller(element.offsetHeight > limit);
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
   }, [token]);
   return [ref, taller] as const;
}
