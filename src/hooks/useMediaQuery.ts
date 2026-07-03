import { useEffect, useState } from 'react';

// MOB-00 (SPRINT_LORE_MOBILE_UX) — foundation for responsive layouts.
// A single source of truth for "are we narrow" so components switch layout in
// JS (inline styles beat CSS media-queries on specificity, so JS is the
// reliable lever here). Breakpoints mirror the sprint doc: 360 / 390 / 768.

export const BREAKPOINTS = { mobile: 480, narrow: 768, tablet: 1024 } as const;

/** Subscribe to a media query; returns whether it currently matches. SSR-safe. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    // Fallback: some environments (device emulation, embedded webviews) don't
    // fire matchMedia's own 'change' on viewport resize — re-evaluate on resize.
    window.addEventListener('resize', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [query]);
  return matches;
}

/** True when the viewport is at or below `maxWidth` px (default: narrow/768). */
export function useIsNarrow(maxWidth: number = BREAKPOINTS.narrow): boolean {
  return useMediaQuery(`(max-width: ${maxWidth}px)`);
}
