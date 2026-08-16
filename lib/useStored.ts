import { useSyncExternalStore } from "react";

/**
 * A value remembered in localStorage, read safely during render.
 *
 * Reading it in an effect and calling `setState` would work, but it costs a
 * second render pass for every mount. Reading it in a `useState` initialiser
 * instead would differ between the server render and the first client render,
 * which is a hydration mismatch. `useSyncExternalStore` is built for exactly
 * this: a defined server snapshot, and the real value once there is a window.
 *
 * `getSnapshot` must return a stable value between calls or React loops, which
 * holds here because `getItem` returns the same string until something writes.
 */
export function useStored(key: string, fallback = ""): string {
  return useSyncExternalStore(
    // Nothing else in this tab writes the key while a component is mounted,
    // so there is nothing to subscribe to.
    () => () => {},
    () => window.localStorage.getItem(key) ?? fallback,
    () => fallback,
  );
}
