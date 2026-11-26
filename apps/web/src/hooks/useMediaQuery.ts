import { useCallback, useSyncExternalStore } from 'react';

/** Breakpoint, ab dem Desktop-Varianten (schwebendes Panel statt Bottom-Sheet) gelten. */
export const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * Reagiert auf eine CSS-Media-Query. Ohne `window.matchMedia` (SSR, jsdom) gilt `false`,
 * also die mobile Variante.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = () =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
