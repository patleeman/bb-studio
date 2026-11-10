import { useCallback, useEffect, useState } from "react";
import { isBareWindow } from "@/lib/fork-bare-window";

export const NARROW_WINDOW_SIDEBAR_QUERY = "(max-width: 1100px)";

function keepClosed(): void {}

export function useNarrowWindowSidebar(
  storedOpen: boolean,
  setStoredOpen: (open: boolean) => void,
): { open: boolean; setOpen: (open: boolean) => void } {
  const [narrowOpen, setNarrowOpen] = useState<boolean | null>(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(NARROW_WINDOW_SIDEBAR_QUERY).matches
      ? false
      : null,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(NARROW_WINDOW_SIDEBAR_QUERY);
    const onChange = () => setNarrowOpen(media.matches ? false : null);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const setOpen = useCallback(
    (open: boolean) => {
      if (narrowOpen === null) setStoredOpen(open);
      else setNarrowOpen(open);
    },
    [narrowOpen, setStoredOpen],
  );
  if (isBareWindow()) return { open: false, setOpen: keepClosed };
  return { open: narrowOpen ?? storedOpen, setOpen };
}
