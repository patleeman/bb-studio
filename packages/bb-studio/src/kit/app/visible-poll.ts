import { useEffect, useState } from "react";

/**
 * Runs `work` on an interval while the document is visible, and once as soon
 * as the document becomes visible again. Returns a cleanup function that
 * clears both the interval and the visibility listener.
 */
export function visiblePoll(work: () => void, ms: number): () => void {
  const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";
  const timer = setInterval(() => {
    if (isVisible()) work();
  }, ms);
  const onVisible = () => {
    if (document.visibilityState === "visible") work();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * Re-renders with `Date.now()` every `ms` while `enabled` and the document is
 * visible, refreshing immediately when returning to visibility.
 */
export function useNow(ms: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    return visiblePoll(() => setNow(Date.now()), ms);
  }, [ms, enabled]);
  return now;
}
