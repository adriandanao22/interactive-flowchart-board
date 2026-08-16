import { useSyncExternalStore } from "react";

/**
 * The current time, coarse enough to be a stable snapshot.
 *
 * Reading `Date.now()` during render is impure — the value changes every call,
 * so React cannot treat two renders of the same state as equivalent. Bucketing
 * it to whole intervals fixes that: within a minute every call returns the
 * same number, and the subscription nudges React when the bucket rolls over.
 * That is what makes "2m ago" tick along without a `setState` in an effect.
 */
export function useNow(intervalMs = 60_000): number {
  const bucket = useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs),
    // Server render has no clock worth reporting; the first client snapshot
    // corrects it immediately.
    () => 0,
  );
  return bucket * intervalMs;
}
