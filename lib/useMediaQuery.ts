"use client";

import { useSyncExternalStore } from "react";

/**
 * Matches a media query, without the setState-in-an-effect dance.
 *
 * `useSyncExternalStore` is the right tool here: the browser already owns this
 * state, so subscribing to it beats mirroring it into React state and keeping
 * the two in step. On the server it reports false, which means the statically
 * rendered HTML is the desktop layout — anything that would flash on a phone
 * should be driven by a CSS media query instead of this hook.
 */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `md`. Keep this in step with the `md:` classes in the UI. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** True when the primary input is touch, which is not the same as "small". */
export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
